# Handoff — 2026-08-10, end of day

Supersedes the earlier version written before tonight's deploy. That one told
you to rotate a key that is now rotated and described a Pallas KB that has since
been replaced.

**Both services are live and healthy. Nothing is blocked.**

---

## Live now

| | Web agent | Pallas MCP |
|---|---|---|
| URL | `athena-agent.azurewebsites.net` | `pallas-mcp-server.azurewebsites.net` |
| Serves | **122,478 chunks**, athenaOne only | **48,195 documents + 891 endpoints**, 13 tools |
| Transport | HTTPS / Flask | http/sse (`/sse`, `/messages?sessionId=`) |
| Reads | `/mnt/kb/granite-staff` | `/mnt/pallas-kb/pallas-kb/kb.json` |
| Plan | `plan-athena` (B2) | `plan-pallas-mcp` (B2) |
| Deploys by | GitHub Actions on push to `master` | GitHub Actions on push to `main` |
| Health | `/stats` | `/health` |

Separate plans deliberately: one restarting must not take the other down.

Verified live tonight:

```
athena_explain_endpoint("postPracticeidPatients", includeOptional: false)
  POST /v1/{practiceid}/patients
  required: practiceid, Content-Type, departmentid, dob, firstname, lastname
  omittedOptional: 109
```

---

## Done tonight

**Storage key rotated.** `stathenakb` key1 had been printed in plaintext during
a session. Rotated, and both mounts updated. Key2 remains valid as a fallback.

Two things worth knowing for next time:

- The mount configs still existed with the stale key, so this needs
  `az webapp config storage-account update`, **not** `add` — `add` fails with
  "Site already configured with an Azure storage account with the id 'kb'".
- Never run `az webapp config storage-account list`. It prints the key to
  stdout, which is how it leaked in the first place.

**Pallas KB replaced.** 1,943 documents dated 2026-04-13 → 48,195 current, plus
891 endpoint entities carrying 5,664 typed parameters.

**The server deploy is automated.** `.github/workflows/deploy.yml` builds and
deploys on push to `main`, and had already shipped the new build hours before
the manual runbook step was reached. It has **no verify step**, unlike the
agent's — it reports success without checking the server came back.

---

## Asset inventory

### Repositories

| Repo | Host | Head | Role |
|---|---|---|---|
| `athena_agent` | GitHub `PatrickRutledge` | `35f4262` | Web agent. Deploys to App Service |
| `athena_knowledge_base` | **GitLab** `hometeamapps` | `5c84bf3` | Corpus, scrapers, chunkers, builders |
| `pallas_claude_extension` | GitHub **`nous-ehr`** | `b22d885` | **The real MCP server** (v0.2.0, 12→13 tools) + Claude commands |
| `pallas_vscode_extension` | GitHub `PatrickRutledge` | `732aab9` | VS Code `athena-tools` v0.1.8. Bundles a **stale fork** |
| `athena-kb-agents` | GitHub `PatrickRutledge` | `9475f5b8` | Monorepo — subtree grafts of all four |

Plus a submodule: `pallas_vscode_extension/public-repo/athenatools_vscode` →
`github.com/microsoft-aetherforge/athenatools_vscode`, holding public extension
assets. One uncommitted logo change sits there.

**Three GitHub organisations and two hosts for one project.** Consolidating is a
decision, not a task.

### Published artifacts

| Channel | Identifier | Version | Note |
|---|---|---|---|
| npm | `pallas-athena-tools` | **0.1.1** | Local packages are 0.2.0 — ahead of published |
| MCP registry | `io.github.nous-ehr/athena-tools` | 0.1.1 | Listed since April |
| VS Code Marketplace | `AetherForgeus.athena-tools` | 0.1.8 | Stale fork inside |

### Azure — resource group `athena`

| Resource | Purpose |
|---|---|
| `athena-agent` | Web agent (App Service) |
| `pallas-mcp-server` | Pallas MCP (App Service) |
| `plan-athena`, `plan-pallas-mcp` | B2 each |
| `stathenakb` | Storage. Share `athena-kb`, 10 GB quota |
| `pallas-kb-cosmos` | Cosmos, serverless. Database `pallas-kb`. Vector search **not** enabled |
| `func-athena-feedback` | Feedback ingestion, Cosmos-backed |
| `kv-athena-bf` | Key Vault |
| `stathenafeedback` | Storage for the feedback function |
| 3 × `oidc-msi-*` | Orphaned managed identities — safe to remove |

### Azure Files — share `athena-kb`

| Path | Contents | Status |
|---|---|---|
| `granite-staff/` | 122,478 chunks, athenaOne | **Live** — agent |
| `pallas-kb/kb.json` | 48,195 docs + 891 endpoints, 97 MB | **Live** — Pallas |
| `granite-developer/` | 173,719 chunks, all strata | Built, used only to generate Pallas's KB |
| `models/granite-small/` | Embedding model, 186 MB | **Live** — agent |
| `index/` | MiniLM, 6,780 docs | Agent rollback target |
| `index_developer/`, `corpus/` | Superseded | |

### Corpus versions

| Version | What | Where |
|---|---|---|
| **Granite** (current) | 173,719 chunks, 512-token, Granite Small 384-dim | `kb-serve-staff`, `kb-serve-developer` |
| MiniLM (previous) | 53,614 chunks over 9,210 docs | `index/`, `index_developer/` — rollback |
| Pallas `kb.json` | 48,195 docs, 891 endpoints, 828 views, 16,183 columns | `pallas-kb/` |

Source corpora, ~270 MB and the irreplaceable part, live in
`D:\athena_knowledge_base`: `docs_success_coveo/` (41,346),
`docs_devportal_raw/` (762), `docs_dataview/` (881), `docs_fhir_r4/` (845),
`dataview_schema/` (CSV exports), plus O-help HTML in `athena_agent/docs/`.

### Models

| Role | Model |
|---|---|
| Embedding | `ibm-granite/granite-embedding-small-english-r2` — 384-dim, 512-token cap |
| Generation | `claude-sonnet-4-5-20250929` |
| Legacy embedding | `all-MiniLM-L6-v2` — baseline, retained |
| Reranker | `ibm-granite/granite-embedding-reranker-english-r2` — built, measured, **not deployed** |

---

## Documentation

| Document | Where | Covers |
|---|---|---|
| `README.md` | `athena-kb-agents` | Architecture, models, how they were tested |
| `HISTORY.md` | `athena-kb-agents` | How it got here, and seven claims made before measuring that were wrong |
| `DATA.md` | `athena-kb-agents` | Every source, provenance, transformation |
| `INVENTORY.md` | `athena-kb-agents` | Directories, orphans, ~5.7 GB reclaimable |
| `FUTURE_WORK.md` | `athena-kb-agents` | Deferred work, candidate models, fine-tuning |
| `OPERATIONS.md` | `athena-kb-agents` | Refresh, deploy, rollback, traps |
| `PALLAS_INVENTORY.md` | `pallas_claude_extension` | What already existed before planning against it |
| `DEPLOY_RUNBOOK.md` | `pallas_claude_extension` | Phases 1–2 now **done**; phase 3 outstanding |
| `PALLAS_PLAN.md` | `pallas_vscode_extension` | Corpus, tools, capture, sites |

---

## Next: the VS Code extension

The only substantial piece left. Three things to decide **before** code:

**1. Auth on `pallas-mcp-server`.** There is none. It was called anonymously
from a script tonight and returned athenahealth's login-gated documentation. A
shared key in extension settings is cheap; per-user tokens are correct. This
gates everything else.

**2. Bundle or remote.** Bundle `pallas-athena-tools@0.2.0` (smaller change,
still needs a local KB), or point at the hosted SSE server (larger, deletes the
local KB, the `buildKb` command and three settings — and corpus updates then
reach users without a Marketplace release). Remote is the architecture already
chosen and deployed.

**3. Marketplace access to `AetherForgeus`.** Needs a PAT with publish scope
from Azure DevOps. Confirm it still works before doing the work.

Then, regardless: `feedbackEndpointUrl` still defaults to
`func-athena-feedback-8291`, deleted 2026-08-08 — live is
`func-athena-feedback.azurewebsites.net/api/feedback`. Version bump. New
screenshots, because the current ones show the `undefined:` output that has
since been fixed.

## Also outstanding

- **Pallas has no eval.** Nothing shipped today was measured — every change is
  justified by argument. The agent has 42 questions precisely because asserting
  improvement kept going wrong. Pallas should get the same.
- **Demo and analytics sites** — `pallas_agent/templates/pallas.html` and
  `athena_agent/templates/analytics.html` exist, neither deployed for Pallas.
- **Three telemetry destinations** — a Cloudflare Worker on the deployed server,
  `func-athena-feedback`, and the deleted one still set as the extension
  default.
- **Publish 0.2.0** to npm and the MCP registry; local is ahead.
- **`skills/`** is empty.
- **`/api/support`** uses `faqSections` rather than `body`; the parser skips it.
- **The agent's corpus** carries surviving nav chrome and 14,115 duplicate
  chunks, both cleaned for Pallas only. Deliberately not fixed — it answers
  well, and the next change to it is the embedding and reranker rework.
- **~5.7 GB reclaimable** locally, listed in `INVENTORY.md`.

## Traps that cost time today

**Compare identifiers, not strings.** Four separate "missing content" alarms
were the same content under a different name — alias URLs versus canonical URLs,
percent-encoded versus not.

**Git Bash rewrites Linux paths.** `/mnt/...` becomes
`C:/Program Files/Git/mnt/...`. Set Azure paths from PowerShell and read back.

**Node cannot resolve Git Bash paths.** A test harness using `/tmp/...` silently
read a stale file for several rounds while a data problem was chased that did
not exist.

**A mount is the share root.** `--mount-path /mnt/pallas-kb --share-name athena-kb`
puts the share there, so the file is at `/mnt/pallas-kb/pallas-kb/kb.json`.

**Survey before planning.** An evening was spent designing a hosted MCP server,
a delivery mechanism, solution capture, a review workflow and a provenance
model. All five already existed and were deployed.
