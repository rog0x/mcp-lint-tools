import { z } from "zod";

export const complexityAnalyzerSchema = z.object({
  code: z.string().describe("The source code to analyze"),
  threshold: z
    .number()
    .optional()
    .default(10)
    .describe("Cyclomatic complexity threshold to flag (default: 10)"),
  maxLines: z
    .number()
    .optional()
    .default(50)
    .describe("Maximum lines per function before flagging (default: 50)"),
  maxNestingDepth: z
    .number()
    .optional()
    .default(4)
    .describe("Maximum nesting depth before flagging (default: 4)"),
});

export type ComplexityAnalyzerInput = z.infer<typeof complexityAnalyzerSchema>;

interface FunctionInfo {
  name: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  cyclomaticComplexity: number;
  maxNestingDepth: number;
  flags: string[];
}

interface ExtractedFunction {
  name: string;
  startLine: number;
  body: string;
  endLine: number;
}

function extractFunctions(code: string): ExtractedFunction[] {
  const lines = code.split("\n");
  const functions: ExtractedFunction[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Match function declarations, methods, arrow functions assigned to variables
    let funcName: string | null = null;

    // function keyword
    const funcDeclMatch = trimmed.match(
      /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/
    );
    if (funcDeclMatch) {
      funcName = funcDeclMatch[1];
    }

    // Arrow function or method
    if (!funcName) {
      const arrowMatch = trimmed.match(
        /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]*\s*)?=>/
      );
      if (arrowMatch) {
        funcName = arrowMatch[1];
      }
    }

    // Class method
    if (!funcName) {
      const methodMatch = trimmed.match(
        /^(?:public|private|protected|static|async|get|set|\s)*\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]*)?\s*\{/
      );
      if (methodMatch && !["if", "for", "while", "switch", "catch", "else", "constructor"].includes(methodMatch[1])) {
        funcName = methodMatch[1];
      }
    }

    // Constructor
    if (!funcName && trimmed.match(/^constructor\s*\(/)) {
      funcName = "constructor";
    }

    if (funcName) {
      // Find the function body by brace matching
      let braceCount = 0;
      let started = false;
      let endLine = i;
      const bodyLines: string[] = [];

      for (let j = i; j < lines.length; j++) {
        const l = lines[j];
        bodyLines.push(l);

        for (const ch of l) {
          if (ch === "{") {
            braceCount++;
            started = true;
          } else if (ch === "}") {
            braceCount--;
          }
        }

        if (started && braceCount === 0) {
          endLine = j;
          break;
        }
      }

      if (started) {
        functions.push({
          name: funcName,
          startLine: i + 1,
          endLine: endLine + 1,
          body: bodyLines.join("\n"),
        });
      }
    }
  }

  return functions;
}

function calculateCyclomaticComplexity(body: string): number {
  let complexity = 1; // base complexity

  // Remove strings and comments to avoid false positives
  const cleaned = body
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

  // Count decision points
  const patterns: Array<[RegExp, number]> = [
    [/\bif\b/g, 1],
    [/\belse\s+if\b/g, 0], // already counted by 'if' above; adjust: count just 'if'
    [/\bfor\b/g, 1],
    [/\bwhile\b/g, 1],
    [/\bcase\b/g, 1],
    [/\bcatch\b/g, 1],
    [/\?\?/g, 1],
    [/\?\./g, 0], // optional chaining, not a branch
    [/\bternary\b/g, 0],
    [/&&/g, 1],
    [/\|\|/g, 1],
  ];

  // Ternary operator (? not followed by ? or .)
  const ternaryPattern = /\?(?![?.:])/g;
  const ternaryMatches = cleaned.match(ternaryPattern);
  if (ternaryMatches) complexity += ternaryMatches.length;

  for (const [pattern, weight] of patterns) {
    const matches = cleaned.match(pattern);
    if (matches) complexity += matches.length * weight;
  }

  // Subtract double-counted "else if" (the 'if' part was already counted)
  // We already set else if weight to 0, so no adjustment needed

  return complexity;
}

function calculateMaxNesting(body: string): number {
  const lines = body.split("\n");
  let maxDepth = 0;
  let currentDepth = 0;
  // Track brace-based nesting after control flow keywords
  let prevHadControlFlow = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

    const hasControlFlow = /\b(if|else|for|while|switch|try|catch|finally)\b/.test(trimmed);

    for (const ch of trimmed) {
      if (ch === "{") {
        if (hasControlFlow || prevHadControlFlow) {
          currentDepth++;
          maxDepth = Math.max(maxDepth, currentDepth);
        }
      } else if (ch === "}") {
        if (currentDepth > 0) currentDepth--;
      }
    }
    prevHadControlFlow = hasControlFlow && !trimmed.includes("{");
  }

  return maxDepth;
}

export function analyzeComplexity(input: ComplexityAnalyzerInput): object {
  const { code, threshold, maxLines, maxNestingDepth } = input;
  const functions = extractFunctions(code);
  const results: FunctionInfo[] = [];

  for (const func of functions) {
    const lineCount = func.endLine - func.startLine + 1;
    const complexity = calculateCyclomaticComplexity(func.body);
    const nesting = calculateMaxNesting(func.body);
    const flags: string[] = [];

    if (complexity > threshold) {
      flags.push(
        `Cyclomatic complexity ${complexity} exceeds threshold of ${threshold}`
      );
    }
    if (lineCount > maxLines) {
      flags.push(
        `Function has ${lineCount} lines, exceeds maximum of ${maxLines}`
      );
    }
    if (nesting > maxNestingDepth) {
      flags.push(
        `Nesting depth ${nesting} exceeds maximum of ${maxNestingDepth}`
      );
    }

    results.push({
      name: func.name,
      startLine: func.startLine,
      endLine: func.endLine,
      lineCount,
      cyclomaticComplexity: complexity,
      maxNestingDepth: nesting,
      flags,
    });
  }

  const flaggedFunctions = results.filter((f) => f.flags.length > 0);
  const avgComplexity =
    results.length > 0
      ? Math.round(
          (results.reduce((sum, f) => sum + f.cyclomaticComplexity, 0) /
            results.length) *
            100
        ) / 100
      : 0;

  return {
    totalFunctions: results.length,
    flaggedCount: flaggedFunctions.length,
    averageComplexity: avgComplexity,
    thresholds: { complexity: threshold, maxLines, maxNestingDepth },
    functions: results,
    flaggedFunctions: flaggedFunctions.map((f) => ({
      name: f.name,
      line: f.startLine,
      flags: f.flags,
    })),
  };
}
