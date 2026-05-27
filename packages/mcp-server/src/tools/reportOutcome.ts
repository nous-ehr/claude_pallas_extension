import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { sendEvent } from '../learning/telemetryPipe.js';
import { log } from '../config.js';

/**
 * End-of-interaction outcome reporting. Called by Claude after a meaningful unit
 * of work completes (a /sql generation, /athena-api scaffolding, /diagnose
 * resolution, etc.). Distinguishes "tool was invoked" from "tool produced
 * something the user accepted."
 *
 * This is the only metric that proves value delivered, not just usage. Critical
 * for any business case ("78% of SQL queries adopted unchanged").
 */

export const REPORT_OUTCOME_DEF: Tool = {
  name: 'athena_report_outcome',
  description:
    'Report the outcome of an athenahealth-related interaction once it concludes. ' +
    'Call this after producing an artifact (SQL, code, diagnosis, explanation) so we ' +
    'can measure value delivered. One call per logical interaction. Non-blocking.',
  inputSchema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: [
          'generate_sql',
          'generate_api_code',
          'diagnose_error',
          'explain_concept',
          'explain_workflow',
          'review_code',
          'onboard',
          'validate',
          'other',
        ],
        description: 'What the user was trying to accomplish.',
      },
      artifactType: {
        type: 'string',
        enum: ['sql', 'code', 'explanation', 'diagnosis', 'review', 'none'],
        description: 'What you produced (or "none" if no artifact).',
      },
      accepted: {
        type: 'string',
        enum: ['yes', 'no', 'edited', 'unknown'],
        description:
          'Did the user accept the artifact? yes = used as-is, edited = used with tweaks, ' +
          'no = explicitly rejected, unknown = conversation continued without a clear signal.',
      },
      slashCommand: {
        type: 'string',
        description: 'If this was triggered by a slash command, the command name (e.g. "/sql").',
      },
      toolsUsed: {
        type: 'array',
        items: { type: 'string' },
        description: 'Which athena_* MCP tools you invoked during this interaction.',
      },
      safetyFlagsFired: {
        type: 'integer',
        description: 'How many athena_report_safety_flag calls you made during this interaction.',
        minimum: 0,
      },
      notes: {
        type: 'string',
        description: 'Optional one-sentence note — no PII, no patient data.',
      },
    },
    required: ['intent', 'artifactType', 'accepted'],
  },
} as const;

const InputSchema = z.object({
  intent: z.enum([
    'generate_sql',
    'generate_api_code',
    'diagnose_error',
    'explain_concept',
    'explain_workflow',
    'review_code',
    'onboard',
    'validate',
    'other',
  ]),
  artifactType: z.enum(['sql', 'code', 'explanation', 'diagnosis', 'review', 'none']),
  accepted: z.enum(['yes', 'no', 'edited', 'unknown']),
  slashCommand: z.string().max(50).optional(),
  toolsUsed: z.array(z.string()).optional(),
  safetyFlagsFired: z.number().int().min(0).optional(),
  notes: z.string().max(300).optional(),
});

export async function handleReportOutcome(
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
  const id = randomUUID();

  try {
    sendEvent('outcome_report', {
      id,
      intent: data.intent,
      artifactType: data.artifactType,
      accepted: data.accepted,
      slashCommand: data.slashCommand,
      toolsUsed: data.toolsUsed ?? [],
      safetyFlagsFired: data.safetyFlagsFired ?? 0,
      notes: data.notes,
    });
    log.info(
      `Outcome recorded: intent=${data.intent} artifact=${data.artifactType} accepted=${data.accepted}`
    );
  } catch (err) {
    log.debug(`Outcome telemetry failed (non-fatal): ${err}`);
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            recorded: true,
            outcomeId: id,
            intent: data.intent,
            accepted: data.accepted,
          },
          null,
          2
        ),
      },
    ],
  };
}
