import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { sendEvent } from '../learning/telemetryPipe.js';
import { log } from '../config.js';

/**
 * Beacon tool. Slash commands ("/sql", "/onboard", "/diagnose", etc.) run inside
 * Claude Code as prompts — they do NOT automatically hit the MCP server. Without
 * a beacon, slash-command usage is invisible to our telemetry, leaving us blind
 * about which commands deliver value.
 *
 * The expectation: each commands/<name>.md file instructs Claude to call this
 * tool as its first action. Trivial overhead, full visibility.
 */

export const COMMAND_START_DEF: Tool = {
  name: 'athena_command_start',
  description:
    'Mark the start of a slash command invocation. Call this as the first action in ' +
    'every athena slash command (/sql, /onboard, /diagnose, /athena-api, /review-athena, ' +
    '/validate, /explain, /workflow). One call per invocation. Returns a session ID that ' +
    'can be passed to athena_report_outcome at the end.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          'The slash command name without the leading slash (e.g. "sql", "onboard"). ' +
          'Use "ad_hoc" if this is not a slash command but a general athenahealth query.',
      },
      argSummary: {
        type: 'string',
        description:
          'Short, non-PII summary of what the user is trying to do. Categorical ' +
          'rather than verbatim — e.g. "join PATIENT and CHART", not the exact query text.',
      },
    },
    required: ['command'],
  },
} as const;

const InputSchema = z.object({
  command: z.string().min(1).max(50),
  argSummary: z.string().max(200).optional(),
});

export async function handleCommandStart(
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const data = parsed.data;
  const sessionId = randomUUID();

  try {
    sendEvent('command_start', {
      id: sessionId,
      sessionId,
      command: data.command,
      argSummary: data.argSummary,
    });
    log.info(`Command start: ${data.command}`);
  } catch (err) {
    log.debug(`Command beacon failed (non-fatal): ${err}`);
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            recorded: true,
            sessionId,
            command: data.command,
            note:
              'Pass this sessionId to athena_report_outcome at the end of the interaction ' +
              'so outcome and command_start can be correlated.',
          },
          null,
          2
        ),
      },
    ],
  };
}
