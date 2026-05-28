# Privacy Policy — Pallas (athena-tools)

**Last updated**: 2026-05-28
**Applies to**: the `athena-tools` Claude Code plugin (a.k.a. `pallas-athena-tools`), the hosted MCP server at `pallas-mcp-server.azurewebsites.net`, and the telemetry endpoint at `pallas-telemetry.nameappliedfor.workers.dev`.

This policy is written in plain English. It tells you what Pallas collects, what it does **not** collect, where the data goes, how long it's kept, and how to opt out.

---

## TL;DR

- Pallas collects **anonymous usage telemetry** to improve the knowledge base and prove which features deliver value.
- Telemetry **does not include patient data, source code, query bodies, file contents, user names, or email addresses**.
- Each install gets a **random per-machine UUID** ("install ID"). It is the only identifier — there is no account, no login, no IP-based tracking server-side.
- Data is stored in **Cloudflare D1** and **Azure Cosmos DB** with a **90-day automatic expiry**.
- You can **opt out** by removing the `PALLAS_TELEMETRY_URL` environment variable from your local Pallas configuration. See [Opt out](#opt-out).

---

## What Pallas collects

When you use a Pallas MCP tool or slash command, the server records a structured event with the following shape:

| Field | Example | Notes |
|---|---|---|
| `installId` | `1c901220-27b1-4e2d-8cf8-70e3bcfce57a` | A random UUID generated once per machine, stored at `~/.claude/pallas-install-id`. Not derived from any personal info. Not linked to your identity. |
| `eventType` | `tool_call`, `safety_flag`, `outcome_report`, `command_start`, `feedback` | Which kind of interaction happened. |
| `timestamp` | `2026-05-28T18:34:27.903Z` | When the event happened (UTC). |
| `toolName` | `athena_explain_view` | Which MCP tool was called. |
| `inputFields` (allowlist only) | `{"viewName": "PATIENT"}` | A **strict per-tool allowlist** of non-PII arguments — view names, workflow names, error categories, etc. Arguments not on the allowlist are not sent as plaintext (see "Hashed args" below). |
| `inputHash` | `a3f9c2d8e1b7426f` | A SHA-256 prefix of all arguments combined. Used to dedupe identical calls; not reversible. |
| `outcome` | `success` or `error` | Whether the tool call succeeded. |
| `durationMs` | `37` | How long the tool call took. |
| `errorSignature` | `KB not loaded: missing kb.json at <path>` | If the call errored, a normalized error message with UUIDs, dates, and long IDs redacted (see "Error normalization" below). |
| `rule` (safety flags only) | `patientid_chartid_join` | Which safety rule fired (categorical, from a fixed list). |
| `severity` (safety flags only) | `critical`, `warning`, `info` | Severity of the safety rule. |
| `action` (safety flags only) | `blocked`, `warned`, `auto_fixed`, `user_overrode` | What Claude did with the flag. |
| `context` (safety flags only) | `"PATIENTID=CHARTID join detected in user-supplied SQL"` | A capped, model-generated one-sentence description. Capped at 500 chars; the model is instructed to exclude patient data, file contents, and any PII. |
| `intent` (outcome reports only) | `generate_sql`, `diagnose_error`, etc. | What the user was trying to accomplish (categorical, from a fixed list). |
| `accepted` (outcome reports only) | `yes`, `no`, `edited`, `unknown` | Whether the artifact Pallas produced was accepted. |
| `learnedPattern` / `target` / `category` (feedback only) | `"APPOINTMENT.SCHEDULINGPROVIDERID is the booking column"` | Free-text discoveries submitted via `athena_submit_feedback`. The model is instructed to exclude patient data. |
| `workerReceivedAt` | `2026-05-28T18:34:27.910Z` | Server-side timestamp when the event reached the ingestion endpoint (for clock-skew detection). |

The full field set is defined in [`packages/mcp-server/src/learning/eventCapture.ts`](packages/mcp-server/src/learning/eventCapture.ts) and the tool files in [`packages/mcp-server/src/tools/`](packages/mcp-server/src/tools/).

### Per-tool argument allowlist

For each MCP tool, only specific argument fields are passed through as plaintext in `inputFields`. Everything else is reduced to the `inputHash` (a SHA-256 prefix) and cannot be recovered.

Current allowlist (defined in `eventCapture.ts`):

| Tool | Plaintext fields |
|---|---|
| `athena_search_kb` | `filter`, `topic` |
| `athena_explain_view` | `viewName` |
| `athena_explain_join` | `sourceView`, `targetView`, `fromView`, `toView` |
| `athena_explain_workflow` | `workflowName` |
| `athena_suggest_workflow` | `goal`, `integrationType` |
| `athena_diagnose_error` | `errorType` |
| `athena_list_candidates` | `entityType`, `status` |
| `athena_review_candidate` | `decision` |

None of these fields contain personal or patient data — they are schema-object names and category enums.

### Error normalization

When Pallas records an `errorSignature` from a tool failure, the message is normalized before storage:

- UUIDs (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) → `<uuid>`
- ISO datetimes (`2024-01-15T14:23:45.123`) → `<datetime>`
- Bare dates (`2024-01-15`) → `<date>`
- Long alphanumeric IDs (11+ uppercase/digits, e.g. patient IDs) → `<id>`
- Truncated to 200 characters

This keeps error patterns useful for KB triage without exposing patient or session identifiers.

---

## What Pallas does NOT collect

Pallas does **not** collect, log, or store:

- ❌ Patient names, medical record numbers, dates of birth, addresses, phone numbers, or any other Protected Health Information (PHI)
- ❌ Source code, SQL query bodies, or generated artifacts (only categorical "intent" + "accepted" flags)
- ❌ File contents from your repository or filesystem
- ❌ Your name, email address, OS user name, machine name, or hostname
- ❌ Your IP address (Cloudflare may log it momentarily at the edge for DDoS protection, but it is not stored in our databases)
- ❌ Your Claude Code session contents or conversation history
- ❌ Your Anthropic account information
- ❌ Your athenahealth practice ID, CONTEXTID, or any client credentials
- ❌ Cookies or browser fingerprints (Pallas does not run in a browser)

The MCP server has access to your tool-call arguments only as long as needed to produce a response; only the allowlisted plaintext fields (above) are persisted.

---

## Where data goes

Telemetry events travel through this pipeline:

```
Your Claude Code session
        ↓
Pallas MCP server (hosted on Azure App Service in the East US region)
        ↓
        ├── Azure Cosmos DB                   (primary storage)
        ↓
Cloudflare Worker  (pallas-telemetry.nameappliedfor.workers.dev)
        ↓
Cloudflare D1      (secondary storage, free-tier analytics)
```

- **Azure App Service** runs the MCP server and writes events directly to Azure Cosmos DB. Hosted in the East US region. Microsoft processes data per the [Azure Privacy Statement](https://privacy.microsoft.com/en-us/privacystatement).
- **Cloudflare Worker** receives a duplicate copy of events (so that stdio installs without Cosmos credentials can also contribute signal). It writes to Cloudflare D1 (SQLite). Cloudflare processes data per the [Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/).
- **Azure Cosmos DB** stores events in containers (`learning-events`, `safety-flags`, `outcomes`, `command-usage`, `candidates`) with `installId` as the partition key.
- **Cloudflare D1** stores events in a single `events` table, indexed by `install_id`, `event_type`, and `timestamp`.

Both stores are operated by the Pallas maintainers (the [`nous-ehr`](https://github.com/nous-ehr) GitHub organization). They are not shared with any third party.

---

## How long data is kept

- **Azure Cosmos DB**: Events have a 90-day TTL (`ttl: 7776000` seconds in seconds). Documents are deleted automatically after that window.
- **Cloudflare D1**: Events are retained at the maintainers' discretion. As of v0.2.0, they are not auto-expired but are not retained beyond what's needed for usage analytics and KB improvement. The maintainers may set a retention policy (e.g., 90 days to match Cosmos) at any time.
- **`workerReceivedAt`** timestamps are retained for the same duration as the rest of the event.

---

## Why this data is collected

Pallas's value depends on continually improving its knowledge base and proactive safety rules. The telemetry serves four purposes:

1. **Identifying which schema entities matter most.** If 60% of `athena_explain_view` calls hit the `DOCUMENT` view, we prioritize improving the `DOCUMENT` entry over rarely-queried views.
2. **Measuring safety-rule effectiveness.** Counts of `athena_report_safety_flag` events by `rule` tell us which anti-patterns we're catching, and which slip through.
3. **Proving value delivered.** `athena_report_outcome` events with `accepted: yes` confirm that Pallas's generated artifacts are useful, not just produced.
4. **Spotting gaps in the KB.** `athena_submit_feedback` events surface schema details, error patterns, and gotchas that aren't in the KB yet, queued for human review before merging.

---

## Opt out

Pallas is opt-out via configuration. Choose any of these methods:

### Method 1: Block telemetry locally (recommended for stdio/local installs)

Edit your Claude Code settings file (typically `~/.claude/settings.json`) and remove or blank out the `PALLAS_TELEMETRY_URL` environment variable in the `athena-tools` MCP server config:

```json
{
  "mcpServers": {
    "athena-tools": {
      "command": "node",
      "args": ["..."],
      "env": {
        "PALLAS_TELEMETRY_URL": ""
      }
    }
  }
}
```

With an empty `PALLAS_TELEMETRY_URL`, the telemetry pipe does not POST anything to the Worker. If you are also using the Azure-hosted server, see Method 2.

### Method 2: Use a self-hosted Pallas MCP server

Pallas is open source (MIT licensed). Clone the repository and run the MCP server yourself, with `COSMOS_ENDPOINT`, `COSMOS_KEY`, and `PALLAS_TELEMETRY_URL` all unset. The server will function fully — telemetry just goes nowhere.

```bash
git clone https://github.com/nous-ehr/claude_pallas_extension.git
cd claude_pallas_extension
pnpm install && pnpm build
# Configure your Claude Code to point at the local server
```

### Method 3: Delete your install ID and stop using Pallas

Delete `~/.claude/pallas-install-id` and remove the `athena-tools` MCP server from your Claude Code settings. No future events will be sent. (Existing events from previous sessions remain in storage until their 90-day TTL elapses or you request deletion — see [Data deletion](#data-deletion).)

---

## Data deletion

If you want previously-recorded events associated with your install ID deleted on demand (before the 90-day TTL):

1. Find your install ID: open `~/.claude/pallas-install-id`. It is a single UUID, e.g. `1c901220-27b1-4e2d-8cf8-70e3bcfce57a`.
2. Email the maintainers (see [Contact](#contact)) and request deletion of all events with that `installId`.
3. We will purge the matching rows from both Azure Cosmos DB and Cloudflare D1 and confirm in writing.

We do not require any other identifying information to honor a deletion request — the install ID is sufficient.

---

## Children's privacy

Pallas is a developer tool targeted at engineers building healthcare integrations. It is not directed at children under 13 and does not knowingly collect data from them. The telemetry pipeline records no personal data that could distinguish a minor from an adult.

---

## Changes to this policy

When this policy changes, we will:

1. Update the **Last updated** date at the top of this file.
2. Commit the change to the [GitHub repository](https://github.com/nous-ehr/claude_pallas_extension/blob/main/PRIVACY.md) — every change is visible in the commit history.
3. For material changes (e.g., new collection categories, new sub-processors), note the change in the plugin's release notes.

---

## Contact

Open an issue on the GitHub repository: [github.com/nous-ehr/claude_pallas_extension/issues](https://github.com/nous-ehr/claude_pallas_extension/issues).

For data-deletion requests or other privacy-specific questions, you may also email the maintainers at the address listed on the [nous-ehr GitHub organization page](https://github.com/nous-ehr).

---

## Note for marketplace reviewers

This policy describes the actual behavior of the code in this repository, not an aspiration. Each claim above can be verified:

- Field collection: see [`packages/mcp-server/src/learning/eventCapture.ts`](packages/mcp-server/src/learning/eventCapture.ts) and [`packages/mcp-server/src/learning/telemetryPipe.ts`](packages/mcp-server/src/learning/telemetryPipe.ts).
- Per-tool allowlist: see the `PLAINTEXT_FIELDS` constant in `eventCapture.ts`.
- Error normalization: see the `normalizeError()` function in `eventCapture.ts`.
- 90-day TTL: see `DEFAULT_TTL_SECONDS` in `telemetryPipe.ts` and `wrangler.toml`.
- Install ID generation: see [`packages/mcp-server/src/learning/installId.ts`](packages/mcp-server/src/learning/installId.ts).
- Worker storage code: see [`cloudflare-worker/src/index.ts`](cloudflare-worker/src/index.ts).
