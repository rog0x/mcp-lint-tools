import { z } from "zod";

export const importAnalyzerSchema = z.object({
  code: z.string().describe("The source code to analyze"),
  filePath: z
    .string()
    .optional()
    .describe("File path for context in circular dependency detection"),
  knownModules: z
    .array(z.string())
    .optional()
    .describe("List of known valid module names for missing import detection"),
  preferredOrder: z
    .array(z.enum(["builtin", "external", "internal", "parent", "sibling", "index"]))
    .optional()
    .default(["builtin", "external", "internal", "parent", "sibling", "index"])
    .describe("Preferred import group ordering"),
});

export type ImportAnalyzerInput = z.infer<typeof importAnalyzerSchema>;

interface ImportInfo {
  line: number;
  raw: string;
  module: string;
  names: string[];
  isDefault: boolean;
  isNamespace: boolean;
  isTypeOnly: boolean;
  group: "builtin" | "external" | "internal" | "parent" | "sibling" | "index";
}

interface ImportIssue {
  line: number;
  kind: string;
  severity: "info" | "warning" | "error";
  message: string;
  suggestion?: string;
}

const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "constants",
  "crypto", "dgram", "dns", "domain", "events", "fs", "http", "https",
  "module", "net", "os", "path", "perf_hooks", "process", "punycode",
  "querystring", "readline", "repl", "stream", "string_decoder", "sys",
  "timers", "tls", "tty", "url", "util", "v8", "vm", "worker_threads",
  "zlib",
]);

function classifyImport(
  modulePath: string
): ImportInfo["group"] {
  // Node builtins
  const bareModule = modulePath.replace(/^node:/, "");
  if (NODE_BUILTINS.has(bareModule) || modulePath.startsWith("node:")) {
    return "builtin";
  }
  // Relative paths
  if (modulePath === ".") return "index";
  if (modulePath === "..") return "parent";
  if (modulePath.startsWith("./index") || modulePath === ".") return "index";
  if (modulePath.startsWith("../")) return "parent";
  if (modulePath.startsWith("./")) return "sibling";
  // Internal (aliased paths like @/ or ~/)
  if (modulePath.startsWith("@/") || modulePath.startsWith("~/")) return "internal";
  // External packages
  return "external";
}

function extractImports(code: string): ImportInfo[] {
  const lines = code.split("\n");
  const imports: ImportInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip non-import lines
    if (!trimmed.startsWith("import") && !trimmed.match(/\brequire\s*\(/)) continue;
    // Skip inside functions/classes
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // ES import patterns
    // import X from "..."
    const defaultImport = trimmed.match(
      /^import\s+(type\s+)?([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/
    );
    if (defaultImport) {
      imports.push({
        line: i + 1,
        raw: trimmed,
        module: defaultImport[3],
        names: [defaultImport[2]],
        isDefault: true,
        isNamespace: false,
        isTypeOnly: !!defaultImport[1],
        group: classifyImport(defaultImport[3]),
      });
      continue;
    }

    // import * as X from "..."
    const namespaceImport = trimmed.match(
      /^import\s+(type\s+)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/
    );
    if (namespaceImport) {
      imports.push({
        line: i + 1,
        raw: trimmed,
        module: namespaceImport[3],
        names: [namespaceImport[2]],
        isDefault: false,
        isNamespace: true,
        isTypeOnly: !!namespaceImport[1],
        group: classifyImport(namespaceImport[3]),
      });
      continue;
    }

    // import { X, Y } from "..."
    const namedImport = trimmed.match(
      /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/
    );
    if (namedImport) {
      const names = namedImport[2]
        .split(",")
        .map((n) => n.trim().replace(/\s+as\s+\w+/, ""))
        .filter((n) => n.length > 0);
      imports.push({
        line: i + 1,
        raw: trimmed,
        module: namedImport[3],
        names,
        isDefault: false,
        isNamespace: false,
        isTypeOnly: !!namedImport[1],
        group: classifyImport(namedImport[3]),
      });
      continue;
    }

    // import "..." (side-effect)
    const sideEffectImport = trimmed.match(/^import\s+['"]([^'"]+)['"]/);
    if (sideEffectImport) {
      imports.push({
        line: i + 1,
        raw: trimmed,
        module: sideEffectImport[1],
        names: [],
        isDefault: false,
        isNamespace: false,
        isTypeOnly: false,
        group: classifyImport(sideEffectImport[1]),
      });
      continue;
    }

    // require()
    const requireMatch = trimmed.match(
      /(?:const|let|var)\s+(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/
    );
    if (requireMatch) {
      const names = requireMatch[1]
        ? requireMatch[1].split(",").map((n) => n.trim()).filter((n) => n.length > 0)
        : requireMatch[2]
          ? [requireMatch[2]]
          : [];
      imports.push({
        line: i + 1,
        raw: trimmed,
        module: requireMatch[3],
        names,
        isDefault: !requireMatch[1],
        isNamespace: false,
        isTypeOnly: false,
        group: classifyImport(requireMatch[3]),
      });
    }
  }

  return imports;
}

function findUnusedImports(code: string, imports: ImportInfo[]): ImportIssue[] {
  const issues: ImportIssue[] = [];

  // Clean code: remove comments and strings, and remove the import lines themselves
  const lines = code.split("\n");
  const importLineNumbers = new Set(imports.map((imp) => imp.line));

  const nonImportCode = lines
    .filter((_, idx) => !importLineNumbers.has(idx + 1))
    .join("\n")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

  for (const imp of imports) {
    // Side-effect imports are always considered used
    if (imp.names.length === 0) continue;

    for (const name of imp.names) {
      const namePattern = new RegExp(`\\b${escapeRegex(name)}\\b`);
      if (!namePattern.test(nonImportCode)) {
        issues.push({
          line: imp.line,
          kind: "unused-import",
          severity: "warning",
          message: `Import '${name}' from '${imp.module}' is not used`,
          suggestion: `Remove the unused import`,
        });
      }
    }
  }

  return issues;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkImportOrder(
  imports: ImportInfo[],
  preferredOrder: ImportInfo["group"][]
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (imports.length <= 1) return issues;

  const orderMap = new Map<string, number>();
  for (let i = 0; i < preferredOrder.length; i++) {
    orderMap.set(preferredOrder[i], i);
  }

  let lastGroupIndex = -1;
  let lastGroupName = "";

  for (const imp of imports) {
    const groupIndex = orderMap.get(imp.group) ?? 99;
    if (groupIndex < lastGroupIndex) {
      issues.push({
        line: imp.line,
        kind: "import-order",
        severity: "info",
        message: `Import from '${imp.module}' (${imp.group}) should come before ${lastGroupName} imports`,
        suggestion: `Reorder imports: ${preferredOrder.join(" > ")}`,
      });
    }
    if (groupIndex > lastGroupIndex) {
      lastGroupIndex = groupIndex;
      lastGroupName = imp.group;
    }
  }

  return issues;
}

function detectDuplicateImports(imports: ImportInfo[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const moduleMap = new Map<string, number[]>();

  for (const imp of imports) {
    const existing = moduleMap.get(imp.module);
    if (existing) {
      existing.push(imp.line);
    } else {
      moduleMap.set(imp.module, [imp.line]);
    }
  }

  for (const [module, lines] of moduleMap) {
    if (lines.length > 1) {
      issues.push({
        line: lines[1],
        kind: "duplicate-import",
        severity: "warning",
        message: `Module '${module}' is imported multiple times (lines ${lines.join(", ")})`,
        suggestion: "Merge into a single import statement",
      });
    }
  }

  return issues;
}

function detectCircularHints(
  imports: ImportInfo[],
  filePath?: string
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (!filePath) return issues;

  // Basic heuristic: if a file imports from a relative path that could import back
  // We flag mutual relative imports in the same directory
  const fileName = filePath.replace(/.*[\\/]/, "").replace(/\.\w+$/, "");

  for (const imp of imports) {
    if (imp.group === "sibling" || imp.group === "parent") {
      const importedFile = imp.module.replace(/.*[\\/]/, "").replace(/\.\w+$/, "");
      // If importing from a file that has the same directory as us, flag as potential circular
      if (imp.module.includes(fileName)) {
        issues.push({
          line: imp.line,
          kind: "potential-circular",
          severity: "info",
          message: `Potential circular dependency: '${filePath}' imports '${imp.module}' which may reference back`,
          suggestion:
            "Verify this import chain does not create a cycle. Consider extracting shared code.",
        });
      }
    }
  }

  return issues;
}

export function analyzeImports(input: ImportAnalyzerInput): object {
  const { code, filePath, preferredOrder } = input;
  const imports = extractImports(code);
  const allIssues: ImportIssue[] = [];

  allIssues.push(...findUnusedImports(code, imports));
  allIssues.push(...checkImportOrder(imports, preferredOrder));
  allIssues.push(...detectDuplicateImports(imports));
  allIssues.push(...detectCircularHints(imports, filePath));

  allIssues.sort((a, b) => a.line - b.line);

  const summary: Record<string, number> = {};
  for (const issue of allIssues) {
    summary[issue.kind] = (summary[issue.kind] || 0) + 1;
  }

  // Group imports by category
  const groupedImports: Record<string, string[]> = {};
  for (const imp of imports) {
    if (!groupedImports[imp.group]) groupedImports[imp.group] = [];
    groupedImports[imp.group].push(imp.module);
  }

  return {
    totalImports: imports.length,
    totalIssues: allIssues.length,
    summary,
    groupedImports,
    imports: imports.map((imp) => ({
      line: imp.line,
      module: imp.module,
      names: imp.names,
      group: imp.group,
      isTypeOnly: imp.isTypeOnly,
    })),
    issues: allIssues,
  };
}
