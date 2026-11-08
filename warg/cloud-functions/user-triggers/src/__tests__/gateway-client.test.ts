import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callGatewayBegin } from '../gateway-client.js';

// The gateway /begin client against a scripted fetch: each call is recorded
// (url, method, headers, parsed body) and answered by the next queued response.

interface Call {
  url: string;
  method: string | undefined;
  headers: unknown;
  body: unknown;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];

function install(responses: Array<{ status: number; body: string }>): void {
  calls = [];
  const queue = [...responses];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: init?.headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch');
    return new Response(next.body, { status: next.status });
  };
}

function restore(): void {
  globalThis.fetch = realFetch;
}

afterEach(restore);

const config = {
  gatewayUrl: 'https://gateway.test',
  publicApiKey: 'pk',
  cfAccessClientId: 'id',
  cfAccessClientSecret: 'sec',
};
const payload = { url: 'https://example.com/a', request_id: 'item1234', includeScreenshot: true, includePdf: true };

test('a 200 with a request id returns it after one POST to /begin with the keys and the payload', async () => {
  install([{ status: 200, body: '{"requestId":"req-1"}' }]);
  assert.deepEqual(await callGatewayBegin(config, payload), { requestId: 'req-1' });
  assert.deepEqual(calls, [
    {
      url: 'https://gateway.test/begin',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'pk',
        'CF-Access-Client-Id': 'id',
        'CF-Access-Client-Secret': 'sec',
      },
      body: payload,
    },
  ]);
});
