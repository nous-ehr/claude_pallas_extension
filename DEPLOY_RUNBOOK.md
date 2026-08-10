# Tonight's runbook — Pallas deploy and extension upgrade

Written 2026-08-10, for execution out of office hours.

**The web agent is not touched by any of this** except step 1, which briefly
restarts it. Its corpus stays as it is — it answers well, and the next change to
it is the embedding and reranker rework, not a re-index.

Three phases, each independently useful. Stop after any of them.

| Phase | What | Duration | Restarts |
|---|---|---|---|
| 1 | Rotate the storage key, remount both services | ~20 min | both |
| 2 | Deploy Pallas: new KB and rebuilt server | ~30 min | Pallas |
| 3 | Upgrade the extensions | ~60 min | none |

---

## Phase 1 — Rotate the storage key

Do this first. It is the only step that touches the agent, and finding a problem
here before a deploy is layered on top is worth the ordering.

`stathenakb`'s key was printed in plaintext during a session on 2026-08-10. It
grants full read/write to every index.

**1.1** Portal → `stathenakb` → Access keys → Rotate **key1**.

**1.2** Both mounts break immediately — App Service stores the key rather than
referencing it. Re-add each. From **PowerShell**, never Git Bash, which rewrites
`/mnt/...` into `C:/Program Files/Git/mnt/...`:

```powershell
$key = az storage account keys list -g athena -n stathenakb `
       --query "[0].value" -o tsv --only-show-errors

az webapp config storage-account add -g athena -n athena-agent `
  --custom-id kb --storage-type AzureFiles --share-name athena-kb `
  --account-name stathenakb --access-key $key --mount-path /mnt/kb

az webapp config storage-account add -g athena -n pallas-mcp-server `
  --custom-id pallaskb --storage-type AzureFiles --share-name athena-kb `
  --account-name stathenakb --access-key $key --mount-path /mnt/pallas-kb
```

Do **not** run `az webapp config storage-account list` — it prints the key to
stdout, which is how it leaked.

**1.3** Verify. The agent takes 2–5 minutes to reload its index over SMB.

```bash
curl -s https://athena-agent.azurewebsites.net/stats
# expect total_documents 122478

curl -s https://pallas-mcp-server.azurewebsites.net/health
# expect kbLoaded true
```

**Rollback:** Azure keeps key2 valid through a key1 rotation. If a mount will
not come back, re-add with key2 and investigate without the site down.

---

## Phase 2 — Deploy Pallas

Two artifacts: the knowledge base, and the server that reads it.

### 2.1 Upload the knowledge base

```bash
cd D:/athena_knowledge_base
python build_pallas_kb.py --in kb-serve-developer \
    --existing D:/pallas_claude_extension/data/kb.json --out pallas_kb.json
python build_pallas_endpoints.py --into pallas_kb.json

az storage file upload --account-name stathenakb --share-name athena-kb \
  --source pallas_kb.json --path pallas-kb/kb.json --only-show-errors
```

Expect 48,195 documents, 891 endpoints, ~97 MB.

**Verify the byte count matches** before moving on — it is the only reliable
check that an upload completed:

```bash
az storage file list --account-name stathenakb --share-name athena-kb \
  --path pallas-kb -o tsv --query "[].{n:name,s:properties.contentLength}"
```

### 2.2 Deploy the server

The running server is a build from April. It has no `athena_explain_endpoint`,
no endpoint entities, and still returns `documentExcerpts`.

```bash
cd D:/pallas_claude_extension/packages/mcp-server
npm run typecheck && npm run build
```

Package and deploy however `deploy.zip` was produced in April — that mechanism
is not recorded anywhere, so **check it before assuming**. `WEBSITE_RUN_FROM_PACKAGE`
is set on the app, so the deployment is a package rather than a file copy.

### 2.3 Verify

```bash
curl -s https://pallas-mcp-server.azurewebsites.net/health
```

Expect `kbLoaded: true`, `documentCount: 48195`, `toolCount: 13`.

Then the thing that actually matters — a coding agent's question:

```
athena_explain_endpoint("postPracticeidPatients", includeOptional: false)

expect:
  POST /v1/{practiceid}/patients
  required: practiceid, Content-Type, departmentid, dob, firstname, lastname
  omittedOptional: 109
```

**Rollback:** set `PALLAS_KB_PATH` back to `/home/site/wwwroot/data`, which is
the April KB bundled in the package. One setting, no redeploy.

---

## Phase 3 — Extensions

Two extensions, one server. The point of this phase is that there stops being
two implementations.

### 3.1 Claude extension — publish 0.2.0

npm has 0.1.1; local packages are 0.2.0 and now carry the endpoint work. The
learning loop may never have shipped.

```bash
cd D:/pallas_claude_extension
# confirm first: does 0.1.1 already contain the learning-loop tools?
npm view pallas-athena-tools@0.1.1 --json | grep -i version
```

Then bump `server.json` to match, publish to npm, and update the MCP registry
entry with `mcp-publisher.exe`. The registry lists
`io.github.nous-ehr/athena-tools` at 0.1.1 and should not be left behind npm.

**Verify:** `npx pallas-athena-tools@latest` starts and lists 13 tools.

### 3.2 VS Code extension — stop forking the server

This is the substantive change. `athena-tools` v0.1.8 bundles its own
`dist/mcp-server.js` — v0.1.0, 6 tools, stdio only — and spawns it with
`context.asAbsolutePath('dist/mcp-server.js')` against a local `kb.json`. That
fork is why the `undefined:` Data View bug lives in one extension and not the
other.

Two ways to end it. **Decide before starting**, they are different jobs:

| | Effort | Result |
|---|---|---|
| **A. Bundle the published package** | Smaller | Extension depends on `pallas-athena-tools`, still spawns locally, still needs a local KB |
| **B. Point at the hosted server** | Larger | `StdioClientTransport` → SSE against `pallas-mcp-server`, no local KB, no 97 MB download, updates reach users without a release |

B is the architecture already decided and already deployed, and it removes the
local KB entirely. It also introduces two things that do not exist today:
authentication on the endpoint, and a network dependency — offline stops
working. Neither is hard; both should be deliberate.

There is currently **no auth on `pallas-mcp-server`**. Before pointing an
extension at it, decide whether it should be open. It serves athenahealth's
login-gated documentation.

**Verify:** in VS Code, `@athena /explain what is encounter workflow` returns
current athenaOne content with no navigation chrome, and Data View views with
real names or none at all.

Publishing needs Marketplace access to publisher `AetherForgeus` — **confirm
that works before doing the work**.

---

## What is deliberately not in tonight

- **The agent's corpus.** It carries the same surviving nav chrome and 14,115
  duplicate chunks that were cleaned for Pallas. It answers well; the next
  change to it is the embedding and reranker rework, and re-indexing twice for
  the same corpus would be wasted.
- **A Pallas eval.** Nothing shipped tonight has been measured — every change is
  justified by argument. The agent has 42 questions precisely because that kept
  going wrong. Pallas should get the same before much more is built on it.
- **`/api/support`** — one FAQ page the parser cannot read, since it uses
  `faqSections` rather than `body`.
- **Telemetry consolidation.** Three destinations exist: a Cloudflare Worker
  configured on the deployed server, `func-athena-feedback` on Azure, and
  `func-athena-feedback-8291`, deleted 2026-08-08 and still the extension
  default.

---

## Traps, all of which have already cost time here

**Git Bash rewrites Linux paths.** `/mnt/pallas-kb` becomes
`C:/Program Files/Git/mnt/pallas-kb`. Set Azure paths from PowerShell and read
them back.

**A mount is the share root.** `--mount-path /mnt/pallas-kb --share-name athena-kb`
puts the *share* there, so `kb.json` is at `/mnt/pallas-kb/pallas-kb/kb.json`.

**Node cannot resolve Git Bash paths.** A test using `/tmp/...` silently read a
different file for several rounds.

**Compare identifiers, not strings.** Pages appear under alias URLs and
canonical URLs; four separate "missing content" alarms today were the same
content under a different name.

**Azure CLI resets connections.** Wrap anything that matters in a retry and read
the result back rather than trusting the exit code.
