-- D1 schema for the Pallas telemetry Worker.
-- Apply with: wrangler d1 execute pallas-telemetry --file=schema.sql

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  install_id  TEXT NOT NULL,
  timestamp   TEXT NOT NULL,
  payload     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_install_id ON events(install_id);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
