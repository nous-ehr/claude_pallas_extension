# Pallas — athenahealth Integration Engineer for Claude Code

A Claude Code extension that embeds a senior athenahealth integration engineer in your development workflow. Proactively catches data loss bugs, teaches clinical context, and guides you through safe DataView queries and API integrations.

## What It Does

- **Proactive safety** — Flags unsafe joins, missing soft-delete filters, hardcoded credentials, and CONTEXTID issues before you ship
- **Knowledge base** — 828 DataView views, 16K+ columns, 1.3K FK relationships, 1.9K API/FHIR/workflow docs
- **Slash commands** — `/sql`, `/athena-api`, `/diagnose`, `/review-athena`, `/validate`, `/onboard`, `/explain`, `/workflow`
- **Working examples** — Annotated SQL queries and API code templates in Python, TypeScript, and C#

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 9+
- [Claude Code](https://claude.ai/code)

## Setup

```bash
# Install dependencies
pnpm install

# Build the MCP server
pnpm build

# Open Claude Code in this directory
claude
```

Claude Code will automatically start the MCP server and load the knowledge base.

## Available Slash Commands

| Command | Description |
|---|---|
| `/onboard` | Guided onboarding for new athenahealth developers |
| `/sql <query description>` | Generate safe DataView SQL with CONTEXTID, soft-delete, and correct joins |
| `/athena-api <integration goal>` | Generate API integration code with OAuth, retry, and error handling |
| `/diagnose <error>` | Diagnose API or DataView errors with root cause explanation |
| `/review-athena` | Scan project for athenahealth anti-patterns and safety issues |
| `/validate` | Pre-deployment safety check |
| `/explain <concept>` | Deep-dive explanation of any athenahealth concept |
| `/workflow <name>` | End-to-end clinical/admin workflow guidance |

## MCP Tools

The following tools are available to Claude Code:

| Tool | Description |
|---|---|
| `athena_search_kb` | Full-text search across the knowledge base |
| `athena_explain_view` | Detailed DataView view schema, columns, and gotchas |
| `athena_explain_join` | Safe join path between two views with warnings |
| `athena_diagnose_error` | Error diagnosis with likely causes and fixes |
| `athena_explain_workflow` | Clinical/admin workflow documentation |
| `athena_suggest_workflow` | Recommended integration approach for a goal |

## Configuration

### Knowledge Base Path

The MCP server looks for `kb.json` in the path specified by `PALLAS_KB_PATH`. Default: `./data/`.

To use a different KB, edit `.claude/settings.json`:

```json
{
  "mcpServers": {
    "athena-tools": {
      "env": {
        "PALLAS_KB_PATH": "/path/to/your/kb/directory"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PALLAS_KB_PATH` | `~/pallas-kb` | Path to directory containing `kb.json` |
| `PALLAS_LOG_LEVEL` | `error` | Log level: `error`, `warn`, `info`, `debug` |
| `PALLAS_TRANSPORT` | `stdio` | Transport: `stdio` (local) or `http` (Azure deployment) |
| `PALLAS_PORT` | `8080` | Port for HTTP transport |

## Project Structure

```
pallas_claude_extension/
├── CLAUDE.md                 # "Senior engineer" brain — proactive rules, clinical context
├── data/kb.json              # Knowledge base (828 views, 16K columns, 1.9K docs)
├── examples/
│   ├── dataview/             # Annotated SQL examples
│   └── api/                  # API code templates (Python, TypeScript, C#)
├── .claude/
│   ├── settings.json         # MCP server config
│   └── commands/             # 8 slash commands
└── packages/mcp-server/      # Self-contained MCP server
    └── src/
        ├── server.ts         # Dual transport: stdio + HTTP/SSE
        ├── db/kbStore.ts     # KB loader with MiniSearch
        └── tools/            # 6 MCP tool implementations
```

## Architecture

This extension is **fully independent** from the Athena Tools VS Code extension. They share the same knowledge base source data but have separate codebases, separate deployments, and separate evolution paths. Neither can break the other.
