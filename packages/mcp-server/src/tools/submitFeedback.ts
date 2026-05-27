import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { classifyAndRoute, type FeedbackPayload } from '../learning/classifier.js';
import { log } from '../config.js';

export const SUBMIT_FEEDBACK_DEF: Tool = {
  name: 'athena_submit_feedback',
  description:
    'Submit feedback about an athenahealth interaction outcome. Call this after resolving ' +
    'an issue (success or failure) to help the knowledge base learn from the experience. ' +
    'Low-risk patterns (error resolutions, general gotchas) are automatically merged. ' +
    'High-risk patterns (schema discoveries, relationship changes) are queued for review. ' +
    'This is how the extension gets smarter over time.',
  inputSchema: {
    type: 'object',
    properties: {
      outcome: {
        type: 'string',
        enum: ['success', 'failure'],
        description: 'Whether the interaction was ultimately resolved successfully.',
      },
      context: {
        type: 'string',
        description: 'What the user was trying to accomplish (e.g., "joining PATIENT to CHART for a demographics report").',
      },
      resolution: {
        type: 'string',
        description: 'What worked (if success) or what was attempted (if failure). Be specific about the fix.',
      },
      toolsUsed: {
        type: 'array',
        items: { type: 'string' },
        description: 'Which MCP tools were called during this interaction (e.g., ["athena_explain_join", "athena_diagnose_error"]).',
      },
      errorEncountered: {
        type: 'string',
        description: 'The error message that was encountered, if any.',
      },
      learnedPattern: {
        type: 'string',
        description:
          'A new pattern, gotcha, or insight discovered during the interaction that other developers ' +
          'would benefit from knowing. This is the most important field — capture what was surprising or non-obvious.',
      },
      category: {
        type: 'string',
        enum: [
          'schema_correction',
          'join_path',
          'identity_pattern',
          'missing_filter',
          'error_pattern',
          'workflow_step',
          'enum_value',
          'gotcha',
          'other',
        ],
        description:
          'Optional structured category for the discovery. Providing this skips the keyword-' +
          'classification step and routes the feedback faster. Use "identity_pattern" for ' +
          'PATIENT/CHART/identity, "schema_correction" for column/view behavior differences, ' +
          '"join_path" for incorrect join columns, "enum_value" for missing or new enum values.',
      },
      target: {
        type: 'string',
        description:
          'Optional target identifier for the discovery, e.g. "DOCUMENT.STATUS", ' +
          '"APPOINTMENT.SCHEDULINGPROVIDERID", "PATIENTCASE workflow". Helps maintainers ' +
          'find the affected KB entry quickly.',
      },
      sessionId: {
        type: 'string',
        description:
          'Optional. The sessionId returned by athena_command_start, if this feedback ' +
          'is being submitted as part of a slash-command interaction.',
      },
    },
    required: ['outcome', 'context', 'toolsUsed'],
  },
} as const;

const InputSchema = z.object({
  outcome: z.enum(['success', 'failure']),
  context: z.string().min(1),
  resolution: z.string().optional(),
  toolsUsed: z.array(z.string()),
  errorEncountered: z.string().optional(),
  learnedPattern: z.string().optional(),
  category: z
    .enum([
      'schema_correction',
      'join_path',
      'identity_pattern',
      'missing_filter',
      'error_pattern',
      'workflow_step',
      'enum_value',
      'gotcha',
      'other',
    ])
    .optional(),
  target: z.string().max(200).optional(),
  sessionId: z.string().max(80).optional(),
});

export async function handleSubmitFeedback(
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const feedback: FeedbackPayload = parsed.data;

  try {
    const result = await classifyAndRoute(feedback);

    log.info(`Feedback processed: ${result.action} — ${result.details}`);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              received: true,
              outcome: feedback.outcome,
              action: result.action,
              details: result.details,
              message:
                result.action === 'auto_merged'
                  ? 'Thank you! This pattern has been automatically added to the knowledge base with low confidence. It will gain confidence as more developers confirm it.'
                  : result.action === 'queued_for_review'
                  ? 'Thank you! This discovery has been queued for human review because it involves schema or identity patterns. A maintainer will review and approve or reject it.'
                  : 'Thank you for the feedback. No actionable pattern was detected, but the interaction has been noted.',
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Feedback processing failed: ${message}`, err);

    // Never block on feedback failures — acknowledge and move on
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            received: true,
            action: 'error',
            details: `Feedback received but processing failed: ${message}. The interaction is noted.`,
          }),
        },
      ],
    };
  }
}
