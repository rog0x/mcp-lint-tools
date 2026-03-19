import { z } from "zod";

export const codeStyleSchema = z.object({
  code: z.string().describe("The source code to check"),
  rules: z
    .object({
      indentation: z
        .enum(["tabs", "spaces"])
        .optional()
        .describe("Expected indentation style"),
      indentSize: z
        .number()
        .optional()
        .describe("Number of spaces per indent level (when using spaces)"),
      maxLineLength: z
        .number()
        .optional()
        .describe("Maximum allowed line length"),
      trailingWhitespace: z
        .boolean()
        .optional()
        .describe("Disallow trailing whitespace"),
      finalNewline: z
        .boolean()
        .optional()
        .describe("Require final newline"),
      quotes: z
        .enum(["single", "double"])
        .optional()
        .describe("Expected quote style for strings"),
      semicolons: z
        .enum(["always", "never"])
        .optional()
        .describe("Semicolon usage preference"),
    })
    .optional()
    .describe("Style rules to enforce (all enabled by default)"),
});

export type CodeStyleInput = z.infer<typeof codeStyleSchema>;

interface StyleIssue {
  line: number;
  column: number;
  rule: string;
  severity: "warning" | "error";
  message: string;
  suggestion?: string;
}

function checkIndentation(
  lines: string[],
  style: "tabs" | "spaces",
  indentSize: number
): StyleIssue[] {
  const issues: StyleIssue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;

    const leadingWhitespace = line.match(/^(\s*)/)?.[1] ?? "";
    if (leadingWhitespace.length === 0) continue;

    if (style === "tabs") {
      if (leadingWhitespace.includes(" ")) {
        const spacesFound = (leadingWhitespace.match(/ /g) || []).length;
        issues.push({
          line: i + 1,
          column: 1,
          rule: "indentation",
          severity: "warning",
          message: `Expected tabs but found ${spacesFound} space(s)`,
          suggestion: `Replace leading spaces with tabs`,
        });
      }
    } else {
      if (leadingWhitespace.includes("\t")) {
        issues.push({
          line: i + 1,
          column: 1,
          rule: "indentation",
          severity: "warning",
          message: `Expected spaces but found tab(s)`,
          suggestion: `Replace tabs with ${indentSize} spaces each`,
        });
      } else if (leadingWhitespace.length % indentSize !== 0) {
        issues.push({
          line: i + 1,
          column: 1,
          rule: "indentation",
          severity: "warning",
          message: `Indentation is ${leadingWhitespace.length} spaces, not a multiple of ${indentSize}`,
          suggestion: `Adjust to ${Math.round(leadingWhitespace.length / indentSize) * indentSize} spaces`,
        });
      }
    }
  }
  return issues;
}

function checkLineLength(lines: string[], maxLength: number): StyleIssue[] {
  const issues: StyleIssue[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > maxLength) {
      issues.push({
        line: i + 1,
        column: maxLength + 1,
        rule: "max-line-length",
        severity: "warning",
        message: `Line length is ${lines[i].length}, exceeds maximum of ${maxLength}`,
        suggestion: "Break the line into multiple shorter lines",
      });
    }
  }
  return issues;
}

function checkTrailingWhitespace(lines: string[]): StyleIssue[] {
  const issues: StyleIssue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trailing = lines[i].match(/(\s+)$/);
    if (trailing && lines[i].trim().length > 0) {
      issues.push({
        line: i + 1,
        column: lines[i].trimEnd().length + 1,
        rule: "trailing-whitespace",
        severity: "warning",
        message: `Trailing whitespace found (${trailing[1].length} character(s))`,
        suggestion: "Remove trailing whitespace",
      });
    }
  }
  return issues;
}

function checkFinalNewline(code: string): StyleIssue[] {
  if (!code.endsWith("\n")) {
    const lines = code.split("\n");
    return [
      {
        line: lines.length,
        column: lines[lines.length - 1].length + 1,
        rule: "final-newline",
        severity: "warning",
        message: "File does not end with a newline",
        suggestion: "Add a newline at the end of the file",
      },
    ];
  }
  return [];
}

function checkQuotes(
  lines: string[],
  style: "single" | "double"
): StyleIssue[] {
  const issues: StyleIssue[] = [];
  const wrongQuote = style === "single" ? '"' : "'";
  const rightQuote = style === "single" ? "'" : '"';
  // Match strings but skip template literals, escaped quotes, and quotes inside the other type
  const stringPattern =
    style === "single"
      ? /"([^"\\]|\\.)*"/g
      : /'([^'\\]|\\.)*'/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments
    if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
    // Skip lines with template literals
    if (line.includes("`")) continue;
    // Skip require/import paths that might need specific quotes
    let match: RegExpExecArray | null;
    const re = new RegExp(stringPattern.source, "g");
    while ((match = re.exec(line)) !== null) {
      const str = match[0];
      // Skip if the string contains the right quote inside (would need escaping)
      if (str.slice(1, -1).includes(rightQuote)) continue;
      issues.push({
        line: i + 1,
        column: match.index + 1,
        rule: "quotes",
        severity: "warning",
        message: `Found ${wrongQuote} but expected ${rightQuote}`,
        suggestion: `Replace ${wrongQuote} with ${rightQuote}`,
      });
    }
  }
  return issues;
}

function checkSemicolons(
  lines: string[],
  style: "always" | "never"
): StyleIssue[] {
  const issues: StyleIssue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Skip empty lines, comments, block openers/closers, decorators
    if (
      trimmed.length === 0 ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*") ||
      trimmed.endsWith("{") ||
      trimmed.endsWith("}") ||
      trimmed.endsWith(",") ||
      trimmed.startsWith("@") ||
      trimmed.startsWith("#") ||
      /^(if|else|for|while|switch|try|catch|finally|class|interface|enum|type|namespace|export\s+default)\b/.test(trimmed) ||
      /^\}/.test(trimmed)
    )
      continue;

    const endsWithSemicolon = trimmed.endsWith(";");

    if (style === "always" && !endsWithSemicolon) {
      // Only flag lines that look like statements
      if (
        /^(const|let|var|return|throw|import|export|break|continue)\b/.test(trimmed) ||
        /\)$/.test(trimmed) ||
        /^[a-zA-Z_$][\w$.]*\s*=/.test(trimmed) ||
        /^[a-zA-Z_$][\w$.]*\s*\(/.test(trimmed)
      ) {
        issues.push({
          line: i + 1,
          column: trimmed.length + 1,
          rule: "semicolons",
          severity: "warning",
          message: "Missing semicolon",
          suggestion: "Add a semicolon at the end of the statement",
        });
      }
    } else if (style === "never" && endsWithSemicolon) {
      // Skip for-loop semicolons and single-line constructs
      if (!trimmed.includes("for")) {
        issues.push({
          line: i + 1,
          column: trimmed.length,
          rule: "semicolons",
          severity: "warning",
          message: "Unexpected semicolon",
          suggestion: "Remove the semicolon",
        });
      }
    }
  }
  return issues;
}

export function checkCodeStyle(input: CodeStyleInput): object {
  const { code, rules } = input;
  const lines = code.split("\n");
  const allIssues: StyleIssue[] = [];

  const effectiveRules = {
    indentation: rules?.indentation ?? "spaces",
    indentSize: rules?.indentSize ?? 2,
    maxLineLength: rules?.maxLineLength ?? 120,
    trailingWhitespace: rules?.trailingWhitespace ?? true,
    finalNewline: rules?.finalNewline ?? true,
    quotes: rules?.quotes,
    semicolons: rules?.semicolons,
  };

  allIssues.push(
    ...checkIndentation(lines, effectiveRules.indentation, effectiveRules.indentSize)
  );
  allIssues.push(...checkLineLength(lines, effectiveRules.maxLineLength));

  if (effectiveRules.trailingWhitespace) {
    allIssues.push(...checkTrailingWhitespace(lines));
  }
  if (effectiveRules.finalNewline) {
    allIssues.push(...checkFinalNewline(code));
  }
  if (effectiveRules.quotes) {
    allIssues.push(...checkQuotes(lines, effectiveRules.quotes));
  }
  if (effectiveRules.semicolons) {
    allIssues.push(...checkSemicolons(lines, effectiveRules.semicolons));
  }

  allIssues.sort((a, b) => a.line - b.line || a.column - b.column);

  const summary: Record<string, number> = {};
  for (const issue of allIssues) {
    summary[issue.rule] = (summary[issue.rule] || 0) + 1;
  }

  return {
    totalIssues: allIssues.length,
    rulesApplied: effectiveRules,
    summary,
    issues: allIssues,
  };
}
