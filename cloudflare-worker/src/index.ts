/**
 * Pallas Telemetry Worker
 *
 * Receives fire-and-forget telemetry events from Pallas MCP server installs
 * (stdio AND http) and forwards them to Cosmos DB. Provides a single ingestion
 * endpoint so installs without Cosmos credentials can still contribute signal.
 *
 * Routes:
 *   POST /events       — accept a single event (JSON body)
 *   POST /events/batch — accept up to 100 events at once (JSON array)
 *   GET  /health       — liveness probe
 *
 * Storage:
 *   1. Cosmos DB (primary). REST API + HMAC auth — no Cosmos SDK needed in the Worker.
 *   2. Cloudflare D1 (fallback / local analytics). Always-on regardless of Cosmos.
 *
 * Security:
 *   - No authentication on /events. Telemetry is intentionally public-write.
 *   - Rate limited by Cloudflare's built-in DDoS protection.
 *   - Payload size limited to 32 KB per request (sensible cap, well above any real event).
 *   - eventType allowlist prevents arbitrary writes to arbitrary containers.
 */

interface Env {
  COSMOS_ENDPOINT?: string;
  COSMOS_KEY?: string;
  COSMOS_DATABASE?: string;
  DEFAULT_COSMOS_DATABASE: string;
  DEFAULT_TTL_SECONDS: string;
  DB: D1Database;
}

type AllowedEventType =
  | 'tool_call'
  | 'safety_flag'
  | 'outcome_report'
  | 'command_start'
  | 'feedback'
  | 'candidate';

const ALLOWED_EVENT_TYPES: ReadonlySet<AllowedEventType> = new Set([
  'tool_call',
  'safety_flag',
  'outcome_report',
  'command_start',
  'feedback',
  'candidate',
]);

const CONTAINER_FOR: Record<AllowedEventType, string> = {
  tool_call: 'learning-events',
  safety_flag: 'safety-flags',
  outcome_report: 'outcomes',
  command_start: 'command-usage',
  feedback: 'learning-events',
  candidate: 'candidates',
};

const MAX_BODY_BYTES = 32 * 1024;
const MAX_BATCH = 100;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({ status: 'ok', time: new Date().toISOString() });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // Body size check
    const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
    if (contentLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Body too large' }, 413);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    if (url.pathname === '/events') {
      const result = await acceptOne(body, env, ctx);
      return jsonResponse(result.body, result.status);
    }
    if (url.pathname === '/events/batch') {
      const result = await acceptBatch(body, env, ctx);
      return jsonResponse(result.body, result.status);
    }
    return jsonResponse({ error: 'Not found' }, 404);
  },
};

async function acceptOne(
  body: unknown,
  env: Env,
  ctx: ExecutionContext
): Promise<{ status: number; body: object }> {
  const event = normalize(body);
  if (!event) return { status: 400, body: { error: 'Invalid event shape' } };

  // Fire-and-forget; do not block the response on storage.
  ctx.waitUntil(persist(event, env));
  return { status: 202, body: { accepted: 1 } };
}

async function acceptBatch(
  body: unknown,
  env: Env,
  ctx: ExecutionContext
): Promise<{ status: number; body: object }> {
  if (!Array.isArray(body)) return { status: 400, body: { error: 'Body must be a JSON array' } };
  if (body.length > MAX_BATCH) {
    return { status: 400, body: { error: `Max batch size is ${MAX_BATCH}` } };
  }

  let accepted = 0;
  const rejected: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const event = normalize(body[i]);
    if (event) {
      ctx.waitUntil(persist(event, env));
      accepted++;
    } else {
      rejected.push(i);
    }
  }
  return { status: 202, body: { accepted, rejected } };
}

function normalize(raw: unknown): (Record<string, unknown> & { eventType: AllowedEventType }) | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const t = obj.eventType;
  if (typeof t !== 'string' || !ALLOWED_EVENT_TYPES.has(t as AllowedEventType)) return null;
  if (typeof obj.installId !== 'string' || obj.installId.length < 8) return null;
  if (typeof obj.id !== 'string' || obj.id.length < 8) return null;
  if (typeof obj.timestamp !== 'string') return null;

  // Stamp server-side received time so we can detect clock-skewed clients
  obj.workerReceivedAt = new Date().toISOString();
  return obj as Record<string, unknown> & { eventType: AllowedEventType };
}

async function persist(
  event: Record<string, unknown> & { eventType: AllowedEventType },
  env: Env
): Promise<void> {
  // Always write to D1 (fast, local, free analytics)
  try {
    await writeD1(event, env);
  } catch (err) {
    console.error('D1 write failed', err);
  }
  // Best-effort write to Cosmos DB
  try {
    await writeCosmos(event, env);
  } catch (err) {
    console.error('Cosmos write failed', err);
  }
}

async function writeD1(
  event: Record<string, unknown> & { eventType: AllowedEventType },
  env: Env
): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(
    `INSERT INTO events (id, event_type, install_id, timestamp, payload)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  )
    .bind(
      String(event.id),
      String(event.eventType),
      String(event.installId),
      String(event.timestamp),
      JSON.stringify(event)
    )
    .run();
}

async function writeCosmos(
  event: Record<string, unknown> & { eventType: AllowedEventType },
  env: Env
): Promise<void> {
  if (!env.COSMOS_ENDPOINT || !env.COSMOS_KEY) return;

  const database = env.COSMOS_DATABASE ?? env.DEFAULT_COSMOS_DATABASE;
  const container = CONTAINER_FOR[event.eventType];
  const resourceLink = `dbs/${database}/colls/${container}`;
  const url = `${env.COSMOS_ENDPOINT.replace(/\/$/, '')}/${resourceLink}/docs`;

  const date = new Date().toUTCString().toLowerCase();
  const auth = await cosmosAuthHeader('POST', 'docs', resourceLink, date, env.COSMOS_KEY);

  // Cosmos requires the partition-key header. Default partition key is /installId.
  const partitionKeyValue = `["${event.installId}"]`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'x-ms-date': date,
      'x-ms-version': '2018-12-31',
      'x-ms-documentdb-partitionkey': partitionKeyValue,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });

  if (!res.ok && res.status !== 409) {
    // 409 = duplicate id (idempotent retry); anything else is a real failure
    const text = await res.text();
    throw new Error(`Cosmos ${res.status}: ${text.slice(0, 200)}`);
  }
}

/**
 * Cosmos DB master-key HMAC signature.
 * Reference: https://learn.microsoft.com/en-us/rest/api/cosmos-db/access-control-on-cosmosdb-resources
 */
async function cosmosAuthHeader(
  verb: string,
  resourceType: string,
  resourceLink: string,
  date: string,
  masterKey: string
): Promise<string> {
  const stringToSign =
    verb.toLowerCase() + '\n' +
    resourceType.toLowerCase() + '\n' +
    resourceLink + '\n' +
    date + '\n' +
    '' + '\n';

  const keyBytes = Uint8Array.from(atob(masterKey), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(stringToSign));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return encodeURIComponent(`type=master&ver=1.0&sig=${sigB64}`);
}

function jsonResponse(body: object, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
