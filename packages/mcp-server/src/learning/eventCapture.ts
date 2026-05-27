import { createHash, randomUUID } from 'crypto';
import { log } from '../config.js';
import { sendEvent } from './telemetryPipe.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Learning event types stored in Cosmos DB and/or shipped to the Worker.
 *
 * Privacy: input arguments are filtered through a per-tool allowlist. Fields
 * that name a schema entity (view name, workflow name, etc.) are sent as
 * plaintext — they're the most valuable signal. Anything else is reduced to
 * a SHA256 hash so we can dedup repeated calls without learning content.
 */
export interface LearningEvent {
  id: string;
  toolName: string;
  installId: string;
  outcome: 'success' | 'error';
  durationMs: number;
  errorSignature?: string;
  /** Plaintext values for whitelisted argument fields, by field name. */
  inputFields?: Record<string, string>;
  /** Hash of the FULL argument object for dedup of identical calls. */
  inputHash: string;
  timestamp: string;
  ttl: number;
}

/**
 * Per-tool plaintext field allowlist. Field names listed here are sent as
 * plaintext in inputFields — they are not PII and are essential signal:
 *   - What views are queried most? (drives docs priority)
 *   - What workflows are explored? (drives content investment)
 *   - What errors are diagnosed? (drives gotcha pipeline)
 *
 * Anything not in this map is omitted from inputFields. The full args object
 * is still hashed for dedup, just not sent as plaintext.
 */
const PLAINTEXT_FIELDS: Record<string, string[]> = {
  athena_search_kb: ['filter', 'topic'],
  athena_explain_view: ['viewName'],
  athena_explain_join: ['sourceView', 'targetView', 'fromView', 'toView'],
  athena_explain_workflow: ['workflowName'],
  athena_suggest_workflow: ['goal', 'integrationType'],
  athena_diagnose_error: ['errorType'],
  athena_list_candidates: ['entityType', 'status'],
  athena_review_candidate: ['decision'],
};

/**
 * Wraps a tool handler to capture learning events.
 * Non-blocking — never delays tool responses, never throws on telemetry failure.
 */
export function withEventCapture(
  toolName: string,
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>
): (args: Record<string, unknown>) => Promise<CallToolResult> {
  return async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const start = Date.now();
    let outcome: 'success' | 'error' = 'success';
    let errorSignature: string | undefined;

    try {
      const result = await handler(args);

      if (result.isError) {
        outcome = 'error';
        const text = result.content?.[0];
        if (text && 'text' in text) {
          errorSignature = normalizeError(text.text);
        }
      }

      return result;
    } catch (err) {
      outcome = 'error';
      errorSignature = normalizeError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      try {
        recordEvent(toolName, args, outcome, Date.now() - start, errorSignature);
      } catch (e) {
        log.debug(`Failed to record learning event: ${e}`);
      }
    }
  };
}

function recordEvent(
  toolName: string,
  args: Record<string, unknown>,
  outcome: 'success' | 'error',
  durationMs: number,
  errorSignature?: string
): void {
  const allowedFields = PLAINTEXT_FIELDS[toolName] ?? [];
  const inputFields: Record<string, string> = {};
  for (const field of allowedFields) {
    const value = args[field];
    if (typeof value === 'string' && value.length > 0 && value.length <= 200) {
      inputFields[field] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      inputFields[field] = String(value);
    }
  }

  sendEvent('tool_call', {
    id: randomUUID(),
    toolName,
    outcome,
    durationMs,
    errorSignature,
    inputFields: Object.keys(inputFields).length ? inputFields : undefined,
    inputHash: hashInput(args),
  });
}

function hashInput(args: Record<string, unknown>): string {
  const json = JSON.stringify(args, Object.keys(args).sort());
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/**
 * Normalize error messages for pattern matching while preserving useful signal.
 *
 * Old behavior stripped ALL numbers and truncated at 160 chars, collapsing many
 * distinct errors into one signature. New behavior:
 *   - Redacts UUIDs and date/time strings (likely PII or session-specific)
 *   - Redacts long alphanumeric IDs (>10 chars, likely patient/document IDs)
 *   - Keeps short numbers (HTTP codes, retry counts, row counts) — they're signal
 *   - Collapses whitespace
 *   - Truncates at 200 chars (was 160)
 */
function normalizeError(msg: string): string {
  return msg
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '<uuid>')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?/g, '<datetime>')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<date>')
    .replace(/\b[A-Z0-9]{11,}\b/g, '<id>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
