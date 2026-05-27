import { getContainer } from './cosmosClient.js';
import { getInstallId } from './installId.js';
import { log } from '../config.js';

/**
 * Unified telemetry pipe. Every event gets stamped with installId and shipped to:
 *   1. Cosmos DB directly (if COSMOS_ENDPOINT is set — Azure deployment)
 *   2. The Cloudflare Worker endpoint (if PALLAS_TELEMETRY_URL is set — for stdio installs)
 *
 * Both paths are fire-and-forget. Failures are logged at debug level and never
 * surface to the caller — telemetry must NEVER block or break a tool response.
 *
 * Design note: stdio installs typically can't reach Cosmos directly (no credentials
 * shipped to user laptops). The Worker proxy gives them a way to contribute events
 * without exposing the Cosmos key.
 */

export type EventOutcome = 'success' | 'error' | 'flagged' | 'accepted' | 'rejected' | 'unknown';

export interface BaseEvent {
  /** Cosmos container partition key — also routes to different KPI dashboards */
  eventType:
    | 'tool_call'
    | 'safety_flag'
    | 'outcome_report'
    | 'command_start'
    | 'feedback'
    | 'candidate';
  /** Random UUID — must be unique per event */
  id: string;
  /** Stable per-machine UUID, no PII. From getInstallId(). */
  installId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** 90-day TTL in seconds (Cosmos auto-expires) */
  ttl: number;
  /** Optional session/correlation ID for grouping events from one interaction */
  sessionId?: string;
}

export type TelemetryEvent = BaseEvent & Record<string, unknown>;

const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60;

function getTelemetryUrl(): string | null {
  return process.env.PALLAS_TELEMETRY_URL?.trim() || null;
}

/**
 * Send an event to all configured sinks. Fire-and-forget — never throws,
 * never delays.
 */
export function sendEvent(
  eventType: BaseEvent['eventType'],
  payload: Record<string, unknown>,
  containerHint?: string
): void {
  // Build the event synchronously so the timestamp is accurate
  const event: TelemetryEvent = {
    eventType,
    id: cryptoRandomId(),
    installId: getInstallId(),
    timestamp: new Date().toISOString(),
    ttl: DEFAULT_TTL_SECONDS,
    ...payload,
  };

  // Cosmos direct path (Azure)
  void writeCosmos(event, containerHint).catch((err) =>
    log.debug(`Cosmos write failed (non-fatal): ${err}`)
  );

  // Cloudflare Worker path (everyone, but especially stdio installs)
  void postWorker(event).catch((err) =>
    log.debug(`Worker POST failed (non-fatal): ${err}`)
  );
}

async function writeCosmos(event: TelemetryEvent, containerHint?: string): Promise<void> {
  const containerName = containerHint ?? defaultContainerFor(event.eventType);
  const container = getContainer(containerName);
  if (!container) return; // Cosmos not configured locally — that's fine
  await container.items.create(event);
}

async function postWorker(event: TelemetryEvent): Promise<void> {
  const url = getTelemetryUrl();
  if (!url) return; // Worker URL not set — also fine
  // Use Node's global fetch (Node 18+); abort if it takes >2s
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function defaultContainerFor(eventType: BaseEvent['eventType']): string {
  switch (eventType) {
    case 'tool_call':
      return 'learning-events';
    case 'safety_flag':
      return 'safety-flags';
    case 'outcome_report':
      return 'outcomes';
    case 'command_start':
      return 'command-usage';
    case 'feedback':
      return 'learning-events';
    case 'candidate':
      return 'candidates';
  }
}

function cryptoRandomId(): string {
  // Available in Node 18+
  return (globalThis.crypto?.randomUUID?.() ?? fallbackRandomId());
}

function fallbackRandomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
