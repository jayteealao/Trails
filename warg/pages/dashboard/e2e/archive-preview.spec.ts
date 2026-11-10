import { createServer, type Server } from 'node:http';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

// The operator opens a stored archive from the article page and must see it
// in the preview overlay: HTML text without its script, PDFs in the browser's
// own viewer, and screenshots as images (or a plain failure line when the
// image does not load). The stub below stands in for dashboard-api and the
// archive store, so the run goes through the real dashboard Worker and its
// functions.

// The default headless shell has no PDF viewer and downloads PDFs instead;
// the full Chromium build in new headless mode shows them.
test.use({ channel: 'chromium' });

const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? '18798');
const STUB_ORIGIN = `http://127.0.0.1:${STUB_PORT}`;
const PDF_VIEWER_ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const HTML_ARCHIVE = [
  '<!doctype html><title>fixture</title>',
  `<style>@font-face{font-family:F;src:url(${STUB_ORIGIN}/font.woff2)} p{font-family:F,sans-serif}</style>`,
  '<p id="body">stored archive text</p>',
  `<img id="pic" src="${STUB_ORIGIN}/pic.png" alt="">`,
  `<script>window.__ran = true; new Image().src = '${STUB_ORIGIN}/ran?' + Date.now();</script>`,
].join('');

// A one-page PDF that shows the text "PDF FIXTURE".
function buildPdf(): Buffer {
  const stream = 'BT /F1 24 Tf 72 720 Td (PDF FIXTURE) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

function article(itemId: string, keys: string[]) {
  return {
    item_id: itemId,
    url: `https://example.test/${itemId}`,
    domain: 'example.test',
    title: 'Preview fixture',
    created_at: new Date().toISOString(),
    archive_classification: 'complete',
    has_canonical: false,
    archives: keys.map((key) => ({ key, status: 'success' })),
  };
}

let server: Server;
const counts = { beacons: 0, pictures: 0, fonts: 0 };
let downloaded = false;

test.beforeAll(async () => {
  const pdf = buildPdf();
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', STUB_ORIGIN);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    switch (url.pathname) {
      case '/articles/abc12345':
        return json(200, article('abc12345', ['rendered', 'pdf', 'screenshot']));
      case '/articles/broken01':
        return json(200, article('broken01', ['screenshot']));
      case '/signed-url': {
        const itemId = url.searchParams.get('itemId') ?? '';
        const archiveKey = url.searchParams.get('archiveKey') ?? '';
        return json(200, { url: `${STUB_ORIGIN}/archive/${itemId}/${archiveKey}` });
      }
      case '/archive/abc12345/rendered':
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(HTML_ARCHIVE);
      case '/archive/abc12345/pdf':
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        return res.end(pdf);
      case '/archive/abc12345/screenshot':
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(PNG_1X1);
      case '/archive/broken01/screenshot':
        return json(404, { error: 'archive not found' });
      case '/pic.png':
        counts.pictures += 1;
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(PNG_1X1);
      case '/font.woff2':
        counts.fonts += 1;
        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
        return res.end();
      case '/ran':
        counts.beacons += 1;
        res.writeHead(204);
        return res.end();
      default:
        res.writeHead(404);
        return res.end();
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

test.beforeEach(({ page }) => {
  counts.beacons = 0;
  counts.pictures = 0;
  counts.fonts = 0;
  downloaded = false;
  page.on('download', () => {
    downloaded = true;
  });
});

async function openPreview(page: Page, itemId: string, archiveKey: string) {
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/archive-content') && r.url().includes(`archiveKey=${archiveKey}`),
  );
  await page.goto(`/articles/${itemId}`);
  await page.locator(`button[data-action="view-archive"][data-archive-key="${archiveKey}"]`).click();
  await expect(page.locator('.content-viewer-overlay')).toBeVisible();
  return response;
}

async function captureOverlay(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.locator('.content-viewer-panel').screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('an HTML archive shows its text in the preview and its script does not run', async ({ page }, testInfo) => {
  const response = await openPreview(page, 'abc12345', 'rendered');
  const csp = response.headers()['content-security-policy'] ?? '';
  console.log(`rendered content-security-policy: ${JSON.stringify(csp)}`);
  expect(csp).toContain('sandbox');

  const iframe = page.locator('.content-viewer-frame');
  expect(await iframe.getAttribute('sandbox')).not.toContain('allow-scripts');

  const frame = page.frameLocator('.content-viewer-frame');
  await expect(frame.locator('#body')).toHaveText('stored archive text');
  await expect.poll(() => frame.locator('#pic').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  expect(counts.pictures).toBeGreaterThanOrEqual(1);
  await expect.poll(() => counts.fonts).toBeGreaterThanOrEqual(1);

  // Proving that something did not happen needs a quiet window: give a
  // script that would run a full second to send its beacon.
  await page.waitForTimeout(1_000);
  console.log(`stub counts: ${JSON.stringify(counts)}`);
  expect(counts.beacons).toBe(0);
  await captureOverlay(page, testInfo, 'rendered');
});

test('a PDF archive shows inline in the browser PDF viewer', async ({ page }, testInfo) => {
  const response = await openPreview(page, 'abc12345', 'pdf');
  expect(response.headers()['content-security-policy']).toBeUndefined();

  const frame = await (await page.locator('.content-viewer-frame').elementHandle())?.contentFrame();
  expect(frame).toBeTruthy();
  await expect.poll(() => page.frames().map((f) => f.url()).find((u) => u.startsWith(PDF_VIEWER_ORIGIN)) ?? '', {
    timeout: 15_000,
  }).not.toBe('');
  const frameUrl = frame?.url() ?? '';
  console.log(`pdf frame url: ${frameUrl}; frames: ${JSON.stringify(page.frames().map((f) => f.url()))}`);
  expect(frameUrl).toContain('archiveKey=pdf');
  expect(frameUrl.startsWith('chrome-error://')).toBe(false);
  // Let the viewer paint before the capture.
  await page.waitForTimeout(1_000);
  expect(downloaded).toBe(false);
  await captureOverlay(page, testInfo, 'pdf');
});

test('a screenshot archive shows as an image in the preview', async ({ page }, testInfo) => {
  await openPreview(page, 'abc12345', 'screenshot');
  const image = page.locator('.content-viewer-image');
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await captureOverlay(page, testInfo, 'screenshot');
});

test('a screenshot that does not load shows a failure line', async ({ page }, testInfo) => {
  await openPreview(page, 'broken01', 'screenshot');
  await expect(page.locator('.content-viewer-text')).toHaveText('Failed to load content');
  await expect(page.locator('.content-viewer-image')).toHaveCount(0);
  await captureOverlay(page, testInfo, 'screenshot-failed');
});
