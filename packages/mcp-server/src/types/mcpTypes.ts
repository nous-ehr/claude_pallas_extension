import type { KbSearchResult } from './kbSchema.js';
import type { SourceTier } from './provenance.js';

// ---------------------------------------------------------------------------
// Tool: athena_search_kb
// ---------------------------------------------------------------------------

export type { SearchFilter } from './kbSchema.js';

export interface SearchKbInput {
  query: string;
  filter?: import('./kbSchema.js').SearchFilter;
  limit?: number;
  minConfidence?: number;
}

export interface SearchKbOutput {
  results: KbSearchResult[];
  totalFound: number;
  query: string;
  filter: import('./kbSchema.js').SearchFilter;
}

// ---------------------------------------------------------------------------
// Tool: athena_explain_view
// ---------------------------------------------------------------------------

export interface ExplainViewInput {
  viewName: string;
  includeColumns?: boolean;
  includeRelationships?: boolean;
  includeGotchas?: boolean;
}

export interface ExplainViewOutput {
  viewId: string;
  viewName: string;
  schema: string;
  description: string;
  domain?: string;
  isLookup: boolean;
  columns?: ColumnSummary[];
  relationships?: RelationshipSummary[];
  gotchas?: GotchaSummary[];
  confidence: number;
  sourceTier: SourceTier;
  source: string;
}

export interface ColumnSummary {
  name: string;
  dataType: string;
  description: string;
  isPrimaryKey: boolean;
  isEnum: boolean;
  enumValues?: string[];
}

export interface RelationshipSummary {
  sourceColumn: string;
  targetView: string;
  targetColumn: string;
  confidence: number;
}

export interface GotchaSummary {
  title: string;
  description: string;
  severity: string;
}

// ---------------------------------------------------------------------------
// Tool: athena_explain_join
// ---------------------------------------------------------------------------

export interface ExplainJoinInput {
  sourceView: string;
  targetView: string;
}

export interface ExplainJoinOutput {
  sourceView: string;
  targetView: string;
  joinPath: JoinStep[];
  warningCount: number;
  warnings: string[];
  sampleSql: string;
  confidence: number;
}

export interface JoinStep {
  from: string;
  fromColumn: string;
  to: string;
  toColumn: string;
  confidence: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Tool: athena_diagnose_error
// ---------------------------------------------------------------------------

export interface DiagnoseErrorInput {
  errorMessage: string;
  context?: string;
}

export interface DiagnoseOutput {
  errorMessage: string;
  likelyCauses: DiagnoseCause[];
  suggestedFixes: string[];
  relatedDocs: KbSearchResult[];
}

export interface DiagnoseCause {
  cause: string;
  confidence: number;
  source: string;
}

// ---------------------------------------------------------------------------
// Tool: athena_explain_workflow
// ---------------------------------------------------------------------------

export interface ExplainWorkflowInput {
  workflow: string;
}

export interface ExplainWorkflowOutput {
  workflowName: string;
  summary: string;
  steps: WorkflowStep[];
  relatedViews: string[];
  relatedEndpoints: string[];
  gotchas: GotchaSummary[];
  sources: WorkflowSource[];
}

export interface WorkflowStep {
  stepNumber: number;
  action: string;
  details: string;
  apiOrView?: string;
}

export interface WorkflowSource {
  title: string;
  url?: string;
  tier: SourceTier;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Tool: athena_suggest_workflow
// ---------------------------------------------------------------------------

export interface SuggestWorkflowInput {
  goal: string;
  context?: string;
}

export interface SuggestWorkflowOutput {
  goal: string;
  recommendedApproach: string;
  steps: WorkflowStep[];
  requiredViews: string[];
  requiredEndpoints: string[];
  warnings: string[];
  antiPatterns: string[];
  sources: WorkflowSource[];
}
