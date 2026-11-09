import { createServer, type Server } from 'node:http';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { E2E_AUTH_PASSWORD, E2E_AUTH_USER } from '../playwright.config';

// The operator signs in once at the browser's own sign-in prompt, and every
// later request of the dashboard (the overview data, the live stream, the
// archive preview and the screenshot image) carries that sign-in with no
// second prompt. When the operator cancels the prompt, the browser shows only
// the plain sign-in line and no dashboard view.
//
// Headless Chromium draws no prompt, so this spec answers the browser's
// sign-in challenges itself, the way the prompt would: with the dashboard
// credential (signing in) or with a cancel.
test.use({ channel: 'chromium' });

const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? '18798');
const STUB_ORIGIN = `http://127.0.0.1:${STUB_PORT}`;

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let server: Server;

// Stands in for dashboard-api and the archive store.
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', STUB_ORIGIN);
    const json = (body: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    switch (url.pathname) {
      case '/articles/abc12345':
        return json({
          item_id: 'abc12345',
          url: 'https://example.test/abc12345',
          domain: 'example.test',
          title: 'Sign-in fixture',
          created_at: new Date().toISOString(),
          archive_classification: 'complete',
          has_canonical: false,
          archives: [
            { key: 'rendered', status: 'success' },
            { key: 'screenshot', status: 'success' },
          ],
        });
      case '/signed-url': {
        const itemId = url.searchParams.get('itemId') ?? '';
        const archiveKey = url.searchParams.get('archiveKey') ?? '';
        return json({ url: `${STUB_ORIGIN}/archive/${itemId}/${archiveKey}` });
      }
      case '/archive/abc12345/rendered':
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<p id="body">stored archive text</p>');
      case '/archive/abc12345/screenshot':
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(PNG_1X1);
      default:
        return json({});
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(STUB_PORT, '127.0.0.1', () => resolve());
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// Answers each sign-in challenge of the page the way the operator would at
// the browser prompt, and returns the list of challenged URLs: each entry is
// one sign-in prompt the operator would have seen.
async function watchSignInPrompts(page: Page, answer: 'sign-in' | 'cancel'): Promise<string[]> {
  // The runner gives every browser context the harness credential and would
  // answer each challenge with it before this hook saw it; take it away, so
  // the browser starts with no sign-in and every challenge reaches the hook.
  await page.context().setHTTPCredentials(null);
  const prompts: string[] = [];
  const session = await page.context().newCDPSession(page);
  // Every request pauses while this hook is on; let each one go on unchanged.
  // A request of a page that has already closed cannot be continued, which is
  // harmless here.
  session.on('Fetch.requestPaused', (event) => {
    session.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => undefined);
  });
  session.on('Fetch.authRequired', (event) => {
    prompts.push(event.request.url);
    const authChallengeResponse =
      answer === 'sign-in'
        ? { response: 'ProvideCredentials' as const, username: E2E_AUTH_USER, password: E2E_AUTH_PASSWORD }
        : { response: 'CancelAuth' as const };
    session
      .send('Fetch.continueWithAuth', { requestId: event.requestId, authChallengeResponse })
      .catch(() => undefined);
  });
  await session.send('Fetch.enable', { handleAuthRequests: true });
  return prompts;
}

async function capture(page: Page, testInfo: TestInfo, name: string, selector: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.locator(selector).screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

type SeenRequest = { url: string; type: string; status: number; signedIn: boolean };

test('one sign-in loads the overview, the stream, the preview and the screenshot', async ({ page, baseURL: base }, testInfo) => {
  const baseURL = base!;
  const prompts = await watchSignInPrompts(page, 'sign-in');
  const seen: SeenRequest[] = [];
  page.on('response', async (response) => {
    if (!response.url().startsWith(`${baseURL}/`)) return;
    const headers = await response.request().allHeaders();
    seen.push({
      url: response.url().slice(baseURL.length),
      type: response.request().resourceType(),
      status: response.status(),
      signedIn: (headers.authorization ?? '').startsWith('Basic '),
    });
  });

  await page.goto('/');
  await page.locator('.nav-item[data-view="overview"]').click();
  await expect(page.locator('#statTotal')).toHaveText('42');

  await page.goto('/requests/req-1');
  await expect(page.getByText('Stream event from the stub logger')).toBeVisible();

  await page.goto('/articles/abc12345');
  await page.locator('button[data-action="view-archive"][data-archive-key="rendered"]').click();
  await expect(page.frameLocator('.content-viewer-frame').locator('#body')).toHaveText('stored archive text');
  await capture(page, testInfo, 'rendered-preview', '.content-viewer-panel');
  // The close button, not Escape: Escape also leaves the article page.
  await page.locator('.content-viewer-close').click();

  await page.locator('button[data-action="view-archive"][data-archive-key="screenshot"]').click();
  const image = page.locator('.content-viewer-image');
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await capture(page, testInfo, 'screenshot-preview', '.content-viewer-panel');

  console.log(`sign-in prompts: ${JSON.stringify(prompts)}`);
  console.log(`dashboard requests: ${JSON.stringify(seen)}`);

  // One prompt, for the first page load only.
  expect(prompts).toEqual([`${baseURL}/`]);

  // Every request after that first page load carried the sign-in.
  const [first, ...later] = seen;
  expect(first).toMatchObject({ url: '/', type: 'document', signedIn: false });
  expect(later.filter((r) => !r.signedIn), 'requests sent without the sign-in').toEqual([]);

  const has = (name: string, match: (r: SeenRequest) => boolean) =>
    expect(later.some(match), `${name} was requested with the sign-in`).toBe(true);
  has('the overview data', (r) => r.type === 'fetch' && r.url === '/api/stats' && r.status === 200);
  has('the live stream', (r) => r.type === 'eventsource' && r.url === '/api/stream/req-1' && r.status === 200);
  has('the archive preview', (r) => r.type === 'document' && r.url.startsWith('/api/archive-content?') && r.url.includes('archiveKey=rendered'));
  has('the screenshot image', (r) => r.type === 'image' && r.url.startsWith('/api/archive-content?') && r.url.includes('archiveKey=screenshot'));
});

test('a cancelled sign-in shows only the sign-in line', async ({ page }, testInfo) => {
  const prompts = await watchSignInPrompts(page, 'cancel');
  const response = await page.goto('/');
  console.log(`cancelled sign-in: status ${response?.status()}, prompts ${JSON.stringify(prompts)}`);

  expect(response?.status()).toBe(401);
  expect(await page.locator('body').innerText()).toBe('Sign-in required.');
  await expect(page.locator('#statTotal')).toHaveCount(0);
  await expect(page.locator('.nav-item')).toHaveCount(0);
  await expect(page.locator('script')).toHaveCount(0);
  expect(prompts).toHaveLength(1);
  await capture(page, testInfo, 'cancelled-sign-in', 'body');
});
