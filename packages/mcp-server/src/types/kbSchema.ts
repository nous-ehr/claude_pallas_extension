import type { Provenance } from './provenance.js';

// ---------------------------------------------------------------------------
// Structured KB entities (Snowflake DataView schema)
// ---------------------------------------------------------------------------

export interface KbView extends Provenance {
  viewId: string;           // e.g. "ATHENAHEALTH.ATHENAONE.PATIENT"
  database: string;         // e.g. "ATHENAHEALTH"
  schema: string;           // e.g. "ATHENAONE"
  viewName: string;         // e.g. "PATIENT"
  description: string;
  rowCount?: number;
  rowCountNote?: string;    // e.g. "Sample reader account only"
  domain?: string;          // e.g. "patient", "billing", "scheduling"
  isLookup: boolean;
  columnCount: number;
}

export interface KbColumn extends Provenance {
  columnId: string;         // e.g. "ATHENAONE.PATIENT.PATIENTID"
  viewId: string;
  viewName: string;
  columnName: string;
  dataType: string;
  nullable?: boolean;
  ordinalPosition?: number;
  description: string;
  isPrimaryKey: boolean;
  isEnum: boolean;
  isDeprecated: boolean;
}

export interface KbEnumValue extends Provenance {
  columnId: string;         // e.g. "ATHENAONE.PATIENT.PATIENTSTATUS"
  value: string;
  meaning: string;
  count?: number;
  countNote?: string;
}

export interface KbRelationship extends Provenance {
  relationshipId: string;   // e.g. "APPOINTMENT.PATIENTID->PATIENT.PATIENTID"
  sourceView: string;
  sourceColumn: string;
  targetView: string;
  targetColumn: string;
  relationshipType: 'foreign_key' | 'inferred';
  requiresContextMatch: boolean;
  validationCount: number;
}

export interface KbIdentityPattern extends Provenance {
  patternId: string;
  name: string;
  description: string;
  chain: IdentityChainStep[];
  warnings: string[];
}

export interface IdentityChainStep {
  step: number;
  from: string;             // e.g. "PATIENT.PATIENTID"
  to: string | null;        // null = terminal
  domain: string;
}

export interface KbGotcha extends Provenance {
  gotchaId: string;
  title: string;
  description: string;
  appliesTo?: string;
  exceptions?: string[];
  severity: 'critical' | 'warning' | 'info';
}

export interface KbInternalTable extends Provenance {
  tableName: string;
  status: 'internal';
  referencedBy: string[];
  note: string;
}

// ---------------------------------------------------------------------------
// Unstructured documents (API docs, help files, FHIR docs, workflows)
// ---------------------------------------------------------------------------

export type DocType =
  | 'api_endpoint'
  | 'workflow'
  | 'best_practice'
  | 'fhir'
  | 'user_guide'
  | 'error_pattern'
  | 'schema_reference'
  | 'release_note';

export interface KbDocument extends Provenance {
  docId: string;
  url?: string;
  title: string;
  text: string;
  docType: DocType;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Search result wrapper (returned by all retrieval operations)
// ---------------------------------------------------------------------------

export type KbEntity =
  | KbEndpoint
  | KbView
  | KbColumn
  | KbEnumValue
  | KbRelationship
  | KbIdentityPattern
  | KbGotcha
  | KbDocument;

// ---------------------------------------------------------------------------
// API endpoints (athenaOne REST, from the developer portal's OpenAPI records)
// ---------------------------------------------------------------------------
//
// Endpoints are structured rather than prose because a coding agent turns them
// into code, and code needs exact identifiers. "You can supply patient
// demographic details" is unusable; `agriculturalworkertype (string, optional)`
// is directly usable, and a guessed field name is a silent 400 rather than an
// error the agent can see.
//
// Flattening these to documents lost 3,861 typed parameters across 902
// endpoints -- postPracticeidPatients alone carries 113 properties, 4 of them
// required.

export interface KbParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'body' | 'formData';
  type: string;
  required: boolean;
  description?: string;
}

export interface KbEndpoint extends Provenance {
  endpointId: string;       // operationId, e.g. "postPracticeidPatients"
  method: string;           // "GET" | "POST" | "PUT" | "DELETE"
  path: string;             // e.g. "/v1/{practiceid}/patients"
  title: string;
  description?: string;
  parameters: KbParameter[];
  requestBody?: {
    contentType: string;
    properties: KbParameter[];
  };
  responses?: Array<{
    status: string;
    contentType?: string;
    properties: KbParameter[];
  }>;
  tags?: string[];
  apiCatalog?: string;      // source spec file, e.g. "Patients.yaml"
  certifiedApi?: boolean;
  url?: string;
}

export type KbEntityType =
  | 'view'
  | 'column'
  | 'enum_value'
  | 'relationship'
  | 'identity_pattern'
  | 'gotcha'
  | 'endpoint'
  | 'document';

export interface KbSearchResult {
  entityType: KbEntityType;
  entity: KbEntity;
  score: number;           // Relevance score from the search engine
  snippet?: string;        // Highlighted excerpt from text
}

// ---------------------------------------------------------------------------
// KB metadata (stored at the root of the kb directory)
// ---------------------------------------------------------------------------

export interface KbMeta {
  version: string;
  builtAt: string;         // ISO 8601
  viewCount: number;
  columnCount: number;
  documentCount: number;
  sources: KbMetaSource[];
}

export interface KbMetaSource {
  name: string;
  tier: string;
  docCount: number;
  ingestedAt: string;
}

// Search filter type
export type SearchFilter =
  | 'all'
  | 'schema'
  | 'api'
  | 'workflow'
  | 'fhir'
  | 'gotcha'
  | 'error';
