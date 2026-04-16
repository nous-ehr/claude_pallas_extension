import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { KnowledgeBase } from '../db/kbStore.js';
import { jsonResult, kbNotReady } from './index.js';

export const EXPLAIN_WORKFLOW_DEF: Tool = {
  name: 'athena_explain_workflow',
  description:
    'Explains a named athenahealth clinical or administrative workflow: the intended sequence ' +
    'of steps inside athenaOne, the API calls that correspond to each step, the Snowflake views ' +
    'that capture the workflow state, and common integration mistakes. ' +
    'Use this to understand the INTENDED system behaviour before building an automation — ' +
    'many integration failures stem from automating around the workflow instead of through it.',
  inputSchema: {
    type: 'object',
    properties: {
      workflow: {
        type: 'string',
        description:
          'Name of the workflow to explain, e.g. "patient check-in", "appointment scheduling", ' +
          '"claim submission", "document upload", "referral creation", "lab result processing"',
      },
    },
    required: ['workflow'],
  },
} as const;

const InputSchema = z.object({
  workflow: z.string().min(1),
});

export async function handleExplainWorkflow(
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

  const { workflow } = parsed.data;

  const workflowDocs = kb.search(workflow, 'workflow', 8);
  const apiDocs = kb.search(workflow, 'api', 5);
  const schemaHits = kb.search(workflow, 'schema', 5);

  if (workflowDocs.length === 0 && apiDocs.length === 0) {
    return jsonResult({
      found: false,
      workflow,
      message: `No workflow documentation found for "${workflow}".`,
      suggestion: 'Try athena_search_kb with keywords from the workflow name.',
    });
  }

  const sources = [...workflowDocs, ...apiDocs].map((r) => ({
    title: (r.entity as { title: string }).title,
    url: (r.entity as { url?: string }).url,
    docType: (r.entity as { docType?: string }).docType,
    sourceTier: r.entity.sourceTier,
    confidence: r.entity.confidence,
    relevanceScore: r.score,
  }));

  const relatedViews = schemaHits.map((r) => ({
    viewName: (r.entity as { viewName?: string }).viewName ?? (r.entity as { columnName?: string }).columnName,
    description: r.snippet,
  }));

  const documentTexts = workflowDocs
    .slice(0, 3)
    .map((r) => {
      const doc = r.entity as { title: string; text: string };
      return `### ${doc.title}\n${doc.text.slice(0, 600)}...`;
    })
    .join('\n\n');

  return jsonResult({
    found: true,
    workflow,
    summary:
      `Found ${workflowDocs.length} workflow/guide document(s) and ` +
      `${apiDocs.length} API reference document(s) related to "${workflow}".`,
    documentExcerpts: documentTexts || null,
    relatedViews,
    relatedApiDocs: apiDocs.slice(0, 3).map((r) => ({
      title: (r.entity as { title: string }).title,
      url: (r.entity as { url?: string }).url,
      snippet: r.snippet,
    })),
    sources,
    integrationGuidance: [
      `Before building an automation for "${workflow}", verify that athenaOne has a built-in workflow for this.`,
      'Many integration issues arise from automating around the product rather than using the intended workflow.',
      'Use athena_suggest_workflow to get a recommended integration approach for a specific goal.',
    ],
  });
}
