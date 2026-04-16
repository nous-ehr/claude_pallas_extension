/**
 * Source authority tiers for all KB content.
 * Every fact in the knowledge base carries a tier that reflects how it was obtained.
 */
export type SourceTier =
  | 'primary'    // Verified by live query or scraped directly from athenahealth DataView
  | 'secondary'  // Scraped from developer portal, help site, FHIR docs, or user guides
  | 'reference'  // Derived from public repos or inferred by pattern matching
  | 'inferred';  // Programmatically generated; not validated against live data

/**
 * Confidence score: 0.0 (no confidence) to 1.0 (fully verified).
 * Standard breakpoints:
 *   1.0 — verified by live query or explicit in athenahealth source
 *   0.7 — mentioned explicitly in column descriptions, not query-tested
 *   0.4 — inferred from column name patterns
 *   0.3 — derived from public repo analysis
 *   0.0 — contradicted by evidence; should be removed
 */
export type Confidence = number;

export interface Provenance {
  source: string;          // Human-readable source description, e.g. "dataview_scrape_2026-04-12"
  sourceTier: SourceTier;
  confidence: Confidence;
  lastVerified?: string;   // ISO 8601 date string
}
