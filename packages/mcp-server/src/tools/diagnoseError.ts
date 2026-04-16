import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { KnowledgeBase } from '../db/kbStore.js';
import { jsonResult, kbNotReady } from './index.js';

export const DIAGNOSE_ERROR_DEF: Tool = {
  name: 'athena_diagnose_error',
  description:
    'Diagnoses an athenahealth API or Snowflake DataView error. Returns likely causes, ' +
    'suggested fixes, and links to relevant knowledge base content. Handles HTTP status codes, ' +
    'athenahealth-specific error strings, OAuth/scope errors, and SQL errors.',
  inputSchema: {
    type: 'object',
    properties: {
      errorMessage: {
        type: 'string',
        description: 'The full error message or status code, e.g. "403 invalid scope" or "400 Invalid Clinical Status"',
      },
      context: {
        type: 'string',
        description: 'Optional additional context: which endpoint or view, what operation, etc.',
      },
    },
    required: ['errorMessage'],
  },
} as const;

const InputSchema = z.object({
  errorMessage: z.string().min(1),
  context: z.string().optional(),
});

const KNOWN_PATTERNS: Array<{
  pattern: RegExp;
  causes: string[];
  fixes: string[];
  searchTerms: string[];
}> = [
  {
    pattern: /403|forbidden|invalid.?scope|insufficient.?scope/i,
    causes: [
      'The OAuth token is missing required API scopes for this endpoint.',
      "The application's registered scopes do not include the requested resource.",
      'The practice has not granted your application access to this scope.',
    ],
    fixes: [
      'Check the required scopes for the endpoint in the athenahealth developer portal.',
      'Re-authorize the application with the correct scope list.',
      'Verify the X-PRACTICE-TOKEN or partner code is correct for this practice.',
      'For sandbox testing, ensure you are using the correct practice ID (195900 for shared sandbox).',
    ],
    searchTerms: ['oauth scope', 'authentication', 'authorization'],
  },
  {
    pattern: /401|unauthorized|invalid.?token|token.?expired/i,
    causes: [
      'The access token has expired (default lifetime is 1 hour).',
      'The token was issued for a different environment (sandbox vs. production).',
      'The client_id or client_secret is incorrect.',
    ],
    fixes: [
      'Refresh the access token using the OAuth client credentials or authorization code flow.',
      'Verify you are using sandbox credentials against the sandbox endpoint and production credentials against production.',
      'Check that client_id and client_secret match the application registered in the developer portal.',
    ],
    searchTerms: ['oauth', 'token', 'authentication'],
  },
  {
    pattern: /400|bad.?request|invalid.?clinical.?status|invalid.?appointment.?status/i,
    causes: [
      'A required field is missing from the request body.',
      'An enum field contains a value not accepted for the current state.',
      'The appointment or clinical status transition is not allowed from the current status.',
    ],
    fixes: [
      'Check the enum_values in the knowledge base for valid status values.',
      'Verify all required fields for this endpoint are included in the request.',
      'Use athena_explain_view to review valid APPOINTMENTSTATUS or PATIENTSTATUS values.',
    ],
    searchTerms: ['status codes', 'enum values', 'required fields'],
  },
  {
    pattern: /429|rate.?limit|too.?many.?requests/i,
    causes: [
      'The application has exceeded athenahealth\'s API rate limit.',
      'Bulk or concurrent requests are not being throttled.',
    ],
    fixes: [
      'Implement exponential backoff with jitter between retries.',
      'Reduce concurrency — default limit is generally 10 requests/second per practice.',
      'Cache responses for stable data (departments, providers, appointment types) to reduce request volume.',
      'Add a X-Request-Id header to each request to improve server-side logging and debug stalled requests.',
    ],
    searchTerms: ['rate limiting', 'best practices', 'retry'],
  },
  {
    pattern: /contextid|context.?id|multi.?tenant|wrong.?practice/i,
    causes: [
      'CONTEXTID was included when querying a reader account (not required — reader accounts have implicit RLS).',
      'A service account query omitted CONTEXTID and returned data for all practices.',
      'The CONTEXTID value does not match the practice for the records being queried.',
    ],
    fixes: [
      'Reader accounts: remove WHERE CONTEXTID = N — row-level security is implicit.',
      'Service accounts: always filter WHERE CONTEXTID = <practice_id> on every table.',
      'Use athena_explain_join to verify CONTEXTID matching requirements for cross-table joins.',
    ],
    searchTerms: ['contextid', 'multi-tenant', 'reader account'],
  },
  {
    pattern: /soft.?delete|deleteddatetime|deletedby|deleted.?records/i,
    causes: [
      'The query includes soft-deleted records because the delete filter is missing.',
    ],
    fixes: [
      'Add WHERE DELETEDDATETIME IS NULL AND DELETEDBY IS NULL to exclude soft-deleted rows.',
      'Exception: VISITCHARGE uses VOIDEDBY/VOIDEDDATETIME instead of DELETEDBY/DELETEDDATETIME.',
    ],
    searchTerms: ['soft delete', 'deleted records'],
  },
  {
    pattern: /patient.?id|chart.?id|enterprise.?id|patient.?identity/i,
    causes: [
      'PATIENTID (financial) and CHARTID (clinical) are in separate key spaces — a direct join will silently lose ~46% of records.',
      'ENTERPRISEID (enterprise dedup key) is only available on the CHART table, not PATIENT.',
    ],
    fixes: [
      'Use CLINICALENCOUNTER as the bridge — it contains both PATIENTID and CHARTID.',
      'Do NOT join CHART.CHARTID = PATIENT.PATIENTID — only 54% overlap due to patient merges.',
      'Use athena_explain_join with sourceView=PATIENT and targetView=CHART for full identity-bridge guidance.',
    ],
    searchTerms: ['patient identity', 'chartid', 'patientid', 'clinicalencounter'],
  },
];

export async function handleDiagnoseError(
  kb: KnowledgeBase,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  if (!kb.isLoaded) return kbNotReady();

  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { errorMessage, context } = parsed.data;

  const matchedPatterns = KNOWN_PATTERNS.filter((p) =>
    p.pattern.test(errorMessage + ' ' + (context ?? ''))
  );

  const causes = matchedPatterns.flatMap((p) => p.causes);
  const fixes = matchedPatterns.flatMap((p) => p.fixes);

  const uniqueCauses = [...new Set(causes)];
  const uniqueFixes = [...new Set(fixes)];

  const searchTerms = matchedPatterns.flatMap((p) => p.searchTerms).slice(0, 3);
  const relatedDocs = searchTerms.length > 0
    ? kb.search(searchTerms.join(' '), 'all', 3)
    : kb.search(errorMessage, 'all', 3);

  const gotchaResults = kb.search(errorMessage, 'gotcha', 3);

  return jsonResult({
    errorMessage,
    context: context ?? null,
    matchedPatterns: matchedPatterns.length,
    likelyCauses: uniqueCauses.map((c, i) => ({
      cause: c,
      confidence: matchedPatterns[Math.floor(i / 1)]?.pattern.test(errorMessage) ? 0.85 : 0.5,
    })),
    suggestedFixes: uniqueFixes,
    relatedGotchas: gotchaResults.map((r) => ({
      title: (r.entity as { title: string }).title,
      snippet: r.snippet,
    })),
    relatedDocs: relatedDocs.map((r) => ({
      title: (r.entity as { title: string }).title,
      type: r.entityType,
      snippet: r.snippet,
    })),
    hint: matchedPatterns.length === 0
      ? 'No known pattern matched this error. Try athena_search_kb with keywords from the error.'
      : undefined,
  });
}
