import { randomUUID } from 'crypto';
import { getContainer } from './cosmosClient.js';
import { log } from '../config.js';

/**
 * Structured feedback categories. When Claude supplies a category, the candidate
 * pipeline can triage 10x faster — reviewers see "schema_correction on
 * DOCUMENT.STATUS" instead of free-form prose.
 *
 * Free-text learnedPattern still works (it's the fallback when the model can't
 * categorize). But categorized feedback skips the keyword-classification step
 * in classify() below.
 */
export type FeedbackCategory =
  | 'schema_correction'      // A column/view doesn't behave as documented
  | 'join_path'              // A join column or path differs from documented
  | 'identity_pattern'       // PATIENT/CHART/identity-related discovery (always high-risk)
  | 'missing_filter'         // A missing soft-delete or other essential WHERE clause
  | 'error_pattern'          // An error + resolution worth remembering
  | 'workflow_step'          // A workflow step or precondition missing from docs
  | 'enum_value'             // A column's enum values are incomplete in the KB
  | 'gotcha'                 // General gotcha that doesn't fit above
  | 'other';

/**
 * Feedback submitted by Claude Code after resolving an interaction.
 */
export interface FeedbackPayload {
  outcome: 'success' | 'failure';
  context: string;            // What the user was trying to do
  resolution?: string;        // What worked (if success) or what was tried (if failure)
  toolsUsed: string[];        // Which MCP tools were called
  errorEncountered?: string;  // Error message if applicable
  learnedPattern?: string;    // Pattern or gotcha discovered during interaction
  // Structured taxonomy (optional, backward-compatible)
  category?: FeedbackCategory;
  target?: string;            // e.g. "DOCUMENT.STATUS", "APPOINTMENT.SCHEDULINGPROVIDERID"
  sessionId?: string;         // Correlates with athena_command_start
}

/**
 * A candidate KB update awaiting human review.
 */
export interface Candidate {
  id: string;
  entityType: string;         // Partition key: 'gotcha', 'error_pattern', 'relationship', 'schema'
  status: 'pending' | 'approved' | 'rejected';
  proposedChange: {
    type: 'new_gotcha' | 'new_error_pattern' | 'schema_correction' | 'relationship_change';
    title: string;
    description: string;
    appliesTo?: string;
    severity?: 'critical' | 'warning' | 'info';
  };
  sourceContext: string;      // What interaction produced this
  confidence: number;
  sourceTier: 'inferred';
  createdAt: string;
  reviewedAt?: string;
  reviewNote?: string;
}

/**
 * A learned gotcha that was auto-merged (low risk).
 */
export interface LearnedGotcha {
  id: string;
  gotchaId: string;
  title: string;
  description: string;
  appliesTo: string;          // Partition key
  severity: 'info' | 'warning';
  confidence: number;
  sourceTier: 'inferred';
  source: string;
  createdAt: string;
  confirmedCount: number;     // How many times this pattern has been confirmed
}

/**
 * Risk classification result.
 */
type RiskLevel = 'low' | 'high';

interface ClassificationResult {
  risk: RiskLevel;
  type: 'new_gotcha' | 'new_error_pattern' | 'schema_correction' | 'relationship_change';
  title: string;
  description: string;
  appliesTo?: string;
  severity?: 'critical' | 'warning' | 'info';
}

/**
 * Classify a feedback payload and route it appropriately.
 *
 * Low risk → auto-merge to learned-gotchas container
 * High risk → queue in candidates container for human review
 */
export async function classifyAndRoute(feedback: FeedbackPayload): Promise<{
  action: 'auto_merged' | 'queued_for_review' | 'no_action';
  details: string;
}> {
  const classification = classify(feedback);
  if (!classification) {
    return { action: 'no_action', details: 'No actionable pattern detected in feedback.' };
  }

  if (classification.risk === 'low') {
    return await autoMerge(classification, feedback);
  } else {
    return await queueForReview(classification, feedback);
  }
}

/**
 * Classify the feedback into a risk level and change type.
 *
 * Strategy:
 *   1. If feedback.category is provided, use it directly (fast path).
 *   2. Otherwise fall back to keyword heuristics on learnedPattern (legacy path).
 */
function classify(feedback: FeedbackPayload): ClassificationResult | null {
  // ----- Structured fast path -----
  if (feedback.category) {
    return classifyByCategory(feedback);
  }

  // ----- Legacy keyword-based path -----
  if (!feedback.learnedPattern && !feedback.errorEncountered) {
    if (feedback.outcome === 'success') return null;
    return null;
  }

  // Error pattern detection (LOW RISK — auto-merge)
  if (feedback.errorEncountered && feedback.outcome === 'success' && feedback.resolution) {
    return {
      risk: 'low',
      type: 'new_error_pattern',
      title: `Error pattern: ${normalizeForTitle(feedback.errorEncountered)}`,
      description: `Error: ${feedback.errorEncountered}\nResolution: ${feedback.resolution}\nContext: ${feedback.context}`,
      severity: 'warning',
    };
  }

  // Learned gotcha/pattern (risk depends on content)
  if (feedback.learnedPattern) {
    const isSchemaRelated = /column|table|view|join|relationship|foreign.?key|data.?type/i.test(feedback.learnedPattern);
    const isIdentityRelated = /patientid|chartid|enterpriseid|identity/i.test(feedback.learnedPattern);

    if (isSchemaRelated || isIdentityRelated) {
      return {
        risk: 'high',
        type: isIdentityRelated ? 'relationship_change' : 'schema_correction',
        title: `Discovered: ${normalizeForTitle(feedback.learnedPattern)}`,
        description: `Pattern: ${feedback.learnedPattern}\nContext: ${feedback.context}\nResolution: ${feedback.resolution ?? 'N/A'}`,
        severity: 'critical',
      };
    }

    return {
      risk: 'low',
      type: 'new_gotcha',
      title: normalizeForTitle(feedback.learnedPattern),
      description: `${feedback.learnedPattern}\nContext: ${feedback.context}`,
      appliesTo: extractAppliesTo(feedback),
      severity: 'info',
    };
  }

  return null;
}

/**
 * Structured-feedback fast path. Trusts the supplied category, applies a fixed
 * risk policy per category. No keyword matching, no false positives.
 */
function classifyByCategory(feedback: FeedbackPayload): ClassificationResult | null {
  const pattern = feedback.learnedPattern ?? feedback.errorEncountered ?? feedback.resolution ?? '';
  const targetSuffix = feedback.target ? ` (${feedback.target})` : '';
  const title = `${feedback.category!}${targetSuffix}: ${normalizeForTitle(pattern || feedback.context)}`;
  const description = [
    `Category: ${feedback.category}`,
    feedback.target ? `Target: ${feedback.target}` : null,
    `Pattern: ${pattern || '(none provided)'}`,
    `Context: ${feedback.context}`,
    feedback.resolution ? `Resolution: ${feedback.resolution}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  switch (feedback.category) {
    case 'identity_pattern':
      return {
        risk: 'high',
        type: 'relationship_change',
        title,
        description,
        appliesTo: feedback.target,
        severity: 'critical',
      };
    case 'schema_correction':
    case 'join_path':
      return {
        risk: 'high',
        type: 'schema_correction',
        title,
        description,
        appliesTo: feedback.target,
        severity: 'critical',
      };
    case 'enum_value':
      return {
        risk: 'high',
        type: 'schema_correction',
        title,
        description,
        appliesTo: feedback.target,
        severity: 'warning',
      };
    case 'error_pattern':
      return {
        risk: 'low',
        type: 'new_error_pattern',
        title,
        description,
        severity: 'warning',
      };
    case 'missing_filter':
    case 'workflow_step':
    case 'gotcha':
      return {
        risk: 'low',
        type: 'new_gotcha',
        title,
        description,
        appliesTo: feedback.target ?? extractAppliesTo(feedback),
        severity: 'info',
      };
    case 'other':
    default:
      return {
        risk: 'low',
        type: 'new_gotcha',
        title,
        description,
        appliesTo: feedback.target ?? extractAppliesTo(feedback),
        severity: 'info',
      };
  }
}

/**
 * Auto-merge a low-risk pattern into the learned-gotchas container.
 */
async function autoMerge(
  classification: ClassificationResult,
  _feedback: FeedbackPayload
): Promise<{ action: 'auto_merged'; details: string }> {
  const container = getContainer('learned-gotchas');
  if (!container) {
    return { action: 'auto_merged', details: 'Cosmos not configured — pattern noted but not persisted.' };
  }

  const gotcha: LearnedGotcha = {
    id: randomUUID(),
    gotchaId: `learned-${randomUUID().slice(0, 8)}`,
    title: classification.title,
    description: classification.description,
    appliesTo: classification.appliesTo ?? 'all',
    severity: (classification.severity as 'info' | 'warning') ?? 'info',
    confidence: 0.3,          // Low confidence for inferred patterns
    sourceTier: 'inferred',
    source: `learning-loop-${new Date().toISOString().slice(0, 10)}`,
    createdAt: new Date().toISOString(),
    confirmedCount: 1,
  };

  await container.items.create(gotcha);
  log.info(`Auto-merged learned gotcha: "${gotcha.title}" (confidence: 0.3)`);

  return {
    action: 'auto_merged',
    details: `Pattern auto-merged as learned gotcha with confidence 0.3: "${classification.title}"`,
  };
}

/**
 * Queue a high-risk change for human review.
 */
async function queueForReview(
  classification: ClassificationResult,
  feedback: FeedbackPayload
): Promise<{ action: 'queued_for_review'; details: string }> {
  const container = getContainer('candidates');
  if (!container) {
    return { action: 'queued_for_review', details: 'Cosmos not configured — change noted but not persisted.' };
  }

  const candidate: Candidate = {
    id: randomUUID(),
    entityType: classification.type,
    status: 'pending',
    proposedChange: {
      type: classification.type,
      title: classification.title,
      description: classification.description,
      appliesTo: classification.appliesTo,
      severity: classification.severity,
    },
    sourceContext: `${feedback.context}\nTools used: ${feedback.toolsUsed.join(', ')}`,
    confidence: 0.3,
    sourceTier: 'inferred',
    createdAt: new Date().toISOString(),
  };

  await container.items.create(candidate);
  log.info(`Queued candidate for review: "${classification.title}" (type: ${classification.type})`);

  return {
    action: 'queued_for_review',
    details: `High-impact change queued for human review: "${classification.title}" (type: ${classification.type})`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeForTitle(text: string): string {
  return text
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function extractAppliesTo(feedback: FeedbackPayload): string {
  // Try to extract a view name from the context
  const viewMatch = feedback.context.match(/\b([A-Z]{2,}(?:VIEW)?)\b/);
  return viewMatch ? viewMatch[1] : 'all';
}
