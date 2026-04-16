import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getContainer } from '../learning/cosmosClient.js';
import { log } from '../config.js';
import type { Candidate, LearnedGotcha } from '../learning/classifier.js';

// ---------------------------------------------------------------------------
// Tool: athena_list_candidates
// ---------------------------------------------------------------------------

export const LIST_CANDIDATES_DEF: Tool = {
  name: 'athena_list_candidates',
  description:
    'Lists pending knowledge base update candidates from the review queue. ' +
    'These are high-impact discoveries (schema corrections, relationship changes, ' +
    'identity patterns) that were flagged by the learning loop and need human approval ' +
    'before being added to the knowledge base.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'approved', 'rejected', 'all'],
        description: 'Filter by status. Defaults to "pending".',
        default: 'pending',
      },
      limit: {
        type: 'number',
        description: 'Maximum candidates to return (1–50). Defaults to 10.',
        default: 10,
      },
    },
  },
} as const;

const ListInputSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
  limit: z.number().int().min(1).max(50).default(10),
});

export async function handleListCandidates(
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const container = getContainer('candidates');
  if (!container) {
    return {
      content: [{ type: 'text', text: 'Cosmos DB not configured. The review system requires Azure Cosmos DB.' }],
      isError: true,
    };
  }

  const parsed = ListInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { status, limit } = parsed.data;

  const query = status === 'all'
    ? `SELECT * FROM c ORDER BY c.createdAt DESC OFFSET 0 LIMIT ${limit}`
    : `SELECT * FROM c WHERE c.status = "${status}" ORDER BY c.createdAt DESC OFFSET 0 LIMIT ${limit}`;

  const { resources } = await container.items.query<Candidate>(query).fetchAll();

  if (resources.length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: 0,
          status,
          message: status === 'pending'
            ? 'No pending candidates. The review queue is empty.'
            : `No candidates with status "${status}".`,
        }, null, 2),
      }],
    };
  }

  const formatted = resources.map((c) => ({
    id: c.id,
    status: c.status,
    type: c.proposedChange.type,
    title: c.proposedChange.title,
    description: c.proposedChange.description,
    appliesTo: c.proposedChange.appliesTo ?? 'all',
    severity: c.proposedChange.severity ?? 'info',
    confidence: c.confidence,
    createdAt: c.createdAt,
    sourceContext: c.sourceContext,
  }));

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        count: resources.length,
        status,
        candidates: formatted,
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// Tool: athena_review_candidate
// ---------------------------------------------------------------------------

export const REVIEW_CANDIDATE_DEF: Tool = {
  name: 'athena_review_candidate',
  description:
    'Approve or reject a pending knowledge base update candidate. ' +
    'Approved candidates are promoted to the learned knowledge base with elevated confidence. ' +
    'Rejected candidates are marked with the rejection reason for audit.',
  inputSchema: {
    type: 'object',
    properties: {
      candidateId: {
        type: 'string',
        description: 'The ID of the candidate to review (from athena_list_candidates).',
      },
      decision: {
        type: 'string',
        enum: ['approve', 'reject'],
        description: 'Approve to add to KB, reject to discard.',
      },
      note: {
        type: 'string',
        description: 'Optional review note explaining the decision.',
      },
    },
    required: ['candidateId', 'decision'],
  },
} as const;

const ReviewInputSchema = z.object({
  candidateId: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
  note: z.string().optional(),
});

export async function handleReviewCandidate(
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const candidatesContainer = getContainer('candidates');
  if (!candidatesContainer) {
    return {
      content: [{ type: 'text', text: 'Cosmos DB not configured.' }],
      isError: true,
    };
  }

  const parsed = ReviewInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { candidateId, decision, note } = parsed.data;

  // Find the candidate — query across all partitions
  const { resources } = await candidatesContainer.items
    .query<Candidate>(`SELECT * FROM c WHERE c.id = "${candidateId}"`)
    .fetchAll();

  if (resources.length === 0) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Candidate "${candidateId}" not found.` }) }],
      isError: true,
    };
  }

  const candidate = resources[0];

  if (candidate.status !== 'pending') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: `Candidate already ${candidate.status}. Only pending candidates can be reviewed.`,
        }),
      }],
      isError: true,
    };
  }

  // Update candidate status
  candidate.status = decision === 'approve' ? 'approved' : 'rejected';
  candidate.reviewedAt = new Date().toISOString();
  candidate.reviewNote = note;

  await candidatesContainer.item(candidate.id, candidate.entityType).replace(candidate);

  // If approved, promote to learned-gotchas
  if (decision === 'approve') {
    const gotchasContainer = getContainer('learned-gotchas');
    if (gotchasContainer) {
      const gotcha: LearnedGotcha = {
        id: randomUUID(),
        gotchaId: `approved-${candidateId.slice(0, 8)}`,
        title: candidate.proposedChange.title,
        description: candidate.proposedChange.description,
        appliesTo: candidate.proposedChange.appliesTo ?? 'all',
        severity: (candidate.proposedChange.severity as 'info' | 'warning') ?? 'warning',
        confidence: 0.7, // Elevated confidence — human-reviewed
        sourceTier: 'inferred',
        source: `review-approved-${new Date().toISOString().slice(0, 10)}`,
        createdAt: new Date().toISOString(),
        confirmedCount: 1,
      };

      await gotchasContainer.items.create(gotcha);
      log.info(`Candidate approved and promoted: "${gotcha.title}" (confidence: 0.7)`);
    }
  } else {
    log.info(`Candidate rejected: "${candidate.proposedChange.title}" — ${note ?? 'no reason'}`);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        candidateId,
        decision,
        note: note ?? null,
        result: decision === 'approve'
          ? `Approved and promoted to knowledge base with confidence 0.7. Title: "${candidate.proposedChange.title}"`
          : `Rejected. Title: "${candidate.proposedChange.title}"`,
      }, null, 2),
    }],
  };
}
