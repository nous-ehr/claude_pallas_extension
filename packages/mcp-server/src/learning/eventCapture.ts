import { createHash, randomUUID } from 'crypto';
import { getContainer } from './cosmosClient.js';
import { log } from '../config.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Learning event types stored in Cosmos DB.
 */
export interface LearningEvent {
  id: string;
  toolName: string;          // Partition key
  inputHash: string;         // SHA256 of input args (privacy: no raw input stored)
  outcome: 'success' | 'error';
  durationMs: number;
  errorSignature?: string;   // Normalized error (numbers → #, truncated to 160 chars)
  timestamp: string;         // ISO 8601
  ttl: number;               // Auto-expire after 90 days
}

/**
 * Wraps a tool handler to capture learning events.
 * Non-blocking — never delays tool responses.
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

      // Check if the tool itself reported an error
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
      // Fire-and-forget — never block the response
      recordEvent(toolName, args, outcome, Date.now() - start, errorSignature).catch((e) =>
        log.debug(`Failed to record learning event: ${e}`)
      );
    }
  };
}

/**
 * Record a learning event to Cosmos DB.
 */
async function recordEvent(
  toolName: string,
  args: Record<string, unknown>,
  outcome: 'success' | 'error',
  durationMs: number,
  errorSignature?: string
): Promise<void> {
  const container = getContainer('learning-events');
  if (!container) return; // Cosmos not configured

  const event: LearningEvent = {
    id: randomUUID(),
    toolName,
    inputHash: hashInput(args),
    outcome,
    durationMs,
    errorSignature,
    timestamp: new Date().toISOString(),
    ttl: 90 * 24 * 60 * 60, // 90 days in seconds
  };

  await container.items.create(event);
  log.debug(`Learning event recorded: ${toolName} ${outcome} (${durationMs}ms)`);
}

/**
 * Hash tool input for privacy — we track patterns, not raw data.
 */
function hashInput(args: Record<string, unknown>): string {
  const json = JSON.stringify(args, Object.keys(args).sort());
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/**
 * Normalize error messages for pattern matching.
 * Replaces numbers with #, truncates to 160 chars.
 */
function normalizeError(msg: string): string {
  return msg
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
