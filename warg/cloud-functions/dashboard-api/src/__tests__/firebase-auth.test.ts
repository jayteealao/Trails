import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { verifyFirebaseToken, type IdTokenVerifier } from '../firebase-auth.js';

function makeReq(authorization?: string): Request {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers['authorization'] = authorization;
  return { headers } as unknown as Request;
}

function makeRes() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

test('hands the uid to next for a valid, non-anonymous token', async () => {
  const verify: IdTokenVerifier = async () => ({ uid: 'u1', signInProvider: 'google.com' });
  const { res, captured } = makeRes();
  let nextUid: string | undefined;

  await verifyFirebaseToken(makeReq('Bearer good-token'), res, async (uid) => {
    nextUid = uid;
  }, verify);

  assert.equal(nextUid, 'u1');
  assert.equal(captured.status, undefined);
});

test('rejects an anonymous token with 403 and does not call next', async () => {
  const verify: IdTokenVerifier = async () => ({ uid: 'anon-1', signInProvider: 'anonymous' });
  const { res, captured } = makeRes();
  let nextCalled = false;

  await verifyFirebaseToken(makeReq('Bearer anon-token'), res, async () => {
    nextCalled = true;
  }, verify);

  assert.equal(captured.status, 403);
  assert.equal(nextCalled, false);
});

test('returns 401 when verification throws', async () => {
  const verify: IdTokenVerifier = async () => {
    throw new Error('token expired');
  };
  const { res, captured } = makeRes();
  let nextCalled = false;

  await verifyFirebaseToken(makeReq('Bearer bad-token'), res, async () => {
    nextCalled = true;
  }, verify);

  assert.equal(captured.status, 401);
  assert.equal(nextCalled, false);
});

test('returns 401 when the Authorization header is missing', async () => {
  const verify: IdTokenVerifier = async () => ({ uid: 'u1', signInProvider: 'google.com' });
  const { res, captured } = makeRes();

  await verifyFirebaseToken(makeReq(), res, async () => {}, verify);

  assert.equal(captured.status, 401);
});

test('returns 401 when the header is not a Bearer token', async () => {
  const verify: IdTokenVerifier = async () => ({ uid: 'u1', signInProvider: 'google.com' });
  const { res, captured } = makeRes();

  await verifyFirebaseToken(makeReq('Basic abc123'), res, async () => {}, verify);

  assert.equal(captured.status, 401);
});

test('returns 401 when the bearer token is empty', async () => {
  const verify: IdTokenVerifier = async () => ({ uid: 'u1', signInProvider: 'google.com' });
  const { res, captured } = makeRes();

  await verifyFirebaseToken(makeReq('Bearer    '), res, async () => {}, verify);

  assert.equal(captured.status, 401);
});
