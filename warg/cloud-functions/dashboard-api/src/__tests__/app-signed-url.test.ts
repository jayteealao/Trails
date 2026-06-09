import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { handleAppSignedUrl } from '../app-signed-url.js';
import type { ArchiveSigner } from '../signed-url-core.js';

function makeReq(query: Record<string, unknown>): Request {
  return { query } as unknown as Request;
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

// Owned article whose canonical doc has a successful readability archive.
function ownedDb(): Firestore {
  const snap = (data: Record<string, unknown> | undefined) => ({
    exists: data !== undefined,
    data: () => data,
  });
  const db = {
    collection(name: string) {
      if (name === 'users') {
        return {
          doc: () => ({
            collection: () => ({
              doc: () => ({ get: async () => snap({}) }),
            }),
          }),
        };
      }
      return {
        doc: () => ({
          get: async () =>
            snap({
              archives: {
                readability: {
                  status: 'success',
                  gcs_path: 'gs://htbase-archives-standard/a/read.json',
                },
              },
            }),
        }),
      };
    },
  };
  return db as unknown as Firestore;
}

// Capture console.log for the duration of fn, returning everything logged.
async function captureLogs(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

test('returns the signed URL to the owner and never logs the URL', async () => {
  const SIGNED = 'https://signed.example/SECRET-TOKEN-DO-NOT-LOG';
  const sign: ArchiveSigner = async () => SIGNED;
  const { res, captured } = makeRes();

  const logs = await captureLogs(() =>
    handleAppSignedUrl(
      makeReq({ itemId: 'item1234', archiveKey: 'readability' }),
      res,
      'u1',
      ownedDb(),
      sign
    )
  );

  // The URL reaches the client...
  const body = captured.body as { url?: string } | undefined;
  assert.equal(body?.url, SIGNED);

  // ...but is never written to the logs.
  for (const line of logs) {
    assert.ok(!line.includes(SIGNED), `log line leaked the signed URL: ${line}`);
  }
  // The log line that IS emitted carries the safe identifiers.
  assert.ok(logs.some((l) => l.includes('item1234') && l.includes('a/read.json')));
});

test('rejects a malformed query with 400 before any signing', async () => {
  let signed = false;
  const sign: ArchiveSigner = async () => {
    signed = true;
    return 'should-not-happen';
  };
  const { res, captured } = makeRes();

  await handleAppSignedUrl(
    makeReq({ itemId: 'short', archiveKey: 'readability' }),
    res,
    'u1',
    ownedDb(),
    sign
  );

  assert.equal(captured.status, 400);
  assert.equal(signed, false);
});

test('returns 404 for an article the user does not own', async () => {
  const emptyDb = {
    collection: (name: string) =>
      name === 'users'
        ? {
            doc: () => ({
              collection: () => ({
                doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }),
              }),
            }),
          }
        : { doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }) },
  } as unknown as Firestore;
  const { res, captured } = makeRes();

  await handleAppSignedUrl(
    makeReq({ itemId: 'item1234', archiveKey: 'readability' }),
    res,
    'u1',
    emptyDb,
    async () => 'unused'
  );

  assert.equal(captured.status, 404);
});
