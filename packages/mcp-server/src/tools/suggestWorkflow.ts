import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { KnowledgeBase } from '../db/kbStore.js';
import { jsonResult, kbNotReady } from './index.js';

export const SUGGEST_WORKFLOW_DEF: Tool = {
  name: 'athena_suggest_workflow',
  description:
    'Given an integration goal, suggests the recommended API sequence, required Snowflake views, ' +
    'known anti-patterns to avoid, and warnings. Specifically flags when a proposed automation ' +
    'is fighting the intended athenaOne workflow instead of using it — a common cause of ' +
    'failed integrations and partner certification failures.',
  inputSchema: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description:
          'Describe the integration goal, e.g. "sync patient demographics to external CRM", ' +
          '"auto-create appointments from a scheduling system", "upload lab results via API"',
      },
      context: {
        type: 'string',
        description:
          'Optional: additional context about your system, tech stack, or constraints.',
      },
    },
    required: ['goal'],
  },
} as const;

const InputSchema = z.object({
  goal: z.string().min(1),
  context: z.string().optional(),
});

const ANTI_PATTERNS = [
  {
    keywords: ['appointment', 'schedul', 'book', 'slot'],
    antiPattern:
      'Do not read available appointment slots by scraping the schedule and picking arbitrary times. ' +
      'Use GET /appointments/open to retrieve practice-defined open slots only.',
  },
  {
    keywords: ['patient', 'creat', 'add', 'register', 'sync'],
    antiPattern:
      'Do not create duplicate patient records. Always search for existing patients with ' +
      'GET /patients first. Use the patient matching parameters to avoid creating duplicates ' +
      'that require costly manual merges.',
  },
  {
    keywords: ['document', 'upload', 'attach', 'lab', 'result', 'fax'],
    antiPattern:
      'Do not bypass the document routing workflow by uploading documents directly to a chart. ' +
      'Use POST /documents/unfiledresults or the appropriate document type endpoint so that ' +
      'required routing and provider review steps are preserved.',
  },
  {
    keywords: ['claim', 'billing', 'charge', 'submit'],
    antiPattern:
      'Do not create charges before a clinical encounter is complete. The claim lifecycle ' +
      '(created → billed → accepted) must follow encounter completion. ' +
      'Bypassing encounter status leads to rejected claims.',
  },
  {
    keywords: ['delete', 'cancel', 'remove', 'void'],
    antiPattern:
      'Athenahealth uses soft deletes — do not hard-delete records via the API or SQL. ' +
      'Use the appropriate cancellation or void endpoints, which preserve audit trails.',
  },
  {
    keywords: ['bulk', 'batch', 'all patient', 'all appointment', 'full sync'],
    antiPattern:
      'Avoid full-table bulk syncs via the REST API. Use the /changed endpoints ' +
      '(e.g. GET /patients/changed, GET /appointments/changed) for incremental sync. ' +
      'Full scans hit rate limits and degrade practice performance.',
  },
];

export async function handleSuggestWorkflow(
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

  const { goal, context } = parsed.data;
  const combined = (goal + ' ' + (context ?? '')).toLowerCase();

  const matchedAntiPatterns = ANTI_PATTERNS.filter((ap) =>
    ap.keywords.some((kw) => combined.includes(kw))
  ).map((ap) => ap.antiPattern);

  const workflowDocs = kb.search(goal, 'workflow', 5);
  const apiDocs = kb.search(goal, 'api', 5);
  const schemaHits = kb.search(goal, 'schema', 5);

  const requiredViews = schemaHits
    .filter((r) => r.entityType === 'view')
    .map((r) => (r.entity as { viewName: string }).viewName);

  const steps: Array<{ step: number; action: string; details: string }> = [];

  let stepNum = 1;
  if (apiDocs.length > 0) {
    for (const doc of apiDocs.slice(0, 4)) {
      const d = doc.entity as { title: string; text: string };
      steps.push({
        step: stepNum++,
        action: d.title,
        details: d.text.slice(0, 250),
      });
    }
  } else {
    steps.push({
      step: 1,
      action: 'Search the knowledge base for relevant API endpoints',
      details: `Use athena_search_kb with filter="api" and query="${goal}" to find the specific endpoints.`,
    });
  }

  const warnings: string[] = [
    'Always test against the athenahealth sandbox (practice ID 195900) before production.',
    'Include X-Request-Id on every API call for tracing and debug support.',
    'Implement exponential backoff for 429 rate-limit responses.',
  ];

  if (matchedAntiPatterns.length > 0) {
    warnings.push(...matchedAntiPatterns.map((ap) => `Anti-pattern detected: ${ap}`));
  }

  const sources = [...workflowDocs, ...apiDocs].map((r) => ({
    title: (r.entity as { title: string }).title,
    url: (r.entity as { url?: string }).url,
    sourceTier: r.entity.sourceTier,
    confidence: r.entity.confidence,
  }));

  return jsonResult({
    goal,
    context: context ?? null,
    recommendedApproach:
      workflowDocs.length > 0
        ? `Found ${workflowDocs.length} guidance document(s) for this goal. Review the steps and sources below.`
        : `No direct workflow guidance found. The steps below are derived from API documentation and general integration patterns.`,
    steps,
    requiredViews,
    warnings,
    antiPatternsDetected: matchedAntiPatterns.length,
    sources: sources.slice(0, 5),
  });
}
