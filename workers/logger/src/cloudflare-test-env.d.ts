declare module 'cloudflare:test' {
  interface ProvidedEnv {
    LOGGER_DO: DurableObjectNamespace;
    INDEX_DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
  }
}
