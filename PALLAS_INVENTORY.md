# Pallas — inventory

Surveyed 2026-08-10, after planning work that turned out to already exist.

**The headline: Pallas is much further along than it looked.** A hosted MCP
server is deployed and healthy, published to npm and listed in the official MCP
registry, with a learning loop whose tools are already written. What it lacks is
the current corpus, and there are two implementations of it drifting apart.

This document is what exists. `PALLAS_PLAN.md` in the VS Code repository needs
revising against it.

---

## What is deployed and working

| | |
|---|---|
| Host | `pallas-mcp-server.azurewebsites.net` |
| State | Running, `/health` 200, `/sse` 200 |
| Runtime | Node 20, `node server.cjs`, Always On |
| Transport | `http/sse` |
| Tools | **12** |
| Plan | `plan-pallas-mcp` — upgraded B1 → B2 on 2026-08-10 |
| Backing store | Cosmos `pallas-kb` (endpoint, key, database configured) |

```json
{"status":"healthy","kbLoaded":true,"toolCount":12,"transport":"http/sse",
 "kbMeta":{"documentCount":1943,"viewCount":828,"columnCount":16183,
           "relationshipCount":1299,"enumValueCount":241,"gotchaCount":5,
           "docsIngestedAt":"2026-04-13"}}
```

## Published, and already on a registry

| Channel | Identifier | Version | Published |
|---|---|---|---|
| npm | `pallas-athena-tools` | **0.1.1** | 2026-04-16 |
| MCP registry | `io.github.nous-ehr/athena-tools` | 0.1.1 | — |
| VS Code Marketplace | `AetherForgeus.athena-tools` | 0.1.8 | — |

The registry entry declares `stdio` transport and an npm package, so the
distribution question raised in planning was answered four months ago.

---

## Two MCP server implementations

This is the problem worth fixing first.

| | Claude extension | VS Code extension |
|---|---|---|
| Path | `pallas_claude_extension/packages/mcp-server` | `pallas_vscode_extension/packages/mcp-server` |
| Version | **0.2.0** | 0.1.0 |
| Tools | **12** | 6 |
| Transport | stdio **and** http/sse | stdio only |
| Learning loop | Yes | No |
| Deployed to Azure | **Yes** | No |
| Bundled into an extension | Via npm/registry | `dist/mcp-server.js` |

The VS Code extension ships a stale fork of a server the Claude extension owns
and deploys. That is how the `undefined:` Data View bug can exist in one and not
the other, and it will keep producing divergence for as long as both exist.

### The 12 tools

**Retrieval (6)** — present in both implementations:
`athena_search_kb`, `athena_explain_view`, `athena_explain_join`,
`athena_explain_workflow`, `athena_diagnose_error`, `athena_suggest_workflow`

**Learning loop (6)** — Claude extension only, deployed:

| Tool | Does |
|---|---|
| `athena_report_outcome` | Intent, artifact type, and whether the user accepted it (`yes` / `no` / `edited` / `unknown`) |
| `athena_submit_feedback` | Whether the interaction resolved successfully |
| `athena_list_candidates` | The review queue, filterable by status |
| `athena_review_candidate` | Confirm or reject a candidate |
| `athena_report_safety_flag` | Safety concerns |
| `athena_command_start` | Marks the start of an interaction |

**The capture loop specified in planning already exists.** `athena_report_outcome`
is the tool that was designed on 2026-08-10 and written before April.

### Supporting code

```
learning/classifier.ts      learning/cosmosClient.ts
learning/eventCapture.ts    learning/installId.ts
learning/telemetryPipe.ts   types/provenance.ts
```

`types/provenance.ts` defines `Provenance { source, sourceTier, confidence,
lastVerified }` — the provenance model, already typed.

---

## Surfaces

| Surface | Where | State |
|---|---|---|
| Claude Code commands | `pallas_claude_extension/commands/` — 9 files | `athena-api`, `diagnose`, `explain`, `onboard`, `review-athena`, `review-candidates`, `sql`, `validate`, `workflow` |
| Claude Code skills | `skills/` | Empty |
| VS Code chat participant | `pallas_vscode_extension` | `/search`, `/explain`, `/diagnose`, `/join` |
| CLI | `packages/cli` v0.2.0 | Ships as `pallas-athena-tools` |

---

## Data and telemetry

**The shipped knowledge base** is `data/kb.json`, 27 MB, dated 2026-04-16 —
1,943 documents. The current corpus is 45,135 documents and 173,719 chunks.
Pallas is serving roughly 4% of it, four months stale.

The Data View half is in better shape than the rest: 828 of 881 views, 16,183
columns, 1,299 relationships, 241 enum values. That ingestion worked.

**Three telemetry destinations exist**, which is two too many:

| Destination | Where | Status |
|---|---|---|
| `pallas-telemetry.nameappliedfor.workers.dev` | Cloudflare Worker, in-repo with `schema.sql` | Configured on the deployed server |
| `func-athena-feedback.azurewebsites.net` | Azure Function | Live, Cosmos-backed |
| `func-athena-feedback-8291` | — | **Deleted 2026-08-08**, still the extension default |

---

## Version skew

| Artifact | Version |
|---|---|
| npm published | 0.1.1 |
| `server.json` (registry manifest) | 0.1.1 |
| Local `packages/cli` | **0.2.0** |
| Local `packages/mcp-server` | **0.2.0** |
| VS Code extension | 0.1.8 |
| VS Code's bundled server | 0.1.0 |

Local is a minor version ahead of what is published. The learning loop may be
part of the unreleased 0.2.0 rather than of what users currently run — worth
confirming before assuming deployed equals distributed.

---

## What is actually missing

Much shorter than the plan assumed:

1. **Current corpus.** 1,943 documents → 45,135. The ingestion path expects
   `kb.json`; the Granite corpus is chunks plus vectors. Either regenerate
   `kb.json` from it, or teach the server to read the serving index.
2. **One server, not two.** Retire the VS Code fork; consume the published
   package.
3. **Remove the editorial layer.** `documentExcerpts` and `integrationGuidance`
   pre-format and truncate before the agent sees anything — measured, see
   `PALLAS_PLAN.md` Phase 2.
4. **One telemetry destination.** Three exist; one is deleted and still the
   default.
5. **Publish 0.2.0** if the learning loop is unreleased.
6. **Fill `skills/`** — the directory exists and is empty.

---

## Corrections to the plan written earlier today

| Planned as new work | Reality |
|---|---|
| Build a hosted MCP server | Deployed, healthy, 12 tools, SSE |
| Choose a delivery mechanism | npm + MCP registry, published April |
| Design solution capture | `athena_report_outcome` exists |
| Design a review workflow | `athena_list_candidates` / `athena_review_candidate` exist |
| Design a provenance model | `types/provenance.ts` exists |
| Decide hosting | Done, and B2 since today |

The plan's Phase 3 in particular — "the part with no existing equivalent" — was
wrong. It has an existing equivalent, written and deployed.

**Why this happened:** the survey went from the VS Code extension outward,
because that is where the bad output appeared. The VS Code extension holds the
older, smaller fork. Everything current lives in the Claude repository, in a
different GitHub organisation, and nothing pointed from one to the other.

Documenting the estate before planning against it would have cost an hour and
saved an evening.
