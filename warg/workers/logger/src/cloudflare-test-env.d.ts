declare namespace Cloudflare {
  interface Env {
    LOGGER_DO: DurableObjectNamespace<import('./LoggerDO.js').LoggerDO>;
    INDEX_DB: D1Database;
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[];
  }
}
