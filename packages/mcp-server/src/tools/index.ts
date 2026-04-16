import type { KnowledgeBase } from '../db/kbStore.js';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { handleSearchKb, SEARCH_KB_DEF } from './searchKb.js';
import { handleExplainView, EXPLAIN_VIEW_DEF } from './explainView.js';
import { handleExplainJoin, EXPLAIN_JOIN_DEF } from './explainJoin.js';
import { handleDiagnoseError, DIAGNOSE_ERROR_DEF } from './diagnoseError.js';
import { handleExplainWorkflow, EXPLAIN_WORKFLOW_DEF } from './explainWorkflow.js';
import { handleSuggestWorkflow, SUGGEST_WORKFLOW_DEF } from './suggestWorkflow.js';

export const TOOL_DEFINITIONS: Tool[] = [
  SEARCH_KB_DEF,
  EXPLAIN_VIEW_DEF,
  EXPLAIN_JOIN_DEF,
  DIAGNOSE_ERROR_DEF,
  EXPLAIN_WORKFLOW_DEF,
  SUGGEST_WORKFLOW_DEF,
];

type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

export function registerTools(kb: KnowledgeBase): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  handlers.set('athena_search_kb', (args) => handleSearchKb(kb, args));
  handlers.set('athena_explain_view', (args) => handleExplainView(kb, args));
  handlers.set('athena_explain_join', (args) => handleExplainJoin(kb, args));
  handlers.set('athena_diagnose_error', (args) => handleDiagnoseError(kb, args));
  handlers.set('athena_explain_workflow', (args) => handleExplainWorkflow(kb, args));
  handlers.set('athena_suggest_workflow', (args) => handleSuggestWorkflow(kb, args));
  return handlers;
}

/** Convenience: wrap a plain object result as MCP text content. */
export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/** Convenience: return a not-ready message when the KB hasn't been built. */
export function kbNotReady(): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: [
          'The Athena Tools knowledge base has not been loaded.',
          'Ensure kb.json exists in the configured PALLAS_KB_PATH directory.',
          'Check the server logs for details.',
        ].join('\n'),
      },
    ],
    isError: true,
  };
}
