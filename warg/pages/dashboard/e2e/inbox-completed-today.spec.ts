import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';

// The operator opens the dashboard and reads the completed count in the
// inbox readout strip. The stub below stands in for the dashboard API, so
// the run goes through the real inbox function and the real view. Its count
// (17) differs from what the two recent rows alone would give (2).

const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? '18798');
const COMPLETED_TODAY = 17;

let server: Server;
const completedTodayKeys: string[] = [];

function utcMidnight(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${STUB_PORT}`);
    const json = (body: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && url.pathname === '/stats/completed-today') {
      completedTodayKeys.push(String(req.headers['x-internal-api-key'] ?? ''));
      return json({ completedToday: COMPLETED_TODAY, since: utcMidnight() });
    }
    if (req.method === 'GET' && url.pathname === '/articles') {
      if (url.searchParams.get('filter') === 'complete') {
        const now = new Date().toISOString();
        return json({
          articles: [
            { item_id: 'done-1', url: 'https://example.com/one', created_at: now, archives: {} },
            { item_id: 'done-2', url: 'https://example.com/two', created_at: now, archives: {} },
          ],
        });
      }
      return json({ articles: [] });
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

test('the inbox shows the completed count from the dashboard API in its existing place', async ({ page }, testInfo) => {
  const inboxResponse = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/inbox');
  await page.goto('/');
  expect((await inboxResponse).status()).toBe(200);

  const cells = page.locator('#inboxContent .readout-strip .readout-cell');
  await expect(cells).toHaveCount(3);
  await expect(cells.locator('.readout-label')).toHaveText(['Needs Attention', 'In Progress', 'Completed (24h)']);
  await expect(cells.nth(2).locator('.readout-value')).toHaveText(String(COMPLETED_TODAY));
  expect(completedTodayKeys).toContain('e2e-key');

  const path = testInfo.outputPath('inbox-completed-today.png');
  await page.locator('#inboxContent .readout-strip').screenshot({ path });
  await testInfo.attach('inbox-completed-today', { path, contentType: 'image/png' });
});
