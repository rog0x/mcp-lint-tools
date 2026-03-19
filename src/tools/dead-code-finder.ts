import { z } from "zod";

export const deadCodeFinderSchema = z.object({
  code: z.string().describe("The source code to analyze"),
  checkUnused: z
    .boolean()
    .optional()
    .default(true)
    .describe("Check for unused variables"),
  checkUnreachable: z
    .boolean()
    .optional()
    .default(true)
    .describe("Check for unreachable code after return/throw"),
  checkEmptyCatch: z
    .boolean()
    .optional()
    .default(true)
    .describe("Check for empty catch blocks"),
  checkCommentedCode: z
    .boolean()
    .optional()
    .default(true)
    .describe("Check for commented-out code blocks"),
  checkTodos: z
    .boolean()
    .optional()
    .default(true)
    .describe("Check for TODO/FIXME/HACK comments"),
});

export type DeadCodeFinderInput = z.infer<typeof deadCodeFinderSchema>;

interface DeadCodeIssue {
  line: number;
  kind: string;
  severity: "info" | "warning" | "error";
  message: string;
  suggestion?: string;
}

function findUnusedVariables(code: string): DeadCodeIssue[] {
  const issues: DeadCodeIssue[] = [];
  const lines = code.split("\n");

  // Collect variable declarations
  const declarations: Array<{ name: string; line: number }> = [];
  const declPattern =
    /(?:const|let|var)\s+(?:\{[^}]*\}|\[[^\]]*\]|([A-Za-z_$][\w$]*))\s*(?::[^=]*)?=/;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    const match = trimmed.match(declPattern);
    if (match && match[1]) {
      // Skip exports, they're used externally
      if (trimmed.startsWith("export")) continue;
      declarations.push({ name: match[1], line: i + 1 });
    }
  }

  // Remove strings, comments, and the declaration line itself, then check usage
  const cleanedCode = code
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

  for (const decl of declarations) {
    // Count occurrences of the name as a whole word
    const namePattern = new RegExp(`\\b${escapeRegex(decl.name)}\\b`, "g");
    const matches = cleanedCode.match(namePattern);
    // If only 1 occurrence (the declaration itself), it's unused
    if (matches && matches.length <= 1) {
      issues.push({
        line: decl.line,
        kind: "unused-variable",
        severity: "warning",
        message: `Variable '${decl.name}' is declared but never used`,
        suggestion: `Remove the declaration or use the variable`,
      });
    }
  }

  return issues;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findUnreachableCode(code: string): DeadCodeIssue[] {
  const issues: DeadCodeIssue[] = [];
  const lines = code.split("\n");

  let braceDepth = 0;
  const returnDepths: Map<number, number> = new Map(); // depth -> line of return

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Track brace depth
    for (const ch of trimmed) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") {
        returnDepths.delete(braceDepth);
        braceDepth--;
      }
    }

    // Skip comments and empty lines
    if (
      trimmed.length === 0 ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*")
    )
      continue;

    // Check if previous line at same depth had a return/throw/break/continue
    if (returnDepths.has(braceDepth) && !trimmed.startsWith("}") && !trimmed.startsWith("case") && !trimmed.startsWith("default")) {
      issues.push({
        line: i + 1,
        kind: "unreachable-code",
        severity: "error",
        message: `Code is unreachable after return/throw/break on line ${returnDepths.get(braceDepth)}`,
        suggestion: "Remove the unreachable code or adjust the control flow",
      });
      returnDepths.delete(braceDepth);
    }

    // Detect return/throw/break/continue as the last statement on the line
    if (
      /^(return\b|throw\b|break\b|continue\b)/.test(trimmed) &&
      !trimmed.endsWith("{")
    ) {
      // Only flag if followed by code at the same brace depth
      returnDepths.set(braceDepth, i + 1);
    }
  }

  return issues;
}

function findEmptyCatchBlocks(code: string): DeadCodeIssue[] {
  const issues: DeadCodeIssue[] = [];
  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // catch block on one line: catch (e) {}
    if (/\bcatch\s*\([^)]*\)\s*\{\s*\}/.test(trimmed)) {
      issues.push({
        line: i + 1,
        kind: "empty-catch",
        severity: "warning",
        message: "Empty catch block swallows errors silently",
        suggestion:
          "Log the error or handle it. At minimum, add a comment explaining why it is empty.",
      });
      continue;
    }

    // catch block spanning lines
    if (/\bcatch\s*\([^)]*\)\s*\{\s*$/.test(trimmed)) {
      // Check if next non-empty line is just "}"
      for (let j = i + 1; j < lines.length; j++) {
        const nextTrimmed = lines[j].trim();
        if (nextTrimmed.length === 0) continue;
        if (nextTrimmed === "}") {
          issues.push({
            line: i + 1,
            kind: "empty-catch",
            severity: "warning",
            message: "Empty catch block swallows errors silently",
            suggestion:
              "Log the error or handle it. At minimum, add a comment explaining why it is empty.",
          });
        }
        break;
      }
    }
  }

  return issues;
}

function findCommentedOutCode(code: string): DeadCodeIssue[] {
  const issues: DeadCodeIssue[] = [];
  const lines = code.split("\n");

  // Patterns that look like commented-out code rather than real comments
  const codePatterns = [
    /^\/\/\s*(const|let|var|function|class|if|for|while|return|import|export)\b/,
    /^\/\/\s*[a-zA-Z_$][\w$]*\s*[=(]/,
    /^\/\/\s*\w+\.\w+\(/,
    /^\/\/\s*\}\s*$/,
    /^\/\/\s*\{\s*$/,
  ];

  let blockStart: number | null = null;
  let blockCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    const isCommentedCode = codePatterns.some((p) => p.test(trimmed));

    if (isCommentedCode) {
      if (blockStart === null) {
        blockStart = i + 1;
        blockCount = 1;
      } else {
        blockCount++;
      }
    } else {
      if (blockStart !== null && blockCount >= 2) {
        issues.push({
          line: blockStart,
          kind: "commented-code",
          severity: "info",
          message: `Block of commented-out code (${blockCount} lines starting at line ${blockStart})`,
          suggestion:
            "Remove commented-out code. Use version control to keep history.",
        });
      }
      blockStart = null;
      blockCount = 0;
    }
  }

  // Handle block at end of file
  if (blockStart !== null && blockCount >= 2) {
    issues.push({
      line: blockStart,
      kind: "commented-code",
      severity: "info",
      message: `Block of commented-out code (${blockCount} lines starting at line ${blockStart})`,
      suggestion:
        "Remove commented-out code. Use version control to keep history.",
    });
  }

  return issues;
}

function findTodos(code: string): DeadCodeIssue[] {
  const issues: DeadCodeIssue[] = [];
  const lines = code.split("\n");
  const todoPattern = /\b(TODO|FIXME|HACK|XXX|WORKAROUND|TEMP)\b[:\s]*(.*)/i;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(todoPattern);
    if (match) {
      const tag = match[1].toUpperCase();
      const description = match[2]?.trim() || "(no description)";
      const severity: "info" | "warning" =
        tag === "FIXME" || tag === "HACK" ? "warning" : "info";

      issues.push({
        line: i + 1,
        kind: "todo-comment",
        severity,
        message: `${tag}: ${description}`,
      });
    }
  }

  return issues;
}

export function findDeadCode(input: DeadCodeFinderInput): object {
  const {
    code,
    checkUnused,
    checkUnreachable,
    checkEmptyCatch,
    checkCommentedCode,
    checkTodos,
  } = input;
  const allIssues: DeadCodeIssue[] = [];

  if (checkUnused) allIssues.push(...findUnusedVariables(code));
  if (checkUnreachable) allIssues.push(...findUnreachableCode(code));
  if (checkEmptyCatch) allIssues.push(...findEmptyCatchBlocks(code));
  if (checkCommentedCode) allIssues.push(...findCommentedOutCode(code));
  if (checkTodos) allIssues.push(...findTodos(code));

  allIssues.sort((a, b) => a.line - b.line);

  const summary: Record<string, number> = {};
  for (const issue of allIssues) {
    summary[issue.kind] = (summary[issue.kind] || 0) + 1;
  }

  return {
    totalIssues: allIssues.length,
    summary,
    issues: allIssues,
  };
}
