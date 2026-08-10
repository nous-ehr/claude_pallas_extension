import type { KnowledgeBase } from '../db/kbStore.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { KbEndpoint, KbParameter } from '../types/kbSchema.js';
import { jsonResult } from './index.js';

/**
 * Return an athenaOne REST endpoint as a structured record.
 *
 * This exists because a coding agent turns an endpoint into code, and code
 * needs exact identifiers. A paragraph saying "you can supply patient
 * demographic details" cannot be typed; `agriculturalworkertype (string,
 * optional)` can. A guessed field name is a silent 400 rather than an error the
 * agent can see and correct.
 */

export const EXPLAIN_ENDPOINT_DEF: Tool = {
  name: 'athena_explain_endpoint',
  description:
    'Get the full structured definition of an athenaOne REST endpoint: method, path, ' +
    'every parameter with its type and whether it is required, request body fields, and ' +
    'response fields. Use this before writing any code that calls the API -- parameter ' +
    'names must be exact. Accepts an operationId ("postPracticeidPatients"), a path ' +
    '("/v1/{practiceid}/patients"), or "METHOD /path". If you do not know the ' +
    'identifier, use athena_search_kb first.',
  inputSchema: {
    type: 'object',
    properties: {
      endpoint: {
        type: 'string',
        description:
          'operationId, path, or "METHOD /path". e.g. "postPracticeidPatients" or ' +
          '"POST /v1/{practiceid}/patients".',
      },
      includeOptional: {
        type: 'boolean',
        description:
          'Include optional parameters. Defaults to true. Set false when you only ' +
          'need the minimum viable call -- some endpoints carry over 100 optional fields.',
      },
    },
    required: ['endpoint'],
  },
};

function shape(params: KbParameter[], includeOptional: boolean) {
  const chosen = includeOptional ? params : params.filter((p) => p.required);
  return chosen.map((p) => ({
    name: p.name,
    type: p.type,
    in: p.in,
    required: p.required,
    description: p.description || undefined,
  }));
}

export function handleExplainEndpoint(
  kb: KnowledgeBase,
  args: { endpoint?: string; includeOptional?: boolean }
): ReturnType<typeof jsonResult> {
  const query = (args.endpoint ?? '').trim();
  const includeOptional = args.includeOptional !== false;

  if (!query) {
    return jsonResult({ found: false, message: 'Provide an endpoint identifier.' });
  }

  let ep: KbEndpoint | undefined = kb.getEndpoint(query);

  // Fall back to search, but only accept an endpoint result -- returning a help
  // article to a request for an endpoint definition would be worse than
  // returning nothing, because the agent would write code from prose.
  if (!ep) {
    const hit = kb.search(query, 'api', 5).find((r) => r.entityType === 'endpoint');
    if (hit) ep = hit.entity as KbEndpoint;
  }

  if (!ep) {
    const near = kb
      .search(query, 'api', 5)
      .filter((r) => r.entityType === 'endpoint')
      .map((r) => {
        const e = r.entity as KbEndpoint;
        return `${e.method} ${e.path} (${e.endpointId})`;
      });
    return jsonResult({
      found: false,
      query,
      message: `No endpoint matched "${query}".`,
      didYouMean: near.length ? near : undefined,
      suggestion: 'Search with athena_search_kb to find the endpoint first.',
    });
  }

  const required = [
    ...ep.parameters.filter((p) => p.required),
    ...(ep.requestBody?.properties ?? []).filter((p) => p.required),
  ].map((p) => p.name);

  return jsonResult({
    found: true,
    endpointId: ep.endpointId,
    method: ep.method,
    path: ep.path,
    title: ep.title,
    description: ep.description,
    // Stated separately as well as inline: it is the first thing needed to make
    // a call succeed, and it should not have to be derived by filtering.
    requiredFields: required,
    parameters: shape(ep.parameters, includeOptional),
    requestBody: ep.requestBody
      ? {
          contentType: ep.requestBody.contentType,
          fields: shape(ep.requestBody.properties, includeOptional),
          omittedOptional: includeOptional
            ? 0
            : ep.requestBody.properties.filter((p) => !p.required).length,
        }
      : undefined,
    responses: (ep.responses ?? []).map((r) => ({
      status: r.status,
      contentType: r.contentType,
      fields: shape(r.properties, true),
    })),
    tags: ep.tags,
    apiCatalog: ep.apiCatalog,
    certifiedApi: ep.certifiedApi,
    sourceUrl: ep.url,
    sourceTier: ep.sourceTier,
    confidence: ep.confidence,
    lastVerified: ep.lastVerified,
  });
}
