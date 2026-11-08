import { defineConfig, devices } from '@playwright/test';

// Browser checks run the real Pages functions under `wrangler pages dev`,
// pointed at a stub dashboard-api that each spec starts on STUB_PORT.
// The ports stay off the wrangler defaults so a local dev server is never
// mistaken for the one under test.
const PAGES_PORT = Number(process.env.E2E_PAGES_PORT ?? '18799');
const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? '18798');

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PAGES_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      `pnpm exec wrangler pages dev . --ip 127.0.0.1 --port ${PAGES_PORT}` +
      ` --binding DASHBOARD_API_URL=http://127.0.0.1:${STUB_PORT}/` +
      ' --binding DASHBOARD_API_KEY=e2e-key',
    url: `http://127.0.0.1:${PAGES_PORT}/`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
