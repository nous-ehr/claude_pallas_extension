import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { sendEvent } from '../learning/telemetryPipe.js';
import { log } from '../config.js';

/**
 * The most valuable event in the whole system. Whenever Claude fires one of the
 * proactive safety rules from SKILL.md (PATIENTID=CHARTID, missing soft-delete,
 * missing CONTEXTID, hardcoded credentials, missing rate-limit retry, etc.),
 * Claude calls this tool. The events feed the "PR-blocking safety checks"
 * monetization wedge: "we prevented N bugs this month" is the headline metric.
 */

export const REPORT_SAFETY_FLAG_DEF: Tool = {
  name: 'athena_report_safety_flag',
  description:
    'Record that a proactive athenahealth safety rule fired during this interaction. ' +
    'Call this every time you flag an anti-pattern from the SKILL.md safety rules ' +
    '(PATIENTID=CHARTID join, missing DELETEDDATETIME filter, missing CONTEXTID, ' +
    'hardcoded credentials, missing rate-limit retry, etc.). One call per flag. ' +
    'Non-blocking — never delays your response.',
  inputSchema: {
    type: 'object',
    properties: {
      rule: {
        type: 'string',
        description:
          'Short rule identifier. Use the canonical set: ' +
          '"patientid_chartid_join", "missing_soft_delete", "missing_contextid", ' +
          '"hardcoded_credentials", "missing_rate_limit_retry", "unsafe_join_unverified", ' +
          '"unsafe_phi_leak", "deprecated_endpoint", "missing_x_request_id", or ' +
          'a new identifier in snake_case if none of these fit.',
      },
      severity: {
        type: 'string',
        enum: ['critical', 'warning', 'info'],
        description:
          'critical = blocks correctness (data loss, compliance, security). ' +
          'warning = production-risk but not blocking. info = style/best-practice nudge.',
      },
      action: {
        type: 'string',
        enum: ['blocked', 'warned', 'auto_fixed', 'user_overrode'],
        description: 'What you did with the flag in the conversation.',
      },
      context: {
        type: 'string',
        description:
          'One sentence describing what triggered the flag and where it appeared ' +
          '(file path, function, query) — no PII, no patient data.',
      },
      filePath: {
        type: 'string',
        description: 'Optional. Repo-relative file path where the issue was found.',
      },
      languageOrDialect: {
        type: 'string',
        description: 'Optional. e.g. "snowflake-sql", "python", "typescript", "fhir-r4".',
      },
    },
    required: ['rule', 'severity', 'action', 'context'],
  },
} as const;

const InputSchema = z.object({
  rule: z.string().min(1).max(80),
  severity: z.enum(['critical', 'warning', 'info']),
  action: z.enum(['blocked', 'warned', 'auto_fixed', 'user_overrode']),
  context: z.string().min(1).max(500),
  filePath: z.string().max(300).optional(),
  languageOrDialect: z.string().max(50).optional(),
});

export async function handleReportSafetyFlag(
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
    sendEvent('safety_flag', {
      id,
      rule: data.rule,
      severity: data.severity,
      action: data.action,
      context: data.context,
      filePath: data.filePath,
      languageOrDialect: data.languageOrDialect,
    });
    log.info(
      `Safety flag recorded: rule=${data.rule} severity=${data.severity} action=${data.action}`
    );
  } catch (err) {
    // Never break the interaction over telemetry
    log.debug(`Safety flag telemetry failed (non-fatal): ${err}`);
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            recorded: true,
            flagId: id,
            rule: data.rule,
            severity: data.severity,
          },
          null,
          2
        ),
      },
    ],
  };
}
