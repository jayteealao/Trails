import { beforeEach, describe, expect, it, vi } from 'vitest';
import gateway from './index.js';
import { GATEWAY_ERROR_CODES, MAX_OPTIONS_BYTES } from './util.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

interface CapturedLoggerEvent {
  requestId: string;
  event: { type: string };
}

interface CreateEnvOptions {
  /** Answers a logger call before the default routes; return undefined to fall through. */
  logger?: (url: string, init?: RequestInit) => Response | undefined | Promise<Response | undefined>;
  /** Replaces the default workflow reply (a 500). */
  workflowReply?: () => Response | Promise<Response>;
  /** Replaces the default ARCHIVE_BUCKET.put. */
  bucketPut?: () => Promise<void>;
}

function createEnv(options: CreateEnvOptions = {}) {
  const loggerEvents: CapturedLoggerEvent[] = [];
  const loggerFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const override = await options.logger?.(url, init);
    if (override) {
      return override;
    }
    if (url === 'https://logger/request/init') {
      return jsonResponse({ created: true }, 201);
    }
    if (url === 'https://logger/event') {
      const body = JSON.parse(String(init?.body)) as CapturedLoggerEvent;
      loggerEvents.push(body);
      return jsonResponse({ eventId: loggerEvents.length }, 200);
    }
    if (url.startsWith('https://logger/requests?status=queued')) {
      return jsonResponse({
        requests: [
          {
            requestId: 'queued-old-1234',
            url: 'https://example.com/old',
            createdAt: '2025-01-01T00:00:00.000Z',
            lastEventTs: null,
            stage: 'queued'
          },
          {
            requestId: 'queued-recent-1234',
            url: 'https://example.com/new',
            createdAt: new Date().toISOString(),
            lastEventTs: null,
            stage: 'queued'
          }
        ]
      });
    }
    return jsonResponse({ error: 'unexpected logger route' }, 404);
  });

  const workflowFetch = vi.fn(async (): Promise<Response> =>
    options.workflowReply
      ? options.workflowReply()
      : jsonResponse({ error: 'Internal error', message: '(instance.already_exists) Instance already exists' }, 500)
  );

  return {
    env: {
      PUBLIC_API_KEY: 'public-key',
      INTERNAL_API_KEY: 'internal-key',
      LOGGER: { fetch: loggerFetch } as unknown as Fetcher,
      WORKFLOW: { fetch: workflowFetch } as unknown as Fetcher,
      ARCHIVE_BUCKET: {
        put: vi.fn(options.bucketPut ?? (async () => {}))
      } as unknown as R2Bucket
    } as Env,
    loggerFetch,
    workflowFetch,
    loggerEvents
  };
}

describe('gateway begin hardening', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns non-2xx when workflow trigger fails', async () => {
    const { env, loggerEvents } = createEnv();
    const request = new Request('https://gateway.jayteealao.workers.dev/begin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.PUBLIC_API_KEY
      },
      body: JSON.stringify({ url: 'https://example.com' })
    });

    const response = await gateway.fetch(request, env, {} as ExecutionContext);
    const data = (await response.json()) as { errorCode?: string };

    expect(response.status).toBe(502);
    expect(data.errorCode).toBe('WORKFLOW_TRIGGER_FAILED');
    expect(loggerEvents.map((entry) => entry.event.type)).toContain('workflow.trigger_failed');
    expect(loggerEvents.map((entry) => entry.event.type)).toContain('request.failed');
  });

  it('supports dry-run orphan queued sweep via internal endpoint', async () => {
    const { env, workflowFetch } = createEnv();
    const request = new Request('https://gateway.jayteealao.workers.dev/internal/sweep-orphan-queued', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': env.INTERNAL_API_KEY
      },
      body: JSON.stringify({ dryRun: true, minAgeMs: 60_000 })
    });

    const response = await gateway.fetch(request, env, {} as ExecutionContext);
    const data = (await response.json()) as {
      dryRun: boolean;
      scanned: number;
      candidates: number;
      retriggered: number;
      skipped: number;
    };

    expect(response.status).toBe(200);
    expect(data.dryRun).toBe(true);
    expect(data.scanned).toBe(2);
    expect(data.candidates).toBe(1);
    expect(data.retriggered).toBe(0);
    expect(data.skipped).toBe(1);
    expect(workflowFetch).not.toHaveBeenCalled();
  });
});

const GATEWAY = 'https://gateway.jayteealao.workers.dev';

function publicPost(path: string, body: unknown, key = 'public-key'): Request {
  return new Request(`${GATEWAY}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

function publicGet(path: string, key = 'public-key'): Request {
  return new Request(`${GATEWAY}${path}`, { method: 'GET', headers: { 'X-API-Key': key } });
}

function internalPost(path: string, body: unknown, key = 'internal-key'): Request {
  return new Request(`${GATEWAY}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': key },
    body: JSON.stringify(body)
  });
}

describe('gateway success paths stay unchanged', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('begin returns 201 with exactly { requestId } and the id header', async () => {
    const { env } = createEnv({ workflowReply: () => jsonResponse({ started: true }, 201) });
    const response = await gateway.fetch(
      publicPost('/begin', { url: 'https://example.com', request_id: 'req-ok-1' }),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ requestId: 'req-ok-1' });
    expect(response.headers.get('X-Request-Id')).toBe('req-ok-1');
  });

  it('status passes the logger body through byte-for-byte with the id header', async () => {
    const loggerBody = '{"requestId":"abc12345","stage":"done","events":[]}';
    const { env } = createEnv({
      logger: (url) =>
        url === 'https://logger/request/abc12345'
          ? new Response(loggerBody, { status: 200, headers: { 'Content-Type': 'application/json' } })
          : undefined
    });
    const response = await gateway.fetch(publicGet('/status/abc12345'), env, {} as ExecutionContext);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(loggerBody);
    expect(response.headers.get('X-Request-Id')).toBe('abc12345');
  });

  it('internal log passes the logger status and body through with the id header', async () => {
    const { env } = createEnv({
      logger: (url) => (url === 'https://logger/event' ? jsonResponse({ eventId: 7 }, 202) : undefined)
    });
    const response = await gateway.fetch(
      internalPost('/internal/log', { requestId: 'req-log-1', event: { type: 'step.started' } }),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ eventId: 7 });
    expect(response.headers.get('X-Request-Id')).toBe('req-log-1');
  });
});

interface RejectionCase {
  name: string;
  request: () => Request;
  options?: CreateEnvOptions;
  status: number;
  code: string;
  id?: string;
  idNot?: string;
}

const loggerThrows = (match: (url: string) => boolean): CreateEnvOptions['logger'] => (url) => {
  if (match(url)) {
    throw new Error('logger unavailable');
  }
  return undefined;
};

const REJECTIONS: RejectionCase[] = [
  { name: '401 begin without a key', request: () => publicPost('/begin', { url: 'https://example.com' }, ''), status: 401, code: 'UNAUTHORIZED' },
  { name: '401 status with a wrong key', request: () => publicGet('/status/x', 'wrong-key'), status: 401, code: 'UNAUTHORIZED' },
  { name: '401 internal log without a key', request: () => internalPost('/internal/log', {}, ''), status: 401, code: 'UNAUTHORIZED' },
  { name: '401 sweep without a key', request: () => internalPost('/internal/sweep-orphan-queued', {}, ''), status: 401, code: 'UNAUTHORIZED' },
  { name: '400 begin with invalid JSON', request: () => publicPost('/begin', '{not json'), status: 400, code: 'INVALID_JSON' },
  {
    name: '400 begin with a bad request_id',
    request: () => publicPost('/begin', { url: 'https://example.com', request_id: 'bad id!' }),
    status: 400,
    code: 'INVALID_REQUEST_ID',
    idNot: 'bad id!'
  },
  { name: '400 begin without a url', request: () => publicPost('/begin', { request_id: 'req-ok-1' }), status: 400, code: 'INVALID_INPUT_URL', id: 'req-ok-1' },
  {
    name: '400 begin with an ftp url',
    request: () => publicPost('/begin', { url: 'ftp://example.com/file', request_id: 'req-ok-1' }),
    status: 400,
    code: 'INVALID_INPUT_URL',
    id: 'req-ok-1'
  },
  { name: '400 status with an empty id', request: () => publicGet('/status/'), status: 400, code: 'REQUEST_ID_REQUIRED' },
  { name: '404 unknown route', request: () => new Request(`${GATEWAY}/nope`), status: 404, code: 'NOT_FOUND' },
  {
    name: '404 status of an unknown request',
    request: () => publicGet('/status/missing1'),
    options: {
      logger: (url) =>
        url === 'https://logger/request/missing1' ? jsonResponse({ error: 'Request not found' }, 404) : undefined
    },
    status: 404,
    code: 'REQUEST_NOT_FOUND',
    id: 'missing1'
  },
  {
    name: '503 status when the logger answers with a server error',
    request: () => publicGet('/status/x2'),
    options: {
      logger: (url) =>
        url === 'https://logger/request/x2'
          ? jsonResponse({ error: 'Internal error', message: 'raw logger failure' }, 503)
          : undefined
    },
    status: 503,
    code: 'STATUS_LOOKUP_FAILED',
    id: 'x2'
  },
  {
    name: '500 begin when the options write fails',
    request: () => publicPost('/begin', { url: 'https://example.com', request_id: 'req-ok-1' }),
    options: { bucketPut: async () => Promise.reject(new Error('bucket down')) },
    status: 500,
    code: 'INTERNAL_ERROR',
    id: 'req-ok-1'
  },
  {
    name: '500 status when the logger throws',
    request: () => publicGet('/status/x1'),
    options: { logger: loggerThrows((url) => url === 'https://logger/request/x1') },
    status: 500,
    code: 'INTERNAL_ERROR',
    id: 'x1'
  },
  {
    name: '500 internal log when the logger throws',
    request: () => internalPost('/internal/log', { requestId: 'req-log-1', event: { type: 'step.started' } }),
    options: { logger: loggerThrows((url) => url === 'https://logger/event') },
    status: 500,
    code: 'INTERNAL_ERROR',
    id: 'req-log-1'
  },
  {
    name: '500 sweep when the logger list throws',
    request: () => internalPost('/internal/sweep-orphan-queued', { dryRun: true }),
    options: { logger: loggerThrows((url) => url.startsWith('https://logger/requests')) },
    status: 500,
    code: 'INTERNAL_ERROR'
  }
];

describe('gateway rejects with one error contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it.each(REJECTIONS)('rejects: $name', async ({ request, options, status, code, id, idNot }) => {
    const { env } = createEnv(options);
    const response = await gateway.fetch(request(), env, {} as ExecutionContext);
    const body = (await response.json()) as { error?: unknown; code?: unknown; id?: unknown };

    expect(response.status).toBe(status);
    expect(Object.values(GATEWAY_ERROR_CODES)).toContain(body.code);
    expect(body.code).toBe(code);
    expect(typeof body.error).toBe('string');
    expect(body.error).not.toBe('');
    expect(typeof body.id).toBe('string');
    expect(body.id).not.toBe('');
    expect(response.headers.get('X-Request-Id')).toBe(body.id);
    if (id !== undefined) {
      expect(body.id).toBe(id);
    }
    if (idNot !== undefined) {
      expect(body.id).not.toBe(idNot);
    }
  });

  it('rejects: 502 begin when the workflow trigger fails carries code and id', async () => {
    const { env } = createEnv();
    const response = await gateway.fetch(
      publicPost('/begin', { url: 'https://example.com', request_id: 'req-ok-1' }),
      env,
      {} as ExecutionContext
    );
    const body = (await response.json()) as { code?: unknown; id?: unknown; requestId?: unknown };

    expect(response.status).toBe(502);
    expect(body.code).toBe('WORKFLOW_TRIGGER_FAILED');
    expect(body.id).toBe('req-ok-1');
    expect(body.requestId).toBe('req-ok-1');
    expect(response.headers.get('X-Request-Id')).toBe('req-ok-1');
  });
});

describe('gateway 500 never leaks the secret of a thrown error', () => {
  const SECRET_ERROR = (): Error => new Error('token=sk-live-SECRET123');

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function expectSecretKeptServerSide(request: Request, options: CreateEnvOptions): Promise<void> {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env } = createEnv(options);
    const response = await gateway.fetch(request, env, {} as ExecutionContext);
    const body = (await response.json()) as { id: string };

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Internal error', code: 'INTERNAL_ERROR', id: body.id });
    expect(typeof body.id).toBe('string');
    expect(JSON.stringify(body)).not.toContain('SECRET123');
    const logged = errorSpy.mock.calls.map((args) =>
      args.map((arg) => (arg instanceof Error ? arg.message : JSON.stringify(arg))).join(' ')
    );
    expect(logged.some((line) => line.includes(body.id) && line.includes('SECRET123'))).toBe(true);
  }

  it('secret: begin keeps the raw text in the server log with the id', async () => {
    await expectSecretKeptServerSide(
      publicPost('/begin', { url: 'https://example.com', request_id: 'req-ok-1' }),
      { bucketPut: async () => Promise.reject(SECRET_ERROR()) }
    );
  });

  it('secret: internal log keeps the raw text in the server log with the id', async () => {
    await expectSecretKeptServerSide(
      internalPost('/internal/log', { requestId: 'req-log-1', event: { type: 'step.started' } }),
      {
        logger: (url) => {
          if (url === 'https://logger/event') {
            throw SECRET_ERROR();
          }
          return undefined;
        }
      }
    );
  });
});

/** The JSON value of each ARCHIVE_BUCKET.put call, in call order. */
function storedOptions(env: Env): unknown[] {
  const put = env.ARCHIVE_BUCKET.put as unknown as ReturnType<typeof vi.fn>;
  return put.mock.calls.map((args) => JSON.parse(String(args[1])));
}

describe('begin accepts valid options as before', () => {
  const url = 'https://example.com/article';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    { name: 'the backfill body', body: { url, request_id: 'req-ok-2', includeScreenshot: true, includePdf: false } },
    { name: 'the dashboard body', body: { url, request_id: 'req-ok-3', steps: ['singlefile'] } }
  ])('accepts valid options: $name', async ({ body }) => {
    const { env, workflowFetch } = createEnv({ workflowReply: () => jsonResponse({ started: true }, 201) });
    const response = await gateway.fetch(publicPost('/begin', body), env, {} as ExecutionContext);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ requestId: body.request_id });
    const { request_id: _id, ...expected } = body;
    expect(storedOptions(env)).toEqual([expected]);
    expect(workflowFetch).toHaveBeenCalledTimes(1);
  });

  it('accepts valid options: strips the script fields before storing', async () => {
    const { env, workflowFetch } = createEnv({ workflowReply: () => jsonResponse({ started: true }, 201) });
    const response = await gateway.fetch(
      publicPost('/begin', { url, request_id: 'req-ok-4', preScript: 'x', cleanupScript: 'y' }),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(201);
    expect(storedOptions(env)).toEqual([{ url }]);
    expect(workflowFetch).toHaveBeenCalledTimes(1);
  });
});

describe('begin rejects malformed options before any write', () => {
  const url = 'https://example.com/article';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each<{ name: string; body: unknown; code?: string; id?: string; idNot?: string }>([
    { name: 'a null body', body: null },
    { name: 'a string body', body: 'text' },
    { name: 'a number body', body: 42 },
    { name: 'an empty array body', body: [] },
    { name: 'an array of options', body: [{ url }] },
    { name: 'a string for a boolean', body: { url, request_id: 'req-ok-5', includePdf: 'yes' }, id: 'req-ok-5' },
    { name: 'a number for a boolean', body: { url, request_id: 'req-ok-5', includeScreenshot: 1 }, id: 'req-ok-5' },
    { name: 'a string for the steps', body: { url, request_id: 'req-ok-5', steps: 'render' }, id: 'req-ok-5' },
    { name: 'an unknown step name', body: { url, request_id: 'req-ok-5', steps: ['bogus'] }, id: 'req-ok-5' },
    { name: 'a number for the url', body: { url: 123, request_id: 'req-ok-5' }, id: 'req-ok-5' },
    { name: 'a number for the request id', body: { url, request_id: 123 }, code: 'INVALID_REQUEST_ID', idNot: '123' },
    {
      name: 'options over the size limit',
      body: { url: 'https://e.com/' + 'a'.repeat(MAX_OPTIONS_BYTES), request_id: 'req-ok-5' },
      id: 'req-ok-5'
    }
  ])('rejects before any write: $name', async ({ body, code = 'INVALID_OPTIONS', id, idNot }) => {
    const { env, loggerFetch, workflowFetch } = createEnv({ workflowReply: () => jsonResponse({ started: true }, 201) });
    const response = await gateway.fetch(publicPost('/begin', JSON.stringify(body)), env, {} as ExecutionContext);
    const data = (await response.json()) as { error?: unknown; code?: unknown; id?: unknown };

    expect(response.status).toBe(400);
    expect(data.code).toBe(code);
    expect(typeof data.error).toBe('string');
    expect(data.error).not.toBe('');
    expect(typeof data.id).toBe('string');
    expect(data.id).not.toBe('');
    expect(response.headers.get('X-Request-Id')).toBe(data.id);
    if (id !== undefined) {
      expect(data.id).toBe(id);
    }
    if (idNot !== undefined) {
      expect(data.id).not.toBe(idNot);
    }
    expect(env.ARCHIVE_BUCKET.put).not.toHaveBeenCalled();
    expect(loggerFetch).not.toHaveBeenCalled();
    expect(workflowFetch).not.toHaveBeenCalled();
  });
});

describe('begin drops unknown option keys the same way every time', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('stores only the known keys on every call and logs the dropped names without values', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = 'https://example.com/article';
    const body = { url, request_id: 'req-ok-6', foo: 1, nested: { a: 1 } };
    const { env } = createEnv({ workflowReply: () => jsonResponse({ started: true }, 201) });

    const first = await gateway.fetch(publicPost('/begin', body), env, {} as ExecutionContext);
    const second = await gateway.fetch(publicPost('/begin', body), env, {} as ExecutionContext);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(storedOptions(env)).toEqual([{ url }, { url }]);
    const logged = warnSpy.mock.calls.map((args) => JSON.stringify(args));
    expect(logged.some((line) => line.includes('foo') && line.includes('nested'))).toBe(true);
    expect(logged.some((line) => line.includes('"a":1'))).toBe(false);
  });
});

describe('begin caller kinds', () => {
  const url = 'https://example.com/article';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts the public key for a body without dryRun or steps', async () => {
    const { env, workflowFetch } = createEnv({ workflowReply: () => jsonResponse({ started: true }, 201) });
    const body = { url, request_id: 'req-pk-1', includeScreenshot: true, includePdf: false };
    const response = await gateway.fetch(publicPost('/begin', body), env, {} as ExecutionContext);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ requestId: 'req-pk-1' });
    const [stored] = storedOptions(env) as Record<string, unknown>[];
    expect(stored).not.toHaveProperty('dryRun');
    expect(stored).not.toHaveProperty('steps');
    expect(workflowFetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a call with no key', async () => {
    const { env, workflowFetch } = createEnv({ workflowReply: () => jsonResponse({ started: true }, 201) });
    const request = new Request(`${GATEWAY}/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, request_id: 'req-pk-1' })
    });
    const response = await gateway.fetch(request, env, {} as ExecutionContext);
    const data = (await response.json()) as { code?: unknown };

    expect(response.status).toBe(401);
    expect(data.code).toBe('UNAUTHORIZED');
    expect(workflowFetch).not.toHaveBeenCalled();
  });

  it('refuses a wrong internal key when no public key is sent', async () => {
    const { env, workflowFetch } = createEnv({ workflowReply: () => jsonResponse({ started: true }, 201) });
    const response = await gateway.fetch(
      internalPost('/begin', { url, request_id: 'req-pk-1' }, 'wrong'),
      env,
      {} as ExecutionContext
    );
    const data = (await response.json()) as { code?: unknown };

    expect(response.status).toBe(401);
    expect(data.code).toBe('UNAUTHORIZED');
    expect(workflowFetch).not.toHaveBeenCalled();
  });
});
