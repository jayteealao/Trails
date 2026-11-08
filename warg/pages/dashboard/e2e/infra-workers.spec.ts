import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import inventory from '../functions/lib/workers.json';

// The operator opens the infra view and sees one row per deployed worker,
// hyperrenderer included. The stub below stands in for the Cloudflare API,
// so the run goes through the real infra function and the real view.

const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? '18798');

// One account answers every analytics query: traffic for gateway and for a
// script that is not a Warg worker, and empty storage groups.
const ACCOUNT_FIXTURE = {
  data: {
    viewer: {
      accounts: [
        {
          workersInvocationsAdaptive: [
            { dimensions: { scriptName: 'gateway' }, sum: { requests: 5, errors: 0 }, quantiles: { cpuTimeP50: 2, cpuTimeP99: 9 } },
            { dimensions: { scriptName: 'not-a-warg-worker' }, sum: { requests: 50, errors: 0 }, quantiles: { cpuTimeP50: 1, cpuTimeP99: 3 } },
          ],
          d1AnalyticsAdaptiveGroups: [],
          r2StorageAdaptiveGroups: [],
          durableObjectsStorageGroups: [],
          durableObjectsInvocationsAdaptiveGroups: [],
        },
      ],
    },
  },
};

let server: Server;
const authorizations: string[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${STUB_PORT}`);
    const json = (body: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST' && url.pathname === '/client/v4/graphql') {
      authorizations.push(req.headers.authorization ?? '');
      return json(ACCOUNT_FIXTURE);
    }
    if (req.method === 'GET' && url.pathname === '/client/v4/accounts/e2e-account/workflows/archive-workflow/instances') {
      return json({ success: true, result: [] });
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(STUB_PORT, '127.0.0.1', () => resolve());
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('the infra view shows a hyperrenderer row among the configured workers', async ({ page }, testInfo) => {
  await page.goto('/');
  const infraResponse = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/infra');
  await page.locator('button.nav-item[data-view="infra"]').click();
  expect((await infraResponse).status()).toBe(200);

  const rows = page.locator('#infraView .data-table tbody tr');
  const hyperrenderer = rows.filter({ has: page.locator('td:first-child', { hasText: /^hyperrenderer$/ }) });
  await expect(hyperrenderer).toHaveCount(1);
  await expect(hyperrenderer.locator('td').nth(1)).toHaveText('0');
  await expect(rows).toHaveCount(inventory.workers.length);
  await expect(rows.filter({ hasText: 'not-a-warg-worker' })).toHaveCount(0);
  expect(authorizations.length).toBeGreaterThan(0);
  expect(authorizations.every((value) => value === 'Bearer e2e-cf-token')).toBe(true);

  const path = testInfo.outputPath('infra-workers.png');
  await page.locator('#infraView').screenshot({ path });
  await testInfo.attach('infra-workers', { path, contentType: 'image/png' });
});
