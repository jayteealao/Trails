import type { Request, Response } from 'express';

// Stand-ins for the archive gateway's router tests: Cloud Storage signing, the
// gateway's event log endpoint (through the global fetch), and the request and
// response of an HTTP call. Nothing here imports a module the tests mock.

export interface SignCall {
  bucket: string;
  path: string;
  opts: Record<string, unknown>;
}

/**
 * A `Storage` class whose signed URLs are recorded. Signing throws for a path
 * that contains `failOn`, when it is set.
 */
export function makeFakeStorage() {
  const state: { calls: SignCall[]; failOn: string | undefined } = {
    calls: [],
    failOn: undefined
  };

  class Storage {
    bucket(bucket: string) {
      return {
        file: (path: string) => ({
          async getSignedUrl(opts: Record<string, unknown>): Promise<[string]> {
            state.calls.push({ bucket, path, opts });
            if (state.failOn !== undefined && path.includes(state.failOn)) {
              throw new Error(`signing failed: ${path}`);
            }
            return [`https://signed.invalid/${path}`];
          }
        })
      };
    }
  }

  return {
    Storage,
    state,
    reset() {
      state.calls = [];
      state.failOn = undefined;
    }
  };
}

export interface LogPost {
  url: string;
  headers: Record<string, string>;
  body: { requestId: string; event: Record<string, unknown> };
}

/** 'ok' answers 204, a number answers that status, 'reject' fails the fetch itself. */
export type LogGatewayMode = 'ok' | number | 'reject';

/** Replaces the global fetch with a log endpoint that records each POST. */
export function makeFakeLogGateway() {
  const realFetch = globalThis.fetch;
  const state: { posts: LogPost[]; mode: LogGatewayMode } = { posts: [], mode: 'ok' };

  globalThis.fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    state.posts.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    if (state.mode === 'reject') throw new TypeError('fetch failed');
    const status = state.mode === 'ok' ? 204 : state.mode;
    return new Response(status === 204 ? null : 'log refused', { status });
  }) as unknown as typeof fetch;

  return {
    state,
    reset() {
      state.posts = [];
      state.mode = 'ok';
    },
    restore() {
      globalThis.fetch = realFetch;
    }
  };
}

/** An HTTP request to the gateway; the caller key header is sent only when `key` is given. */
export function gatewayRequest(opts: {
  method?: string;
  path: string;
  key?: string;
  body?: unknown;
}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.key !== undefined) headers['x-internal-api-key'] = opts.key;
  return {
    method: opts.method ?? 'POST',
    path: opts.path,
    url: opts.path,
    headers,
    body: opts.body
  } as unknown as Request;
}

/**
 * A response that records the status and the body. `done` settles on the first
 * `json()` call, and rejects after 2 s so a handler that never answers fails
 * its test instead of stalling the run.
 */
export function fakeResponse() {
  const out: { status: number; body: unknown } = { status: 0, body: undefined };
  let settle: () => void = () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve, reject) => {
    settle = resolve;
    timer = setTimeout(() => reject(new Error('the handler did not answer within 2 s')), 2000);
  }).finally(() => clearTimeout(timer));

  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      settle();
      return res;
    }
  };
  return { out, res: res as unknown as Response, done };
}
