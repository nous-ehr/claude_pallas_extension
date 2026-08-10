import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import MiniSearch from 'minisearch';
import type {
  KbEndpoint,
  KbView,
  KbColumn,
  KbEnumValue,
  KbRelationship,
  KbIdentityPattern,
  KbGotcha,
  KbDocument,
  KbMeta,
  KbSearchResult,
  SearchFilter,
} from '../types/kbSchema.js';
import { log } from '../config.js';

// ---------------------------------------------------------------------------
// On-disk format (written by the ingestion pipeline)
// ---------------------------------------------------------------------------

interface KbStore {
  meta: KbMeta;
  views: KbView[];
  columns: KbColumn[];
  enumValues: KbEnumValue[];
  relationships: KbRelationship[];
  identityPatterns: KbIdentityPattern[];
  gotchas: KbGotcha[];
  endpoints: KbEndpoint[];
  documents: KbDocument[];
}

// ---------------------------------------------------------------------------
// Search document shapes (flattened for MiniSearch indexing)
// ---------------------------------------------------------------------------

interface EndpointDoc {
  id: string;
  type: 'endpoint';
  title: string;
  text: string;
  confidence: number;
  sourceTier: string;
}

interface ViewDoc {
  id: string;
  type: 'view';
  text: string;
  title: string;
  confidence: number;
  sourceTier: string;
  docType?: string;
}

interface ColumnDoc {
  id: string;
  type: 'column';
  text: string;
  title: string;
  confidence: number;
  sourceTier: string;
  docType?: string;
}

interface DocDocument {
  id: string;
  type: 'document';
  text: string;
  title: string;
  confidence: number;
  sourceTier: string;
  docType: string;
}

interface GotchaDoc {
  id: string;
  type: 'gotcha';
  text: string;
  title: string;
  confidence: number;
  sourceTier: string;
  docType?: string;
}

type SearchDoc = ViewDoc | ColumnDoc | DocDocument | GotchaDoc | EndpointDoc;

// ---------------------------------------------------------------------------
// KnowledgeBase: loads once on startup, answers queries synchronously
// ---------------------------------------------------------------------------

export class KnowledgeBase {
  private store: KbStore | null = null;
  private index: MiniSearch<SearchDoc> | null = null;
  private readonly kbPath: string;

  // Quick-lookup maps built at load time
  private viewsById = new Map<string, KbView>();
  private columnsByViewId = new Map<string, KbColumn[]>();
  private enumsByColumnId = new Map<string, KbEnumValue[]>();
  private relationshipsByView = new Map<string, KbRelationship[]>();
  private gotchasById = new Map<string, KbGotcha>();
  private identityPatternsById = new Map<string, KbIdentityPattern>();

  constructor(kbPath: string) {
    this.kbPath = kbPath;
  }

  // -------------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------------

  load(): void {
    const kbFile = join(this.kbPath, 'kb.json');
    if (!existsSync(kbFile)) {
      log.warn(`Knowledge base not found at ${kbFile}. Ensure kb.json is in the data/ directory.`);
      return;
    }

    log.info(`Loading knowledge base from ${kbFile}...`);
    const raw = readFileSync(kbFile, 'utf-8');
    this.store = JSON.parse(raw) as KbStore;

    this.buildLookups();
    this.buildIndex();
    log.info(
      `Knowledge base loaded: ${this.store.views.length} views, ` +
        `${this.store.columns.length} columns, ` +
        `${this.store.documents.length} documents.`
    );
  }

  get isLoaded(): boolean {
    return this.store !== null;
  }

  get meta(): KbMeta | undefined {
    return this.store?.meta;
  }

  // -------------------------------------------------------------------------
  // Build lookup maps
  // -------------------------------------------------------------------------

  private buildLookups(): void {
    if (!this.store) return;

    for (const v of this.store.views) {
      this.viewsById.set(v.viewId.toUpperCase(), v);
      this.viewsById.set(v.viewName.toUpperCase(), v);
    }

    for (const c of this.store.columns) {
      const existing = this.columnsByViewId.get(c.viewId) ?? [];
      existing.push(c);
      this.columnsByViewId.set(c.viewId, existing);
    }

    for (const e of this.store.enumValues) {
      const existing = this.enumsByColumnId.get(e.columnId) ?? [];
      existing.push(e);
      this.enumsByColumnId.set(e.columnId, existing);
    }

    for (const r of this.store.relationships) {
      const key = r.sourceView.toUpperCase();
      const existing = this.relationshipsByView.get(key) ?? [];
      existing.push(r);
      this.relationshipsByView.set(key, existing);
    }

    for (const g of this.store.gotchas) {
      this.gotchasById.set(g.gotchaId, g);
    }

    for (const p of this.store.identityPatterns) {
      this.identityPatternsById.set(p.patternId, p);
    }
  }

  // -------------------------------------------------------------------------
  // Build MiniSearch index
  // -------------------------------------------------------------------------

  private buildIndex(): void {
    if (!this.store) return;

    this.index = new MiniSearch<SearchDoc>({
      fields: ['title', 'text'],
      storeFields: ['type', 'title', 'confidence', 'sourceTier', 'docType'],
      searchOptions: {
        boost: { title: 2 },
        fuzzy: 0.2,
        prefix: true,
      },
    });

    const docs: SearchDoc[] = [];

    for (const v of this.store.views) {
      docs.push({
        id: `view:${v.viewId}`,
        type: 'view',
        title: v.viewName,
        text: [v.viewName, v.schema, v.description, v.domain ?? ''].join(' '),
        confidence: v.confidence,
        sourceTier: v.sourceTier,
      });
    }

    for (const c of this.store.columns) {
      docs.push({
        id: `col:${c.columnId}`,
        type: 'column',
        title: `${c.viewName}.${c.columnName}`,
        text: [c.viewName, c.columnName, c.description].join(' '),
        confidence: c.confidence,
        sourceTier: c.sourceTier,
      });
    }

    for (const g of this.store.gotchas) {
      docs.push({
        id: `gotcha:${g.gotchaId}`,
        type: 'gotcha',
        title: g.title,
        text: [g.title, g.description, g.appliesTo ?? ''].join(' '),
        confidence: g.confidence,
        sourceTier: g.sourceTier,
      });
    }

    for (const e of this.store.endpoints ?? []) {
      const paramNames = [
        ...e.parameters.map((p) => p.name),
        ...(e.requestBody?.properties ?? []).map((p) => p.name),
      ];
      docs.push({
        id: `ep:${e.endpointId}`,
        type: 'endpoint',
        title: `${e.method} ${e.path}`,
        // operationId and every parameter name are indexed: a coding agent
        // searches for the identifier it has to type, not for a description.
        text: [e.method, e.path, e.endpointId, e.title, e.description ?? '',
               (e.tags ?? []).join(' '), paramNames.join(' ')].join(' '),
        confidence: e.confidence,
        sourceTier: e.sourceTier,
      });
    }

    for (const d of this.store.documents) {
      docs.push({
        id: `doc:${d.docId}`,
        type: 'document',
        title: d.title,
        text: [d.title, d.text].join(' '),
        confidence: d.confidence,
        sourceTier: d.sourceTier,
        docType: d.docType,
      });
    }

    this.index.addAll(docs);
    log.info(`Search index built: ${docs.length} documents.`);
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  search(
    query: string,
    filter: SearchFilter = 'all',
    limit = 5,
    minConfidence = 0.0
  ): KbSearchResult[] {
    if (!this.index || !this.store) return [];

    const rawResults = this.index.search(query);

    const results: KbSearchResult[] = [];

    for (const hit of rawResults) {
      if (results.length >= limit) break;

      const id = hit.id as string;
      const score = hit.score;

      if (id.startsWith('view:')) {
        if (filter !== 'all' && filter !== 'schema') continue;
        const viewId = id.slice('view:'.length);
        const view = this.store.views.find((v) => v.viewId === viewId || v.viewName === viewId);
        if (!view || view.confidence < minConfidence) continue;
        results.push({ entityType: 'view', entity: view, score, snippet: view.description.slice(0, 200) });

      } else if (id.startsWith('col:')) {
        if (filter !== 'all' && filter !== 'schema') continue;
        const colId = id.slice('col:'.length);
        const col = this.store.columns.find((c) => c.columnId === colId);
        if (!col || col.confidence < minConfidence) continue;
        results.push({ entityType: 'column', entity: col, score, snippet: col.description.slice(0, 200) });

      } else if (id.startsWith('gotcha:')) {
        if (filter !== 'all' && filter !== 'gotcha' && filter !== 'error') continue;
        const gId = id.slice('gotcha:'.length);
        const gotcha = this.gotchasById.get(gId);
        if (!gotcha || gotcha.confidence < minConfidence) continue;
        results.push({ entityType: 'gotcha', entity: gotcha, score, snippet: gotcha.description.slice(0, 200) });

      } else if (id.startsWith('ep:')) {
        const endpointId = id.slice('ep:'.length);
        const ep = (this.store.endpoints ?? []).find((e) => e.endpointId === endpointId);
        if (!ep || ep.confidence < minConfidence) continue;
        if (filter !== 'all' && filter !== 'api') continue;
        results.push({
          entityType: 'endpoint',
          entity: ep,
          score,
          snippet: `${ep.method} ${ep.path} - ${ep.title}`,
        });

      } else if (id.startsWith('doc:')) {
        const docId = id.slice('doc:'.length);
        const doc = this.store.documents.find((d) => d.docId === docId);
        if (!doc || doc.confidence < minConfidence) continue;

        if (filter !== 'all') {
          if (filter === 'api' && doc.docType !== 'api_endpoint') continue;
          if (filter === 'workflow' && !['workflow', 'best_practice', 'user_guide'].includes(doc.docType)) continue;
          if (filter === 'fhir' && doc.docType !== 'fhir') continue;
          if (filter === 'error' && doc.docType !== 'error_pattern') continue;
        }

        results.push({ entityType: 'document', entity: doc, score, snippet: doc.text.slice(0, 300) });
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Structured lookups (used by specific tools)
  // -------------------------------------------------------------------------

  findView(name: string): KbView | undefined {
    return this.viewsById.get(name.toUpperCase());
  }

  getColumnsForView(viewId: string): KbColumn[] {
    return this.columnsByViewId.get(viewId) ?? [];
  }

  getEnumsForColumn(columnId: string): KbEnumValue[] {
    return this.enumsByColumnId.get(columnId) ?? [];
  }

  getRelationshipsFrom(viewName: string): KbRelationship[] {
    return this.relationshipsByView.get(viewName.toUpperCase()) ?? [];
  }

  getAllGotchas(): KbGotcha[] {
    return this.store?.gotchas ?? [];
  }

  /**
   * Look up an endpoint by operationId, path, or "METHOD /path".
   *
   * An agent that already has the identifier should not have to search for it
   * and hope ranking cooperates -- searching for `postPracticeidPatients` and
   * getting the third result is the failure this avoids.
   */
  getEndpoint(idOrPath: string): KbEndpoint | undefined {
    if (!this.store?.endpoints) return undefined;
    const needle = idOrPath.trim().toLowerCase();
    return this.store.endpoints.find(
      (e) =>
        e.endpointId.toLowerCase() === needle ||
        e.path.toLowerCase() === needle ||
        `${e.method} ${e.path}`.toLowerCase() === needle
    );
  }

  getAllEndpoints(): KbEndpoint[] {
    return this.store?.endpoints ?? [];
  }

  getIdentityPattern(patternId: string): KbIdentityPattern | undefined {
    return this.identityPatternsById.get(patternId);
  }

  getAllIdentityPatterns(): KbIdentityPattern[] {
    return this.store?.identityPatterns ?? [];
  }

  findRelationshipPath(
    sourceView: string,
    targetView: string
  ): KbRelationship | undefined {
    const src = sourceView.toUpperCase();
    const tgt = targetView.toUpperCase();
    const rels = this.getRelationshipsFrom(src);
    return rels.find(
      (r) => r.targetView.toUpperCase() === tgt
    );
  }

  searchDocuments(query: string, docTypes: string[], limit = 5): KbDocument[] {
    if (!this.store) return [];
    const lower = query.toLowerCase();
    return this.store.documents
      .filter(
        (d) =>
          docTypes.includes(d.docType) &&
          (d.title.toLowerCase().includes(lower) || d.text.toLowerCase().includes(lower))
      )
      .slice(0, limit);
  }
}
