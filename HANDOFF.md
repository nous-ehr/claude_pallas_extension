# Handoff — 2026-08-10

State at the point of stopping, and what to pick up.

---

## Do this first

**Rotate the `stathenakb` storage account key.**

`az webapp config storage-account list` printed the key in plaintext to a
terminal during this session. It grants full read/write to every index —
`granite-staff`, `granite-developer`, `pallas-kb`, and the embedding model.

1. Portal → `stathenakb` → Access keys → Rotate **key1**
2. Re-add the two mounts, because App Service stores the key rather than
   referencing it:
   - `athena-agent` — mount `/mnt/kb`, share `athena-kb`
   - `pallas-mcp-server` — mount `/mnt/pallas-kb`, share `athena-kb`

Nothing else is blocked by this, but it should not wait.

---

## Live now

| | |
|---|---|
| **Web agent** | `athena-agent.azurewebsites.net` — 122,478 chunks, athenaOne only, Granite + BM25 hybrid |
| **Pallas MCP** | `pallas-mcp-server.azurewebsites.net` — **49,076 documents**, 12 tools, http/sse |
| Both plans | B2. Separate, so one restarting cannot take the other down |

Pallas health check:

```
curl https://pallas-mcp-server.azurewebsites.net/health
{"kbLoaded":true,"kbMeta":{"documentCount":49076,...},"toolCount":12}
```

---

## What changed today

**Pallas got the current corpus.** 1,943 documents dated 2026-04-13 → 49,076
dated today. Built by `athena_knowledge_base/build_pallas_kb.py`, which
reconstructs documents from the Granite serving index and preserves the Data
View schema entities (828 views, 16,183 columns, 1,299 relationships) from the
existing kb.json — that ingestion was fine and nothing here improves it.

| docType | Count |
|---|---:|
| best_practice | 37,378 |
| **error_pattern** | **3,557** |
| fhir | 2,358 |
| user_guide | 2,292 |
| api_endpoint | 2,052 |
| schema_reference | 880 |
| release_note | 559 |

`error_pattern` is documents carrying a workaround — classified across the whole
document rather than its first chunk, which had found 7 in a corpus holding
5,845 workarounds because a document's first chunk is its summary.

**Deployment**: `kb.json` uploaded to `athena-kb/pallas-kb/`, mounted on
`pallas-mcp-server` at `/mnt/pallas-kb`, with
`PALLAS_KB_PATH=/mnt/pallas-kb/pallas-kb`.

---

## Two corpus defects found, fixed for Pallas only

Both are still present in the **live web agent's** corpus. They do not break it —
it passes real passages to Claude — but part of its index is noise that can be
retrieved.

**Navigation chrome survived the O-help parser.** It stripped by exact
whole-line match, and `merge_prose` had already joined those lines into
paragraphs. It sits at the head of many documents, which is where snippets come
from: a search for "create a patient endpoint" returned *"Quick Links Tips and
Tricks for Searching and Printing O-help Content"* as its best evidence.

**14,115 chunks (8%) are verbatim duplicates** appearing five or more times:

| Count | Text |
|---:|---|
| ×2,191 | `Tell the customer:\n\nCustomer Notes:\nCustomer Details:` |
| ×2,186 | The O-help navigation block |
| ×2,077 | `null\n\nReferences\nPrerequisites:\n\nReferences:` |
| ×893 | `We're pleased to announce that this issue has been resolved…` |

Suppressed by repetition rather than a phrase list — text repeated identically
across thousands of documents is boilerplate by definition. 2,180 documents are
entirely boilerplate ("Classification Details" support-routing articles sharing
one 961-character body, differing only by title); those keep their title and
lose their body.

**To fix the agent's corpus** the same cleaning has to move into
`parse_ohelp_chunks.py` and `finalize_chunks_granite.py`, then the pipeline
re-runs: finalize (~30 min), embed (~36 min), serving indexes and BM25 (~10
min), upload (~5 min). Roughly 1.5 hours, and the eval should be re-run against
`granite_hybrid` afterwards to confirm it improved rather than assumed.

---

## Remaining Pallas work

1. **Rotate the key** (above)
2. **Retire the VS Code fork.** It bundles `mcp-server` v0.1.0 with 6 tools and
   stdio only; this repository has v0.2.0 with 12 tools and http/sse. That
   divergence is why the `undefined:` Data View bug exists in one and not the
   other. The VS Code extension should consume the published package
3. **Remove the tools' editorial layer.** `documentExcerpts` pre-joins three
   documents truncated at 600 characters; `integrationGuidance` is three
   hard-coded strings identical for every query. Both decide the answer before
   the agent sees anything. `sources[]` is already the right shape and stays;
   add `chunk_id` so the agent can fetch
4. **One telemetry destination.** Three exist: a Cloudflare Worker
   (`pallas-telemetry.nameappliedfor.workers.dev`, configured on the deployed
   server), `func-athena-feedback` on Azure, and `func-athena-feedback-8291`
   which was deleted 2026-08-08 and is still the extension default
5. **Publish 0.2.0** if the learning loop is unreleased — npm has 0.1.1, local
   packages are 0.2.0
6. **Fill `skills/`** — the directory exists and is empty
7. **Sites** — demo (`pallas_agent/templates/pallas.html`), analytics
   (`athena_agent/templates/analytics.html`), and both marketplace listings

---

## Things that cost time today, worth not repeating

**Three path bugs, all the same mistake.** `/tmp/pallas_test_kb` — Node on
Windows cannot resolve Git Bash's `/tmp`, so a local test read the *old bundled*
kb.json for several rounds while a data problem was chased that did not exist.
`/mnt/pallas-kb` — the mount is the share root, so the file was one directory
deeper than assumed. And `PALLAS_KB_PATH` on the server was already
`C:/Program Files/Git/home/site/wwwroot/data`, mangled by Git Bash before today.

The rule in `OPERATIONS.md` — set Azure paths from PowerShell, and read back
rather than trusting the exit code — applies to test harnesses too.

**Planning against an estate that was never surveyed.** An evening was spent
designing a hosted MCP server, a delivery mechanism, solution capture, a review
workflow and a provenance model. All five existed, deployed, published to npm
and listed in the MCP registry since April. The survey had started from the VS
Code extension because that is where the bad output appeared, and that is the
older fork. See `PALLAS_INVENTORY.md`.
