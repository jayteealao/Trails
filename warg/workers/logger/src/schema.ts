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
 * New instances get the correct shape directly (PK includes request_id).
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
      PRIMARY KEY (request_id, kind, r2_key)
    );

    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    -- Sentinel: presence of this index signals that artifacts already has the
    -- correct PK (request_id, kind, r2_key), so migrateSchema skips the rebuild.
    CREATE INDEX IF NOT EXISTS idx_artifacts_pk_rebuilt ON artifacts(kind);
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
 * H5: Legacy artifacts table has PK (kind, r2_key) which is too coarse for
 * multi-request instances — different requests could collide.  We rebuild the
 * table with PK (request_id, kind, r2_key) when the old narrow PK is still in
 * place.  The rebuild is guarded by checking whether the index
 * `idx_artifacts_pk_rebuilt` already exists so it runs at most once per
 * instance (idempotent across cold starts).
 *
 * H6: The legacy-row adoption UPDATE is guarded: if the instance somehow holds
 * more than one request row we skip adoption (rows stay request_id='') rather
 * than mis-assigning them; a deterministic ORDER BY is used when we do adopt.
 *
 * M8: The adoption UPDATEs are skipped cheaply when no unattributed rows exist
 * (COUNT(*)=0 guard), so post-migration cold starts hit an index-assisted
 * zero-row check instead of a full table-scan UPDATE.
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

  // H5: Rebuild artifacts table if it still has the old narrow PK (kind, r2_key).
  // We detect this by the absence of our sentinel index `idx_artifacts_pk_rebuilt`.
  // New instances created by initSchema already have PK (request_id, kind, r2_key)
  // and do not need the rebuild, but we create the sentinel there too so the check
  // is always fast.
  const rebuildDone = sql
    .exec<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM sqlite_master
       WHERE type='index' AND name='idx_artifacts_pk_rebuilt'`
    )
    .one();

  if (!rebuildDone || rebuildDone.cnt === 0) {
    // Rebuild artifacts with the correct PK. This is safe to run when the table
    // is empty (new instance that went through initSchema with the old PK) or
    // when it has rows (legacy instance — rows already have request_id populated
    // by the addColumnIfMissing step above, defaulting to '').
    sql.exec(`
      CREATE TABLE IF NOT EXISTS artifacts_new (
        request_id TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        r2_key TEXT NOT NULL,
        content_type TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (request_id, kind, r2_key)
      )
    `);
    sql.exec(`
      INSERT OR IGNORE INTO artifacts_new
        SELECT request_id, kind, r2_key, content_type, bytes, sha256, created_at
        FROM artifacts
    `);
    sql.exec(`DROP TABLE artifacts`);
    sql.exec(`ALTER TABLE artifacts_new RENAME TO artifacts`);
    // Recreate indexes after rename (RENAME does not carry named indexes from the old table).
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_artifacts_request_id ON artifacts(request_id)`);
    // Sentinel index: its presence in sqlite_master means the rebuild has already run.
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_artifacts_pk_rebuilt ON artifacts(kind)`);
  }

  // H6 + M8: Legacy row adoption for events.
  // M8 cheap guard: skip if there are no unattributed event rows.
  const orphanEvents = sql
    .exec<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM events WHERE request_id = ''`)
    .one();

  if (orphanEvents && orphanEvents.cnt > 0) {
    // H6: Only adopt when the instance holds exactly one request row.
    // If it holds more than one, skip rather than mis-assign.
    const requestCount = sql
      .exec<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM requests`)
      .one();

    if (requestCount && requestCount.cnt > 1) {
      console.error(
        `[logger] migrateSchema: legacy DO holds ${requestCount.cnt} requests, skipping event adoption`
      );
    } else {
      // ORDER BY created_at ASC LIMIT 1 for determinism.
      sql.exec(
        `UPDATE events
         SET request_id = COALESCE(
           (SELECT request_id FROM requests ORDER BY created_at ASC LIMIT 1), ''
         )
         WHERE request_id = ''`
      );
    }
  }

  // H6 + M8: Legacy row adoption for artifacts.
  // M8 cheap guard: skip if there are no unattributed artifact rows.
  // A partial failure on events (above) self-heals on next cold start because
  // the WHERE request_id='' predicate is idempotent.
  const orphanArtifacts = sql
    .exec<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM artifacts WHERE request_id = ''`)
    .one();

  if (orphanArtifacts && orphanArtifacts.cnt > 0) {
    const requestCount = sql
      .exec<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM requests`)
      .one();

    if (requestCount && requestCount.cnt > 1) {
      console.error(
        `[logger] migrateSchema: legacy DO holds ${requestCount.cnt} requests, skipping artifact adoption`
      );
    } else {
      sql.exec(
        `UPDATE artifacts
         SET request_id = COALESCE(
           (SELECT request_id FROM requests ORDER BY created_at ASC LIMIT 1), ''
         )
         WHERE request_id = ''`
      );
    }
  }
}

function addColumnIfMissing(sql: SqlStorage, table: string, columnDef: string): void {
  try {
    sql.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.toLowerCase().includes('duplicate column')) {
      throw err;
    }
  }
}
