# Pallas Telemetry Worker

A Cloudflare Worker that ingests telemetry events from Pallas MCP server installs and forwards them to Cosmos DB and Cloudflare D1.

**Why this exists**: stdio Pallas installs (npm-installed, running on developer laptops) cannot reach Cosmos DB directly — we cannot ship the master key to user laptops. This Worker is the proxy that lets them contribute signal without exposing credentials.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET`  | `/health`        | Liveness probe |
| `POST` | `/events`        | Accept a single event (JSON body) |
| `POST` | `/events/batch`  | Accept up to 100 events (JSON array) |

All POST endpoints return `202 Accepted` immediately; persistence happens asynchronously via `ctx.waitUntil`.

## Deploy

```bash
# One-time setup
npm install
wrangler login
wrangler d1 create pallas-telemetry
# Copy the database_id from the output into wrangler.toml

# Set Cosmos secrets (optional — Worker still writes to D1 without these)
wrangler secret put COSMOS_ENDPOINT
wrangler secret put COSMOS_KEY
wrangler secret put COSMOS_DATABASE   # optional, defaults to "pallas-kb"

# Apply schema and deploy
npm run db:migrate:remote
npm run deploy
```

After deploy, the Worker is reachable at `https://pallas-telemetry.<your-subdomain>.workers.dev`.

## Wiring Pallas to it

Set the env var on every Pallas install (both stdio and Azure):

```
PALLAS_TELEMETRY_URL=https://pallas-telemetry.<your-subdomain>.workers.dev/events
```

For stdio installs, this can be hardcoded into the plugin's `.mcp.json` once the Worker is deployed. For the Azure server, set via App Service > Configuration > Application Settings.

## Free tier

Cloudflare Workers free tier: **100K requests/day**, 10ms CPU per request. At an estimated 50 events per active install per day, that supports ~2,000 daily active installs comfortably.

Cloudflare D1 free tier: 5GB storage, 25M row reads/day, 50K row writes/day.

## Querying the D1 store

Useful one-off analytics without leaving Cloudflare:

```bash
# Active installs in the last 7 days
wrangler d1 execute pallas-telemetry --remote --command \
  "SELECT COUNT(DISTINCT install_id) FROM events WHERE timestamp > datetime('now','-7 days')"

# Top tools called this week
wrangler d1 execute pallas-telemetry --remote --command \
  "SELECT json_extract(payload, '$.toolName') as tool, COUNT(*) as n
   FROM events WHERE event_type = 'tool_call' AND timestamp > datetime('now','-7 days')
   GROUP BY tool ORDER BY n DESC LIMIT 20"

# Safety flags fired by rule
wrangler d1 execute pallas-telemetry --remote --command \
  "SELECT json_extract(payload, '$.rule') as rule, COUNT(*) as n
   FROM events WHERE event_type = 'safety_flag'
   GROUP BY rule ORDER BY n DESC"
```
