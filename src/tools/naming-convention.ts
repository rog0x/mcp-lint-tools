import { z } from "zod";

export const namingConventionSchema = z.object({
  code: z.string().describe("The source code to analyze"),
  language: z
    .enum(["typescript", "javascript", "python", "go", "general"])
    .optional()
    .default("general")
    .describe("Programming language for context-aware rules"),
});

export type NamingConventionInput = z.infer<typeof namingConventionSchema>;

interface NamingIssue {
  line: number;
  name: string;
  kind: string;
  currentConvention: string;
  expectedConvention: string;
  suggestion: string;
}

type Convention = "camelCase" | "PascalCase" | "snake_case" | "UPPER_CASE" | "kebab-case" | "unknown";

function detectConvention(name: string): Convention {
  if (/^[A-Z][A-Z0-9_]*$/.test(name) && name.includes("_")) return "UPPER_CASE";
  if (/^[A-Z][A-Z0-9]*$/.test(name)) return "UPPER_CASE";
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name) && /[a-z]/.test(name)) return "PascalCase";
  if (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name)) return "camelCase";
  if (/^[a-z][a-z0-9]*$/.test(name)) return "camelCase"; // single word, treat as camelCase
  if (/^[a-z][a-z0-9_]*$/.test(name) && name.includes("_")) return "snake_case";
  if (/^[a-z][a-z0-9-]*$/.test(name) && name.includes("-")) return "kebab-case";
  return "unknown";
}

function toCamelCase(name: string): string {
  return name
    .replace(/[-_]([a-zA-Z])/g, (_, c: string) => c.toUpperCase())
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

function toPascalCase(name: string): string {
  const camel = toCamelCase(name);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]/g, "_")
    .toLowerCase();
}

function toUpperCase(name: string): string {
  return toSnakeCase(name).toUpperCase();
}

function suggestFix(name: string, target: Convention): string {
  switch (target) {
    case "camelCase":
      return toCamelCase(name);
    case "PascalCase":
      return toPascalCase(name);
    case "snake_case":
      return toSnakeCase(name);
    case "UPPER_CASE":
      return toUpperCase(name);
    default:
      return name;
  }
}

interface Identifier {
  name: string;
  line: number;
  kind: "variable" | "function" | "class" | "constant" | "parameter" | "interface" | "type" | "enum";
}

function extractIdentifiers(code: string): Identifier[] {
  const lines = code.split("\n");
  const identifiers: Identifier[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    // Classes
    const classMatch = trimmed.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
    if (classMatch) {
      identifiers.push({ name: classMatch[1], line: i + 1, kind: "class" });
    }

    // Interfaces
    const ifaceMatch = trimmed.match(/\binterface\s+([A-Za-z_$][\w$]*)/);
    if (ifaceMatch) {
      identifiers.push({ name: ifaceMatch[1], line: i + 1, kind: "interface" });
    }

    // Type aliases
    const typeMatch = trimmed.match(/\btype\s+([A-Za-z_$][\w$]*)\s*=/);
    if (typeMatch) {
      identifiers.push({ name: typeMatch[1], line: i + 1, kind: "type" });
    }

    // Enums
    const enumMatch = trimmed.match(/\benum\s+([A-Za-z_$][\w$]*)/);
    if (enumMatch) {
      identifiers.push({ name: enumMatch[1], line: i + 1, kind: "enum" });
    }

    // Functions
    const funcMatch = trimmed.match(/\bfunction\s+([A-Za-z_$][\w$]*)/);
    if (funcMatch) {
      identifiers.push({ name: funcMatch[1], line: i + 1, kind: "function" });
    }

    // Arrow/method declarations
    const arrowMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/);
    if (arrowMatch) {
      identifiers.push({ name: arrowMatch[1], line: i + 1, kind: "function" });
    }

    // Constants (UPPER_CASE or const with literal)
    const constMatch = trimmed.match(
      /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*\w[\w<>,\s|]*\s*)?=\s*(?:['"`\d\[{]|true|false|null)/
    );
    if (constMatch && !arrowMatch) {
      const conv = detectConvention(constMatch[1]);
      if (conv === "UPPER_CASE") {
        identifiers.push({ name: constMatch[1], line: i + 1, kind: "constant" });
      } else {
        identifiers.push({ name: constMatch[1], line: i + 1, kind: "variable" });
      }
    }

    // Variables (let/var)
    const varMatch = trimmed.match(/^(?:export\s+)?(?:let|var)\s+([A-Za-z_$][\w$]*)/);
    if (varMatch) {
      identifiers.push({ name: varMatch[1], line: i + 1, kind: "variable" });
    }

    // Function parameters (simple detection)
    const paramMatch = trimmed.match(/\bfunction\s+\w+\s*\(([^)]*)\)/);
    if (paramMatch && paramMatch[1].trim().length > 0) {
      const params = paramMatch[1].split(",");
      for (const p of params) {
        const paramName = p.trim().replace(/[:=?].*$/, "").replace(/\.\.\./g, "").trim();
        if (paramName && /^[A-Za-z_$][\w$]*$/.test(paramName)) {
          identifiers.push({ name: paramName, line: i + 1, kind: "parameter" });
        }
      }
    }
  }

  return identifiers;
}

function getExpectedConvention(
  kind: Identifier["kind"],
  language: string
): Convention | null {
  if (language === "python") {
    switch (kind) {
      case "class": return "PascalCase";
      case "function": return "snake_case";
      case "variable": return "snake_case";
      case "constant": return "UPPER_CASE";
      case "parameter": return "snake_case";
      default: return null;
    }
  }
  // TypeScript / JavaScript / general
  switch (kind) {
    case "class": return "PascalCase";
    case "interface": return "PascalCase";
    case "type": return "PascalCase";
    case "enum": return "PascalCase";
    case "function": return "camelCase";
    case "variable": return "camelCase";
    case "constant": return "UPPER_CASE";
    case "parameter": return "camelCase";
    default: return null;
  }
}

export function checkNamingConventions(input: NamingConventionInput): object {
  const { code, language } = input;
  const identifiers = extractIdentifiers(code);
  const issues: NamingIssue[] = [];

  // Convention distribution
  const conventionCounts: Record<string, number> = {};

  for (const id of identifiers) {
    const actual = detectConvention(id.name);
    if (actual !== "unknown") {
      conventionCounts[actual] = (conventionCounts[actual] || 0) + 1;
    }

    const expected = getExpectedConvention(id.kind, language ?? "general");
    if (!expected) continue;

    if (actual !== expected && actual !== "unknown") {
      issues.push({
        line: id.line,
        name: id.name,
        kind: id.kind,
        currentConvention: actual,
        expectedConvention: expected,
        suggestion: suggestFix(id.name, expected),
      });
    }
  }

  // Detect mixed conventions within same kind
  const byKind: Record<string, Record<string, string[]>> = {};
  for (const id of identifiers) {
    const conv = detectConvention(id.name);
    if (conv === "unknown") continue;
    if (!byKind[id.kind]) byKind[id.kind] = {};
    if (!byKind[id.kind][conv]) byKind[id.kind][conv] = [];
    byKind[id.kind][conv].push(id.name);
  }

  const mixedConventions: Array<{
    kind: string;
    conventions: Record<string, string[]>;
  }> = [];
  for (const [kind, conventions] of Object.entries(byKind)) {
    if (Object.keys(conventions).length > 1) {
      mixedConventions.push({ kind, conventions });
    }
  }

  return {
    totalIdentifiers: identifiers.length,
    totalIssues: issues.length,
    conventionDistribution: conventionCounts,
    mixedConventions,
    issues,
    identifiers: identifiers.map((id) => ({
      ...id,
      convention: detectConvention(id.name),
    })),
  };
}
