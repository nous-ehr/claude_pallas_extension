import { CosmosClient, Database, Container } from '@azure/cosmos';
import { log } from '../config.js';

/**
 * Singleton Cosmos DB client for the learning loop.
 * Returns null if Cosmos is not configured (local dev without Azure).
 */

let _db: Database | null = null;
let _initialized = false;

function getCosmosConfig() {
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  const database = process.env.COSMOS_DATABASE ?? 'pallas-kb';

  if (!endpoint || !key) {
    return null;
  }
  return { endpoint, key, database };
}

export function getDatabase(): Database | null {
  if (_initialized) return _db;
  _initialized = true;

  const cfg = getCosmosConfig();
  if (!cfg) {
    log.info('Cosmos DB not configured — learning loop disabled. Set COSMOS_ENDPOINT and COSMOS_KEY to enable.');
    return null;
  }

  try {
    const client = new CosmosClient({ endpoint: cfg.endpoint, key: cfg.key });
    _db = client.database(cfg.database);
    log.info(`Cosmos DB connected: ${cfg.endpoint} / ${cfg.database}`);
    return _db;
  } catch (err) {
    log.error('Failed to connect to Cosmos DB', err);
    return null;
  }
}

export function getContainer(name: string): Container | null {
  const db = getDatabase();
  if (!db) return null;
  return db.container(name);
}
