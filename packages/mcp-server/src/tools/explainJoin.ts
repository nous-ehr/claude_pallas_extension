import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { KnowledgeBase } from '../db/kbStore.js';
import { jsonResult, kbNotReady } from './index.js';

export const EXPLAIN_JOIN_DEF: Tool = {
  name: 'athena_explain_join',
  description:
    'Explains how to join two athenahealth Snowflake DataView views. Returns the join ' +
    'columns, confidence level, known warnings (e.g. CONTEXTID requirements, multi-tenant ' +
    'row-level security), and a sample SQL snippet. Always call this before writing a JOIN ' +
    'to avoid silent data loss from incorrect key usage.',
  inputSchema: {
    type: 'object',
    properties: {
      sourceView: {
        type: 'string',
        description: 'The starting view, e.g. "APPOINTMENT"',
      },
      targetView: {
        type: 'string',
        description: 'The view to join to, e.g. "DEPARTMENT"',
      },
    },
    required: ['sourceView', 'targetView'],
  },
} as const;

const InputSchema = z.object({
  sourceView: z.string().min(1),
  targetView: z.string().min(1),
});

export async function handleExplainJoin(
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

  const srcName = parsed.data.sourceView.toUpperCase().split('.').pop()!;
  const tgtName = parsed.data.targetView.toUpperCase().split('.').pop()!;

  // Check identity patterns first (special cases like PATIENT/CHART/CLINICALENCOUNTER)
  const identityPatterns = kb.getAllIdentityPatterns();
  const relevantPattern = identityPatterns.find(
    (p) =>
      p.chain.some((s) => s.from.toUpperCase().includes(srcName)) &&
      p.chain.some((s) => s.from.toUpperCase().includes(tgtName) || (s.to?.toUpperCase() ?? '').includes(tgtName))
  );

  // Look up direct relationship
  const directRel = kb.findRelationshipPath(srcName, tgtName);
  const reverseRel = directRel ? undefined : kb.findRelationshipPath(tgtName, srcName);
  const rel = directRel ?? reverseRel;

  // Validate source and target views exist
  const srcView = kb.findView(srcName);
  const tgtView = kb.findView(tgtName);

  if (!srcView && !tgtView) {
    return jsonResult({
      found: false,
      message: `Neither "${srcName}" nor "${tgtName}" found in the knowledge base. Check spelling.`,
    });
  }

  const warnings: string[] = [];
  const notes: string[] = [];

  warnings.push(
    'Reader account: implicit row-level security is active — no CONTEXTID filter needed unless you are on a multi-tenant service account.'
  );

  if (relevantPattern) {
    notes.push(`Identity pattern "${relevantPattern.name}" applies — read warnings carefully.`);
    for (const w of relevantPattern.warnings) {
      warnings.push(w);
    }
  }

  let joinSteps: Array<{
    from: string;
    fromColumn: string;
    to: string;
    toColumn: string;
    confidence: number;
    reversed: boolean;
  }> = [];

  let sampleSql = '';

  if (rel) {
    const isReversed = !!reverseRel;
    const fromView = isReversed ? rel.targetView : rel.sourceView;
    const toView = isReversed ? rel.sourceView : rel.targetView;
    const fromCol = isReversed ? rel.targetColumn : rel.sourceColumn;
    const toCol = isReversed ? rel.sourceColumn : rel.targetColumn;

    joinSteps = [
      {
        from: fromView,
        fromColumn: fromCol,
        to: toView,
        toColumn: toCol,
        confidence: rel.confidence,
        reversed: isReversed,
      },
    ];

    if (rel.confidence < 0.5) {
      warnings.push(
        `Low confidence (${rel.confidence}) — this join path was inferred from column name patterns, ` +
          `not verified by a live query. Validate before use in production.`
      );
    }

    sampleSql = buildSampleSql(fromView, toView, fromCol, toCol);
  } else {
    const bridgeTables = ['CLINICALENCOUNTER', 'DOCUMENT', 'CHART'];
    for (const bridge of bridgeTables) {
      const hop1 = kb.findRelationshipPath(srcName, bridge);
      const hop2 = kb.findRelationshipPath(bridge, tgtName) ?? kb.findRelationshipPath(tgtName, bridge);
      if (hop1 && hop2) {
        warnings.push(
          `No direct join found. Suggested two-hop path through ${bridge} (validate before use).`
        );
        joinSteps = [
          { from: hop1.sourceView, fromColumn: hop1.sourceColumn, to: hop1.targetView, toColumn: hop1.targetColumn, confidence: hop1.confidence, reversed: false },
          { from: hop2.sourceView, fromColumn: hop2.sourceColumn, to: hop2.targetView, toColumn: hop2.targetColumn, confidence: hop2.confidence, reversed: false },
        ];
        sampleSql = `-- Two-hop join via ${bridge}\n` + buildSampleSql(hop1.sourceView, hop1.targetView, hop1.sourceColumn, hop1.targetColumn) + '\n' + buildSampleSql(hop2.sourceView, hop2.targetView, hop2.sourceColumn, hop2.targetColumn);
        break;
      }
    }

    if (joinSteps.length === 0) {
      warnings.push(
        'No join path found in the knowledge base. This may be a new relationship not yet captured, ' +
          'or these views may not be directly joinable. Check the DataView documentation.'
      );
    }
  }

  notes.push('Most ATHENAONE views use soft deletes. Filter: WHERE DELETEDDATETIME IS NULL AND DELETEDBY IS NULL');

  return jsonResult({
    sourceView: srcName,
    targetView: tgtName,
    joinSteps,
    sampleSql: sampleSql || null,
    warnings,
    notes,
    identityPattern: relevantPattern
      ? { name: relevantPattern.name, description: relevantPattern.description }
      : null,
  });
}

function buildSampleSql(src: string, tgt: string, srcCol: string, tgtCol: string): string {
  return (
    `SELECT s.*, t.*\n` +
    `FROM ATHENAHEALTH.ATHENAONE.${src} s\n` +
    `JOIN ATHENAHEALTH.ATHENAONE.${tgt} t\n` +
    `  ON s.${srcCol} = t.${tgtCol}\n` +
    `WHERE s.DELETEDDATETIME IS NULL\n` +
    `LIMIT 100;`
  );
}
