/**
 * DO SQLite schema for request traces.
 * Each Durable Object instance stores one request's data.
 */

/**
 * Initialize the DO SQLite schema.
 * Creates tables if they don't exist.
 */
export function initSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      request_id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      options_r2_key TEXT,
      manifest_r2_key TEXT,
      external_json TEXT,
      derived_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      attempt INTEGER,
      data_json TEXT
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      kind TEXT NOT NULL,
      r2_key TEXT NOT NULL,
      content_type TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (kind, r2_key)
    );

    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  `);
}
