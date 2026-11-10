import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';

// A stored archive must not run its own script when the dashboard serves it.
// The stub below stands in for dashboard-api and the archive store. The
// fixture's script reports itself with a beacon request back to the stub, so
// the test can tell from outside the page whether the script ran.
const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? '18798');
const STUB_ORIGIN = `http://127.0.0.1:${STUB_PORT}`;

const SCRIPTED_ARCHIVE = [
  '<!doctype html><title>fixture</title>',
  '<p id="body">stored archive</p>',
  `<script>window.__ran = true; new Image().src = '${STUB_ORIGIN}/ran?' + Date.now();</script>`,
].join('');

let server: Server;
let signedUrlCalls = 0;
let beacons = 0;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', STUB_ORIGIN);
    if (url.pathname === '/signed-url') {
      signedUrlCalls += 1;
      const archiveKey = url.searchParams.get('archiveKey') ?? '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: `${STUB_ORIGIN}/archive/${archiveKey}` }));
      return;
    }
    if (url.pathname === '/archive/rendered') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(SCRIPTED_ARCHIVE);
      return;
    }
    if (url.pathname === '/ran') {
      beacons += 1;
      res.writeHead(204);
      res.end();
      return;
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

test.beforeEach(() => {
  signedUrlCalls = 0;
  beacons = 0;
});

test('control: the fixture script runs when served without the dashboard', async ({ page }) => {
  await page.goto(`${STUB_ORIGIN}/archive/rendered`);
  await expect.poll(() => beacons).toBeGreaterThan(0);
});

test('a stored archive script does not run when the dashboard serves it', async ({ page }) => {
  const response = await page.goto('/api/archive-content?itemId=abc12345&archiveKey=rendered');
  expect(response?.status()).toBe(200);

  const csp = response?.headers()['content-security-policy'] ?? '';
  console.log(`archive-content content-security-policy: ${JSON.stringify(csp)}`);
  expect(csp).toContain('sandbox');
  expect(csp).not.toContain('allow-scripts');
  expect(signedUrlCalls).toBe(1);

  await page.waitForLoadState('load');
  // Proving that something did not happen needs a quiet window: give a
  // script that would run a full second to send its beacon.
  await page.waitForTimeout(1_000);
  expect(beacons).toBe(0);

  // A sandboxed document may refuse evaluation; the beacon count above is
  // the pass signal, and the flag is checked whenever it can be read.
  let ran: unknown;
  try {
    ran = await page.evaluate(() => (window as { __ran?: boolean }).__ran);
  } catch (err) {
    console.log(`window.__ran not readable in the sandboxed page: ${String(err)}`);
  }
  expect(ran).not.toBe(true);
});
