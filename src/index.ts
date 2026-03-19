#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { codeStyleSchema, checkCodeStyle } from "./tools/code-style.js";
import {
  namingConventionSchema,
  checkNamingConventions,
} from "./tools/naming-convention.js";
import {
  complexityAnalyzerSchema,
  analyzeComplexity,
} from "./tools/complexity-analyzer.js";
import { deadCodeFinderSchema, findDeadCode } from "./tools/dead-code-finder.js";
import { importAnalyzerSchema, analyzeImports } from "./tools/import-analyzer.js";

const server = new McpServer({
  name: "mcp-lint-tools",
  version: "1.0.0",
});

// Tool 1: Code Style Checker
server.tool(
  "check_code_style",
  "Check code style issues: indentation (tabs vs spaces), line length, trailing whitespace, final newline, consistent quotes, and semicolons. All rules are configurable.",
  codeStyleSchema.shape,
  async (args) => {
    const result = checkCodeStyle(args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Tool 2: Naming Convention Checker
server.tool(
  "check_naming_conventions",
  "Check naming conventions in code: camelCase, PascalCase, snake_case, UPPER_CASE. Detects mixed conventions within the same identifier kind and suggests fixes. Language-aware for TypeScript, JavaScript, Python, and Go.",
  namingConventionSchema.shape,
  async (args) => {
    const result = checkNamingConventions(args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Tool 3: Complexity Analyzer
server.tool(
  "analyze_complexity",
  "Calculate cyclomatic complexity of functions, count lines per function, and measure nesting depth. Flags functions that exceed configurable thresholds.",
  complexityAnalyzerSchema.shape,
  async (args) => {
    const result = analyzeComplexity(args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Tool 4: Dead Code Finder
server.tool(
  "find_dead_code",
  "Find potential dead code: unused variables, unreachable code after return/throw, empty catch blocks, commented-out code blocks, and TODO/FIXME/HACK comments.",
  deadCodeFinderSchema.shape,
  async (args) => {
    const result = findDeadCode(args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Tool 5: Import Analyzer
server.tool(
  "analyze_imports",
  "Analyze imports: detect unused imports, check import ordering by group (builtin/external/internal/parent/sibling/index), find duplicate imports, and flag potential circular dependencies.",
  importAnalyzerSchema.shape,
  async (args) => {
    const result = analyzeImports(args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
