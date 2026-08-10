import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { config, log } from './config.js';
import { KnowledgeBase } from './db/kbStore.js';
import { registerTools, TOOL_DEFINITIONS } from './tools/index.js';

// ---------------------------------------------------------------------------
// Initialise the knowledge base (load once at startup)
// ---------------------------------------------------------------------------

const kb = new KnowledgeBase(config.kbPath);

try {
  kb.load();
} catch (err) {
  log.error('Failed to load knowledge base', err);
}

// ---------------------------------------------------------------------------
// Create MCP server
// ---------------------------------------------------------------------------

// Standing guidance, stated once at initialisation rather than appended to
// every tool result. Each line is here because it guards a specific, likely
// mistake against this corpus -- not as general advice.
const INSTRUCTIONS = `athenahealth knowledge base: DataView schema, athenaOne API reference, O-help product documentation, Success Community support articles, and release notes.

Before concluding that no documentation exists, search at least twice with different phrasing, and check both the API reference and the release notes. Behaviour is often changed in a release note without the reference being updated.

Data View and the athenaOne API are different products. Querying data is usually Data View; reading or writing records is usually the API. Say which one you are answering about.

Every Data View query needs CONTEXTID. Omitting it returns another practice's data, or nothing.

Success Community articles are dated, and many describe issues that have since been resolved. A workaround from 2022 is history, not current guidance -- give the date whenever you cite one.

Tools return evidence, not answers. Snippets are short by design: fetch the documents that look relevant and compose the answer yourself, using what you can see and the tools cannot -- the user's code, their stack, and what they have already tried.`;

const server = new Server(
  {
    name: 'athena-tools',
    version: '0.2.0',
  },
  {
    capabilities: {
      tools: {},
    },
    instructions: INSTRUCTIONS,
  }
);

// ---------------------------------------------------------------------------
// Register tool list handler
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOL_DEFINITIONS };
});

// ---------------------------------------------------------------------------
// Register tool call dispatcher
// ---------------------------------------------------------------------------

const toolHandlers = registerTools(kb);

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  log.debug(`Tool call: ${name}`, args);

  const handler = toolHandlers.get(name);
  if (!handler) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }

  try {
    return await handler(args ?? {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Tool ${name} failed: ${message}`, err);
    throw new McpError(ErrorCode.InternalError, `Tool ${name} failed: ${message}`);
  }
});

// ---------------------------------------------------------------------------
// Transport: stdio (local dev) or HTTP/SSE (Azure deployment)
// ---------------------------------------------------------------------------

async function startStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('Athena Tools MCP server started (stdio)');
}

async function startHttp() {
  const express = await import('express');
  const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');

  const app = express.default();
  const port = config.port;

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({
      status: kb.isLoaded ? 'healthy' : 'degraded',
      kbLoaded: kb.isLoaded,
      kbMeta: kb.meta ?? null,
      toolCount: TOOL_DEFINITIONS.length,
      transport: 'http/sse',
      uptime: process.uptime(),
    });
  });

  // SSE endpoint for MCP clients
  let sseTransport: InstanceType<typeof SSEServerTransport> | null = null;

  app.get('/sse', async (_req, res) => {
    log.info('SSE client connected');
    sseTransport = new SSEServerTransport('/messages', res);
    await server.connect(sseTransport);
  });

  app.post('/messages', async (req, res) => {
    if (!sseTransport) {
      res.status(503).json({ error: 'No active SSE connection' });
      return;
    }
    await sseTransport.handlePostMessage(req, res);
  });

  app.listen(port, () => {
    log.info(`Athena Tools MCP server started (HTTP/SSE) on port ${port}`);
    console.error(`[pallas] Server listening on http://0.0.0.0:${port}`);
    console.error(`[pallas] Health check: http://0.0.0.0:${port}/health`);
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  if (config.transport === 'http') {
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  log.error('Fatal MCP server error', err);
  process.exit(1);
});
