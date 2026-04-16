# Pallas — athenahealth Integration Engineer for Claude Code

A Claude Code extension that embeds a senior athenahealth integration engineer in your development workflow. Proactively catches data loss bugs, teaches clinical context, guides you through safe DataView queries and API integrations, and **gets smarter from every interaction** through a built-in learning loop.

## Try It in 30 Seconds

No install needed. Add this to any project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "athena-tools": {
      "url": "https://pallas-mcp-server.azurewebsites.net/sse"
    }
  }
}
```

Then open Claude Code and ask: *"How do I safely join PATIENT to CHART in DataView?"*

This gives you all 9 MCP tools via the hosted server. For the full experience (slash commands, proactive safety rules, CLAUDE.md guidance), use the install method below.

## Full Install

```bash
npx @nous-ehr/athena-tools setup
```

This installs to your user-level Claude Code config (`~/.claude/`):
- 9 MCP tools connected to the hosted knowledge base
- 9 slash commands (`/sql`, `/athena-api`, `/onboard`, `/diagnose`, etc.)
- CLAUDE.md with proactive safety rules and clinical context

Works in **every project** — no per-project configuration needed.

### Other CLI commands

```bash
npx @nous-ehr/athena-tools status      # Check installation
npx @nous-ehr/athena-tools uninstall   # Remove everything
```

## What It Does

- **Proactive safety** — Flags unsafe joins (46% data loss from PATIENTID/CHARTID mismatch), missing soft-delete filters, hardcoded credentials, and CONTEXTID issues
- **Teaches the "why"** — Not just "add this filter" but "here's why deleted records exist in healthcare and what happens if you include them"
- **Knowledge base** — 828 DataView views, 16K+ columns, 1.3K FK relationships, 1.9K API/FHIR/workflow docs
- **Learning loop** — Every interaction feeds lessons back to the KB. Low-risk patterns auto-merge; high-risk discoveries go through human review
- **Working examples** — Annotated SQL queries and API code templates in Python, TypeScript, and C#

## Slash Commands

| Command | Description |
|---|---|
| `/onboard` | Guided onboarding for new athenahealth developers |
| `/sql <query>` | Generate safe DataView SQL with CONTEXTID, soft-delete, and correct joins |
| `/athena-api <goal>` | Generate API integration code with OAuth, retry, and error handling |
| `/diagnose <error>` | Diagnose API or DataView errors with root cause explanation |
| `/review-athena` | Scan project for athenahealth anti-patterns and safety issues |
| `/validate` | Pre-deployment safety check |
| `/explain <concept>` | Deep-dive explanation of any athenahealth concept |
| `/workflow <name>` | End-to-end clinical/admin workflow guidance |
| `/review-candidates` | Review and approve/reject pending KB update candidates |

## MCP Tools

| Tool | Description |
|---|---|
| `athena_search_kb` | Full-text search across the knowledge base |
| `athena_explain_view` | DataView view schema, columns, relationships, and gotchas |
| `athena_explain_join` | Safe join path between two views with identity chain warnings |
| `athena_diagnose_error` | Error diagnosis with likely causes and fixes |
| `athena_explain_workflow` | Clinical/admin workflow documentation |
| `athena_suggest_workflow` | Recommended integration approach with anti-pattern detection |
| `athena_submit_feedback` | Report learned patterns back to the KB (learning loop) |
| `athena_list_candidates` | List pending KB update candidates for review |
| `athena_review_candidate` | Approve or reject a KB update candidate |

## Learning Loop

The extension gets smarter from every developer interaction:

```
Developer uses Claude Code for athenahealth work
    ↓
Claude calls KB tools (search, explain, diagnose)
    → Each call is recorded (tool, duration, success/failure)
    ↓
Developer's issue is resolved
    ↓
Claude submits feedback: what worked, what was learned
    ↓
Classifier evaluates risk:
    Low risk (error patterns, gotchas) → auto-merged, confidence 0.3
    High risk (schema, identity)       → queued for human review
    ↓
Reviewer approves → promoted to KB, confidence 0.7
    ↓
Next developer benefits from this knowledge
```

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 9+
- [Claude Code](https://claude.ai/code)

### Local Development

```bash
git clone https://github.com/nous-ehr/claude_pallas_extension.git
cd claude_pallas_extension
pnpm install
pnpm build
claude    # Opens Claude Code with local MCP server
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PALLAS_KB_PATH` | `./data` | Path to directory containing `kb.json` |
| `PALLAS_LOG_LEVEL` | `error` | Log level: `error`, `warn`, `info`, `debug` |
| `PALLAS_TRANSPORT` | `stdio` | Transport: `stdio` (local) or `http` (Azure) |
| `PALLAS_PORT` | `8080` | Port for HTTP transport |
| `COSMOS_ENDPOINT` | — | Azure Cosmos DB endpoint (enables learning loop) |
| `COSMOS_KEY` | — | Azure Cosmos DB key |
| `COSMOS_DATABASE` | `pallas-kb` | Cosmos DB database name |

### Project Structure

```
pallas_claude_extension/
├── CLAUDE.md                     # "Senior engineer" brain
├── data/kb.json                  # Knowledge base (828 views, 16K columns, 1.9K docs)
├── examples/                     # Annotated SQL + API code templates
├── .claude/
│   ├── settings.json             # MCP server config
│   └── commands/                 # 9 slash commands
├── packages/
│   ├── mcp-server/               # MCP server (9 tools, dual transport)
│   │   └── src/
│   │       ├── server.ts         # stdio + HTTP/SSE
│   │       ├── db/kbStore.ts     # KB with MiniSearch
│   │       ├── tools/            # 9 tool implementations
│   │       └── learning/         # Event capture, classifier, Cosmos DB
│   └── cli/                      # npm package installer
└── .github/workflows/deploy.yml  # Auto-deploy to Azure on push
```

## Architecture

This extension is **fully independent** from the Athena Tools VS Code extension. They share the same knowledge base source data but have separate codebases, separate deployments, and separate evolution paths. Neither can break the other.

## License

MIT
