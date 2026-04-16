/**
 * athenahealth Incremental Appointment Sync — Node.js/TypeScript
 * ==============================================================
 * Demonstrates the correct way to sync appointments using the /changed endpoint.
 *
 * ANTI-PATTERN: Do NOT do a full GET /appointments scan.
 *   - Hits rate limits quickly
 *   - Degrades practice performance
 *   - Doesn't scale past a few hundred appointments
 *
 * CORRECT: Use GET /appointments/changed for incremental sync.
 *   - Returns only appointments that changed since your last sync
 *   - Efficient, rate-limit-friendly
 *   - Scales to any practice size
 */

import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Configuration — externalized, never hardcoded
// ---------------------------------------------------------------------------
const CONFIG = {
  clientId: process.env.ATHENA_CLIENT_ID!,
  clientSecret: process.env.ATHENA_CLIENT_SECRET!,
  practiceId: process.env.ATHENA_PRACTICE_ID ?? "195900", // Sandbox default
  baseUrl:
    process.env.ATHENA_BASE_URL ??
    "https://api.preview.platform.athenahealth.com",
};

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const resp = await fetch(`${CONFIG.baseUrl}/oauth2/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "athenaNet",
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
    }),
  });

  if (!resp.ok) throw new Error(`Token request failed: ${resp.status}`);
  const data = (await resp.json()) as { access_token: string; expires_in: number };

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

// ---------------------------------------------------------------------------
// API client with retry
// ---------------------------------------------------------------------------
async function athenaFetch(
  path: string,
  params?: Record<string, string>
): Promise<unknown> {
  const url = new URL(
    `/v1/${CONFIG.practiceId}${path}`,
    CONFIG.baseUrl
  );
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const requestId = randomUUID();
    const token = await getToken();

    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Request-Id": requestId,
        Accept: "application/json",
      },
    });

    if (resp.status === 429) {
      // Rate limited — back off with jitter
      const retryAfter = parseInt(resp.headers.get("Retry-After") ?? "0", 10);
      const wait = Math.max(retryAfter * 1000, 2 ** attempt * 1000 + Math.random() * 1000);
      console.warn(`Rate limited (429). Waiting ${(wait / 1000).toFixed(1)}s...`);
      await sleep(wait);
      continue;
    }

    if (resp.status === 401) {
      // Token expired — clear cache and retry
      cachedToken = null;
      continue;
    }

    if (!resp.ok) {
      throw new Error(`API error ${resp.status}: ${await resp.text()} (rid: ${requestId})`);
    }

    return resp.json();
  }

  throw new Error(`Max retries exceeded for ${path}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Incremental appointment sync using /changed endpoint
// ---------------------------------------------------------------------------
interface ChangedAppointmentsResponse {
  appointments?: Array<{
    appointmentid: string;
    patientid: string;
    date: string;
    starttime: string;
    appointmentstatus: string;
    appointmenttype: string;
    providerid: string;
    departmentid: string;
  }>;
  next?: string; // Pagination URL
}

async function syncAppointments(
  departmentId: string,
  showProcessedStartDatetime: string
): Promise<void> {
  console.log(
    `Syncing changed appointments since ${showProcessedStartDatetime}...`
  );

  let hasMore = true;
  let offset = 0;
  let totalSynced = 0;

  while (hasMore) {
    const data = (await athenaFetch("/appointments/changed", {
      departmentid: departmentId,
      showprocessedstartdatetime: showProcessedStartDatetime,
      limit: "100",
      offset: String(offset),
    })) as ChangedAppointmentsResponse;

    const appointments = data.appointments ?? [];
    totalSynced += appointments.length;

    for (const appt of appointments) {
      // Process each changed appointment
      console.log(
        `  Appointment ${appt.appointmentid}: ${appt.date} ${appt.starttime} — ${appt.appointmentstatus}`
      );
      // TODO: Upsert to your local database
    }

    if (data.next) {
      offset += 100;
    } else {
      hasMore = false;
    }
  }

  console.log(`Sync complete: ${totalSynced} appointment(s) processed.`);
  // TODO: Store the current timestamp for the next sync run
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Sync appointments changed in the last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  await syncAppointments("1", since); // Department ID 1 for sandbox
}

main().catch(console.error);
