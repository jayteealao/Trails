import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          durableObjects: {
            LOGGER_DO: 'LoggerDO'
          },
          d1Databases: ['INDEX_DB']
        }
      }
    }
  }
});
