import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { E2E_AUTH_PASSWORD, E2E_AUTH_USER } from '../playwright.config';
import { listRoutes } from '../functions/api/__tests__/route-inventory';

// Every dashboard page and API route, served by the dashboard Worker's router
// under `wrangler dev`, asks for the dashboard sign-in and lets the right
// credential through to the page or handler.
const routes = listRoutes(path.join(__dirname, '..', 'functions', 'api'));
const CHALLENGE = 'Basic realm="Warg dashboard", charset="UTF-8"';
const STATIC_PATHS = ['/', '/articles/sample-id', '/app.js'];

let anon: APIRequestContext;
let wrong: APIRequestContext;
let right: APIRequestContext;

// The runner gives every request context the config's sign-in credential,
// which it sends again when a response asks for sign-in. Each context here
// names its own credential instead, so the anonymous and wrong ones stay so.
test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  const as = (username: string, password: string) => ({ username, password, send: 'always' as const });
  anon = await playwright.request.newContext({ baseURL, httpCredentials: undefined });
  wrong = await playwright.request.newContext({ baseURL, httpCredentials: as(E2E_AUTH_USER, 'wrong') });
  right = await playwright.request.newContext({ baseURL, httpCredentials: as(E2E_AUTH_USER, E2E_AUTH_PASSWORD) });
});

test.afterAll(async () => {
  await Promise.all([anon?.dispose(), wrong?.dispose(), right?.dispose()]);
});

function send(context: APIRequestContext, method: string, url: string) {
  return method === 'POST' ? context.post(url, { data: {} }) : context.fetch(url, { method });
}

test('finds every function route on disk', () => {
  expect(routes.length).toBeGreaterThanOrEqual(16);
});

for (const route of routes) {
  for (const method of route.methods) {
    test(`${method} ${route.path} needs the dashboard sign-in`, async () => {
      const unsigned = await send(anon, method, route.path);
      expect(unsigned.status()).toBe(401);
      expect(await unsigned.text()).toBe('Sign-in required.');
      expect(unsigned.headers()['www-authenticate']).toBe(CHALLENGE);

      expect((await send(wrong, method, route.path)).status()).toBe(401);

      // The handler ran: with no real upstream it answers 4xx/5xx JSON, never the challenge.
      const signed = await send(right, method, route.path);
      expect(signed.status()).not.toBe(401);
    });
  }
}

for (const staticPath of STATIC_PATHS) {
  test(`page ${staticPath} needs the dashboard sign-in`, async () => {
    const unsigned = await anon.get(staticPath);
    expect(unsigned.status()).toBe(401);
    expect(await unsigned.text()).toBe('Sign-in required.');
    expect((await right.get(staticPath)).status()).toBe(200);
  });
}

test('a signed-in request reaches the archive-content handler', async () => {
  // With no archive parameters the handler itself answers 400.
  expect((await right.get('/api/archive-content')).status()).toBe(400);
});
