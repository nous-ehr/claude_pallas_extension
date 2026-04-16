import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { KnowledgeBase } from '../db/kbStore.js';
import type { KbColumn, KbEnumValue } from '../types/kbSchema.js';
import { jsonResult, kbNotReady } from './index.js';

export const EXPLAIN_VIEW_DEF: Tool = {
  name: 'athena_explain_view',
  description:
    'Returns detailed information about an athenahealth Snowflake DataView view: ' +
    'description, columns with data types, known enum values, FK relationships, ' +
    'and any operational gotchas. Use this before writing SQL against any view.',
  inputSchema: {
    type: 'object',
    properties: {
      viewName: {
        type: 'string',
        description: 'View name, e.g. "PATIENT" or "ATHENAONE.PATIENT" or "APPOINTMENTVIEW"',
      },
      includeColumns: {
        type: 'boolean',
        description: 'Include column list with data types. Defaults to true.',
        default: true,
      },
      includeRelationships: {
        type: 'boolean',
        description: 'Include known FK relationships from this view. Defaults to true.',
        default: true,
      },
      includeGotchas: {
        type: 'boolean',
        description: 'Include operational warnings specific to this view. Defaults to true.',
        default: true,
      },
    },
    required: ['viewName'],
  },
} as const;

const InputSchema = z.object({
  viewName: z.string().min(1),
  includeColumns: z.boolean().default(true),
  includeRelationships: z.boolean().default(true),
  includeGotchas: z.boolean().default(true),
});

export async function handleExplainView(
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

  const { viewName, includeColumns, includeRelationships, includeGotchas } = parsed.data;

  // Accept "SCHEMA.VIEW" or just "VIEW"
  const nameOnly = viewName.includes('.') ? viewName.split('.').pop()! : viewName;

  const view = kb.findView(nameOnly);
  if (!view) {
    const hits = kb.search(viewName, 'schema', 3);
    return jsonResult({
      found: false,
      viewName,
      message: `View "${viewName}" not found in the knowledge base.`,
      suggestions: hits.map((h) => ({
        viewName: (h.entity as { viewName: string }).viewName,
        description: h.snippet,
      })),
    });
  }

  const result: Record<string, unknown> = {
    found: true,
    viewId: view.viewId,
    viewName: view.viewName,
    schema: view.schema,
    database: view.database,
    description: view.description,
    domain: view.domain,
    isLookup: view.isLookup,
    columnCount: view.columnCount,
    rowCount: view.rowCount,
    rowCountNote: view.rowCountNote,
    confidence: view.confidence,
    sourceTier: view.sourceTier,
    source: view.source,
  };

  if (includeColumns) {
    const cols = kb.getColumnsForView(view.viewId);
    result['columns'] = cols.map((c: KbColumn) => {
      const enums = kb.getEnumsForColumn(c.columnId);
      const colEntry: Record<string, unknown> = {
        name: c.columnName,
        dataType: c.dataType,
        nullable: c.nullable,
        description: c.description,
        isPrimaryKey: c.isPrimaryKey,
        isEnum: c.isEnum,
        isDeprecated: c.isDeprecated,
      };
      if (enums.length > 0) {
        colEntry['enumValues'] = enums.map((e: KbEnumValue) => ({
          value: e.value,
          meaning: e.meaning,
          confidence: e.confidence,
        }));
      }
      return colEntry;
    });
  }

  if (includeRelationships) {
    const rels = kb.getRelationshipsFrom(view.viewName);
    result['relationships'] = rels.map((r) => ({
      sourceColumn: r.sourceColumn,
      targetView: r.targetView,
      targetColumn: r.targetColumn,
      confidence: r.confidence,
      type: r.relationshipType,
    }));
  }

  if (includeGotchas) {
    const viewNameUpper = view.viewName.toUpperCase();
    const relevantGotchas = kb
      .getAllGotchas()
      .filter(
        (g) =>
          !g.appliesTo ||
          g.appliesTo.toUpperCase() === viewNameUpper ||
          g.appliesTo === 'all'
      );
    result['gotchas'] = relevantGotchas.map((g) => ({
      title: g.title,
      description: g.description,
      severity: g.severity,
    }));
  }

  return jsonResult(result);
}
