import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { log } from '../config.js';

/**
 * Persistent install identifier. One UUID per machine, written to ~/.claude/pallas-install-id
 * on first run, read on every subsequent run. Used to group telemetry events by install
 * cohort. Contains no PII — it's a random UUID, nothing more.
 *
 * For stdio installs (npm), this lives on the developer's laptop. For the Azure-hosted
 * server, this lives on the App Service instance. Both populate the same field so cohort
 * analysis works across deployment modes.
 */

const INSTALL_ID_FILE = join(homedir(), '.claude', 'pallas-install-id');

let _installId: string | null = null;

export function getInstallId(): string {
  if (_installId) return _installId;

  // Env var override (useful for Azure: each App Service instance shares one ID)
  const envId = process.env.PALLAS_INSTALL_ID;
  if (envId) {
    _installId = envId;
    return _installId;
  }

  try {
    if (existsSync(INSTALL_ID_FILE)) {
      const stored = readFileSync(INSTALL_ID_FILE, 'utf-8').trim();
      if (stored.length >= 8) {
        _installId = stored;
        return _installId;
      }
    }
  } catch (err) {
    log.debug(`Could not read install ID: ${err}`);
  }

  // Generate and persist
  const fresh = randomUUID();
  try {
    mkdirSync(join(homedir(), '.claude'), { recursive: true });
    writeFileSync(INSTALL_ID_FILE, fresh, { encoding: 'utf-8' });
    log.info(`Generated new Pallas install ID at ${INSTALL_ID_FILE}`);
  } catch (err) {
    log.debug(`Could not persist install ID — using in-memory only: ${err}`);
  }
  _installId = fresh;
  return _installId;
}
