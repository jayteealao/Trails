/**
 * DO SQLite schema for request traces.
 *
 * Keying scheme: each Durable Object instance is an hour bucket
 * (`bucket:YYYYMMDDHH` UTC) holding every request initialized in that hour.
 * Pre-bucket instances (keyed by request_id, one request per DO) still exist
 * and are served read-only via the dual-read fallback in index.ts.
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
      request_id TEXT NOT NULL DEFAULT '',
      ts TEXT NOT NULL,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      attempt INTEGER,
      data_json TEXT
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      request_id TEXT NOT NULL DEFAULT '',
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
  // The request_id indexes live in migrateSchema: on legacy instances the
  // column does not exist until migrateSchema adds it, and ensureSchema
  // always runs migrateSchema immediately after initSchema.
}

/**
 * Migrate a pre-bucket DO instance to the multi-request layout.
 *
 * Bucket DOs hold many requests, so `events` and `artifacts` need a
 * `request_id` column. Legacy per-request instances stored exactly one
 * request, so their rows are adopted under that request's id, letting every
 * read path filter on `request_id` uniformly across old and new instances.
 *
 * Idempotent: each statement either no-ops (IF NOT EXISTS, 0 rows matched)
 * or fails with "duplicate column name", which is swallowed; anything else
 * is rethrown.
 */
export function migrateSchema(sql: SqlStorage): void {
  addColumnIfMissing(sql, 'events', "request_id TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(sql, 'artifacts', "request_id TEXT NOT NULL DEFAULT ''");
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_events_request_id ON events(request_id)`);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_artifacts_request_id ON artifacts(request_id)`);
  // Legacy per-request instances hold exactly one requests row; adopt all
  // unattributed rows under it. No-op on bucket instances (writes there
  // always carry request_id) and on empty instances (no rows match).
  sql.exec(
    `UPDATE events SET request_id = COALESCE((SELECT request_id FROM requests LIMIT 1), '')
     WHERE request_id = ''`
  );
  sql.exec(
    `UPDATE artifacts SET request_id = COALESCE((SELECT request_id FROM requests LIMIT 1), '')
     WHERE request_id = ''`
  );
}

function addColumnIfMissing(sql: SqlStorage, table: string, columnDef: string): void {
  try {
    sql.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('duplicate column')) {
      throw err;
    }
  }
}
