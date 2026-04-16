import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** Runtime configuration for the Pallas MCP server. */
export interface ServerConfig {
  /** Absolute path to the built KB directory (contains kb.json, meta.json, etc.) */
  kbPath: string;
  /** Minimum confidence score to include in results (0.0 – 1.0) */
  minConfidence: number;
  /** Log level for stderr output */
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  /** Transport mode: stdio for local dev, http for Azure deployment */
  transport: 'stdio' | 'http';
  /** Port for HTTP transport (default: 8080) */
  port: number;
}

function resolveKbPath(): string {
  // Priority order:
  // 1. PALLAS_KB_PATH environment variable (if it exists on disk)
  // 2. ./data relative to cwd (for Azure App Service deployments)
  // 3. Default: ~/pallas-kb
  const envPath = process.env.PALLAS_KB_PATH;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }
  // Azure App Service: cwd is /home/site/wwwroot, data/ is a sibling
  const cwdData = join(process.cwd(), 'data');
  if (existsSync(cwdData)) {
    return cwdData;
  }
  const defaultPath = join(homedir(), 'pallas-kb');
  return defaultPath;
}

function resolveLogLevel(): ServerConfig['logLevel'] {
  const level = process.env.PALLAS_LOG_LEVEL ?? 'error';
  const valid = ['error', 'warn', 'info', 'debug'] as const;
  return valid.includes(level as ServerConfig['logLevel'])
    ? (level as ServerConfig['logLevel'])
    : 'error';
}

function resolveTransport(): ServerConfig['transport'] {
  const transport = process.env.PALLAS_TRANSPORT ?? 'stdio';
  return transport === 'http' ? 'http' : 'stdio';
}

export const config: ServerConfig = {
  kbPath: resolveKbPath(),
  minConfidence: parseFloat(process.env.PALLAS_MIN_CONFIDENCE ?? '0.3'),
  logLevel: resolveLogLevel(),
  transport: resolveTransport(),
  port: parseInt(process.env.PALLAS_PORT ?? '8080', 10),
};

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const configuredLevel = LEVELS[config.logLevel];

/** All logging goes to stderr so stdout stays clean for the MCP JSON-RPC protocol. */
export const log = {
  error: (msg: string, ...args: unknown[]) => {
    if (configuredLevel >= LEVELS.error) {
      console.error(`[pallas:error] ${msg}`, ...args);
    }
  },
  warn: (msg: string, ...args: unknown[]) => {
    if (configuredLevel >= LEVELS.warn) {
      console.error(`[pallas:warn] ${msg}`, ...args);
    }
  },
  info: (msg: string, ...args: unknown[]) => {
    if (configuredLevel >= LEVELS.info) {
      console.error(`[pallas:info] ${msg}`, ...args);
    }
  },
  debug: (msg: string, ...args: unknown[]) => {
    if (configuredLevel >= LEVELS.debug) {
      console.error(`[pallas:debug] ${msg}`, ...args);
    }
  },
};
