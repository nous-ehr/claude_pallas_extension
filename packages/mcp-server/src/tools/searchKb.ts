import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { KnowledgeBase } from '../db/kbStore.js';
import { jsonResult, kbNotReady } from './index.js';
import type { SearchFilter } from '../types/kbSchema.js';

export const SEARCH_KB_DEF: Tool = {
  name: 'athena_search_kb',
  description:
    'Search the Athena Tools knowledge base. Returns views, columns, API endpoints, ' +
    'workflows, FHIR resources, gotchas, and error patterns relevant to the query. ' +
    'Every result includes a confidence score and the source tier ' +
    '(primary = verified live data, secondary = scraped docs, reference = public repos).',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query, e.g. "patient identity join" or "appointment status codes"',
      },
      filter: {
        type: 'string',
        enum: ['all', 'schema', 'api', 'workflow', 'fhir', 'gotcha', 'error'],
        description: 'Narrow results to a specific content type. Defaults to "all".',
        default: 'all',
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (1–20). Defaults to 5.',
        default: 5,
      },
    },
    required: ['query'],
  },
} as const;

const InputSchema = z.object({
  query: z.string().min(1),
  filter: z
    .enum(['all', 'schema', 'api', 'workflow', 'fhir', 'gotcha', 'error'])
    .default('all'),
  limit: z.number().int().min(1).max(20).default(5),
});

export async function handleSearchKb(
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

  const { query, filter, limit } = parsed.data;
  const results = kb.search(query, filter as SearchFilter, limit);

  if (results.length === 0) {
    return jsonResult({
      query,
      filter,
      totalFound: 0,
      results: [],
      hint: 'No results found. Try broadening the query or changing the filter.',
    });
  }

  const formatted = results.map((r) => ({
    type: r.entityType,
    score: Math.round(r.score * 100) / 100,
    confidence: (r.entity as { confidence: number }).confidence,
    sourceTier: (r.entity as { sourceTier: string }).sourceTier,
    snippet: r.snippet,
    detail: summariseEntity(r.entityType, r.entity),
  }));

  return jsonResult({
    query,
    filter,
    totalFound: results.length,
    results: formatted,
  });
}

function summariseEntity(type: string, entity: unknown): Record<string, unknown> {
  const e = entity as Record<string, unknown>;
  switch (type) {
    case 'view':
      return {
        viewId: e['viewId'],
        viewName: e['viewName'],
        schema: e['schema'],
        description: e['description'],
        domain: e['domain'],
        columnCount: e['columnCount'],
      };
    case 'column':
      return {
        columnId: e['columnId'],
        viewName: e['viewName'],
        columnName: e['columnName'],
        dataType: e['dataType'],
        description: e['description'],
        isPrimaryKey: e['isPrimaryKey'],
      };
    case 'gotcha':
      return {
        gotchaId: e['gotchaId'],
        title: e['title'],
        description: e['description'],
        severity: e['severity'],
        appliesTo: e['appliesTo'],
      };
    case 'document':
      return {
        docId: e['docId'],
        title: e['title'],
        docType: e['docType'],
        url: e['url'],
      };
    default:
      return e;
  }
}
