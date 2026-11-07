declare namespace Cloudflare {
  interface Env {
    INDEX_DB: D1Database;
    INTERNAL_API_KEY: string;
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[];
  }
}
