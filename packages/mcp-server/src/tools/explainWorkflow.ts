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

  // Evidence, not prose.
  //
  // This returned `documentExcerpts` -- three documents truncated at 600
  // characters and joined into one string -- alongside three hard-coded
  // `integrationGuidance` lines that appeared whatever the question was. Both
  // decided the answer before the agent saw anything: it never learned what was
  // cut, never saw documents four onward, and could not ask for more. Standing
  // guidance now lives in the server instructions, where it is stated once
  // rather than appended to every result.
  const documents = [...workflowDocs, ...apiDocs].map((r) => {
    const e = r.entity as {
      docId?: string; title: string; url?: string; docType?: string; text?: string;
    };
    return {
      docId: e.docId,
      title: e.title,
      url: e.url,
      docType: e.docType,
      sourceTier: r.entity.sourceTier,
      confidence: r.entity.confidence,
      relevanceScore: r.score,
      snippet: r.snippet,
      // So the agent can decide whether the snippet is enough before spending a
      // fetch on the rest.
      textLength: e.text?.length ?? 0,
    };
  });

  // A view entry without a name is not a view. These were returned with a
  // description and no `viewName`, which rendered as "undefined:" -- portal
  // pages misclassified as schema. Better to return fewer and have them be real.
  const relatedViews = schemaHits
    .map((r) => ({
      viewName:
        (r.entity as { viewName?: string }).viewName ??
        (r.entity as { columnName?: string }).columnName,
      description: r.snippet,
    }))
    .filter((v) => Boolean(v.viewName));

  return jsonResult({
    found: true,
    workflow,
    summary:
      `Found ${workflowDocs.length} workflow/guide document(s) and ` +
      `${apiDocs.length} API reference document(s) related to "${workflow}".`,
    documents,
    relatedViews,
    // Retrieve the full text of any document above with athena_search_kb, or
    // read the URL directly.
    nextStep:
      documents.length > 0
        ? 'Fetch the full text of whichever documents look relevant before answering.'
        : undefined,
  });
}
