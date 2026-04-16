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

const server = new Server(
  {
    name: 'athena-tools',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
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
    const { existsSync } = require('fs');
    const { join } = require('path');
    const kbFile = join(config.kbPath, 'kb.json');
    res.json({
      status: kb.isLoaded ? 'healthy' : 'degraded',
      kbLoaded: kb.isLoaded,
      kbMeta: kb.meta ?? null,
      toolCount: TOOL_DEFINITIONS.length,
      transport: 'http/sse',
      uptime: process.uptime(),
      debug: {
        kbPath: config.kbPath,
        kbFileExpected: kbFile,
        kbFileExists: existsSync(kbFile),
        cwd: process.cwd(),
        cwdContents: require('fs').readdirSync(process.cwd()),
        cwdDataExists: existsSync(join(process.cwd(), 'data')),
        cwdDataKbExists: existsSync(join(process.cwd(), 'data', 'kb.json')),
        env_PALLAS_KB_PATH: process.env.PALLAS_KB_PATH ?? '(not set)',
      },
    });
  });

  // SSE endpoint for MCP clients
  let sseTransport: InstanceType<typeof SSEServerTransport> | null = null;

  app.get('/sse', async (req, res) => {
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
