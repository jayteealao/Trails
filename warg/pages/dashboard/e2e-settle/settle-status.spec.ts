import { expect, test } from '@playwright/test';

// One archive request runs end to end on the local Workers: the logger is
// told about it, the workflow runs it in mock mode, and the dashboard status
// API must then show the state the workflow settled it in.

const REQUEST_ID = 'e2e-settle-done-0001';
const OPTIONS_KEY = `archives/${REQUEST_ID}/input/options.json`;

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run this spec with playwright.settle.config.ts`);
  return value;
}

interface RequestView {
  derived: { stage: string; terminal: boolean };
  events: Array<{ type: string; data?: Record<string, unknown> }>;
}

interface RequestList {
  requests: Array<{ requestId: string; stage: string | null; terminal: boolean }>;
}

test('a run that finishes done shows done on the dashboard status API', async ({ request }) => {
  const loggerUrl = setting('E2E_SETTLE_LOGGER_URL');
  const workflowUrl = setting('E2E_SETTLE_WORKFLOW_URL');
  const internalKey = setting('E2E_SETTLE_INTERNAL_KEY');

  const init = await request.post(`${loggerUrl}/request/init`, {
    headers: { 'X-Internal-API-Key': internalKey },
    data: { requestId: REQUEST_ID, url: 'https://example.com/', optionsR2Key: OPTIONS_KEY },
  });
  expect(init.status()).toBe(201);

  const start = await request.post(`${workflowUrl}/start`, {
    data: { request_id: REQUEST_ID, url: 'https://example.com/', options_r2_key: OPTIONS_KEY },
  });
  expect(start.ok()).toBe(true);
  expect(((await start.json()) as { status: string }).status).toBe('started');

  let view: RequestView | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/${REQUEST_ID}`);
        if (!response.ok()) return false;
        view = (await response.json()) as RequestView;
        return view.events.some((event) => event.type === 'request.settled');
      },
      { intervals: [1_000], timeout: 60_000, message: 'a request.settled event reaches the logger' }
    )
    .toBe(true);

  expect(view?.derived.stage).toBe('done');
  expect(view?.derived.terminal).toBe(true);
  const settled = view?.events.filter((event) => event.type === 'request.settled') ?? [];
  expect(settled).toHaveLength(1);
  expect(settled[0]?.data?.state).toBe('done');

  const list = await request.get('/api/requests?status=done');
  expect(list.ok()).toBe(true);
  const row = ((await list.json()) as RequestList).requests.find((entry) => entry.requestId === REQUEST_ID);
  expect(row).toMatchObject({ terminal: true, stage: 'done' });
});
