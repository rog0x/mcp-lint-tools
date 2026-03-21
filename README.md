[![MCP Server](https://glama.ai/mcp/servers/rog0x/mcp-lint-tools/badges/score.svg)](https://glama.ai/mcp/servers/rog0x/mcp-lint-tools)

# @rog0x/mcp-lint-tools

Code linting and style checking tools for AI agents, exposed as an MCP (Model Context Protocol) server.

All analysis is performed via regex and text parsing — no AST libraries required.

## Tools

### check_code_style

Check code style issues with configurable rules:

- **Indentation** — tabs vs spaces, configurable indent size
- **Line length** — flag lines exceeding a maximum length
- **Trailing whitespace** — detect trailing spaces/tabs
- **Final newline** — require a newline at end of file
- **Quotes** — enforce single or double quote consistency
- **Semicolons** — enforce always or never semicolon usage

### check_naming_conventions

Analyze identifier naming conventions:

- Detect **camelCase**, **PascalCase**, **snake_case**, **UPPER_CASE**
- Language-aware rules for TypeScript, JavaScript, Python, Go
- Flag **mixed conventions** within the same identifier kind
- **Suggest fixes** with automatic name conversion

### analyze_complexity

Measure code complexity metrics:

- **Cyclomatic complexity** per function
- **Lines per function** count
- **Nesting depth** measurement
- Configurable thresholds for flagging

### find_dead_code

Detect potential dead code:

- **Unused variables** — declared but never referenced
- **Unreachable code** — statements after return/throw/break
- **Empty catch blocks** — silently swallowed errors
- **Commented-out code** — blocks of commented code
- **TODO/FIXME/HACK** — annotation comments

### analyze_imports

Analyze import statements:

- **Unused imports** — imported names not referenced in code
- **Import ordering** — enforce group ordering (builtin > external > internal > relative)
- **Duplicate imports** — same module imported multiple times
- **Circular dependency hints** — basic detection of potential cycles

## Installation

```bash
npm install
npm run build
```

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lint-tools": {
      "command": "node",
      "args": ["path/to/mcp-lint-tools/dist/index.js"]
    }
  }
}
```

## Development

```bash
npm install
npm run build
npm start
```

## License

MIT
