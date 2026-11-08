/**
 * Test harness for the archive workflow: a fake step that runs or replays like
 * the Workflows engine, fake bindings for every service the run calls, an event
 * factory and failure fixtures. Test-only; never imported by the worker.
 */
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import type {
  ArchiveManifest,
  ArchiveOptions,
  ArtifactKind,
  ArtifactMeta,
  EventType,
} from '@warg/shared';
import { getOptionsKey, getR2Key } from '@warg/shared';
import { ArchiveWorkflow } from '../index.js';
import type {
  DerivativeResponse,
  GcsResponse,
  ReadabilityResponse,
  RendererResponse,
  WorkflowParams,
  WorkflowResult,
} from '../types.js';

type StepCallback = () => Promise<unknown>;

interface StepConfig {
  retries?: { limit: number };
}

export interface FakeStep {
  step: WorkflowStep;
  /** Every step.do name, in call order, cached or not. */
  names: string[];
  /** Callback executions per step name (a cached step adds none). */
  attempts: Map<string, number>;
  sleeps: Array<[string, unknown]>;
  /** Step results by `name#occurrence`, in the order they completed. */
  cache: Map<string, unknown>;
}

/**
 * A step that behaves like the Workflows engine on the points the tests pin:
 * a result is cached by step name and occurrence (deep-cloned, as the engine
 * serializes it), so a run against a seeded cache replays it; a throwing
 * callback is re-run up to `retries.limit` extra times, and at once stops on a
 * NonRetryableError. A step without a config is not retried. Sleeps return at once.
 */
export function makeFakeStep(seed: Map<string, unknown> = new Map()): FakeStep {
  const cache = new Map(seed);
  const names: string[] = [];
  const attempts = new Map<string, number>();
  const sleeps: Array<[string, unknown]> = [];
  const seen = new Map<string, number>();

  const fake = {
    async do(name: string, configOrFn: StepConfig | StepCallback, fn?: StepCallback): Promise<unknown> {
      names.push(name);
      const occurrence = (seen.get(name) ?? 0) + 1;
      seen.set(name, occurrence);
      const key = `${name}#${occurrence}`;
      if (cache.has(key)) return structuredClone(cache.get(key));

      const callback = typeof configOrFn === 'function' ? configOrFn : fn;
      const config = typeof configOrFn === 'function' ? undefined : configOrFn;
      if (!callback) throw new Error(`step ${name} has no callback`);

      const maxAttempts = (config?.retries?.limit ?? 0) + 1;
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        attempts.set(name, (attempts.get(name) ?? 0) + 1);
        try {
          const value = await callback();
          cache.set(key, structuredClone(value));
          return value;
        } catch (error) {
          lastError = error;
          if (error instanceof NonRetryableError) break;
        }
      }
      throw lastError;
    },
    async sleep(name: string, duration: unknown): Promise<void> {
      sleeps.push([name, duration]);
    },
  };

  // The fake implements only the step.do and step.sleep surface the workflow uses.
  return { step: fake as unknown as WorkflowStep, names, attempts, sleeps, cache };
}

/** An R2 bucket fake: string bodies in a map. */
export interface FakeBucket {
  objects: Map<string, string>;
  get(key: string): Promise<{ json(): Promise<unknown>; text(): Promise<string> } | null>;
  put(key: string, body: string): Promise<null>;
  head(key: string): Promise<{ size: number; httpEtag: string; httpMetadata: { contentType?: string } } | null>;
}

export function makeFakeBucket(): FakeBucket {
  const objects = new Map<string, string>();
  return {
    objects,
    async get(key) {
      const body = objects.get(key);
      if (body === undefined) return null;
      return {
        json: async () => JSON.parse(body) as unknown,
        text: async () => body,
      };
    },
    async put(key, body) {
      objects.set(key, body);
      return null;
    },
    async head(key) {
      const body = objects.get(key);
      if (body === undefined) return null;
      return { size: body.length, httpEtag: `etag-${key}`, httpMetadata: {} };
    },
  };
}

export const SERVICE_BINDINGS = [
  'RENDERER',
  'HYPERRENDERER',
  'SINGLEFILE',
  'READABILITY',
  'MONOLITH',
  'GCS',
] as const;
export type ServiceBinding = (typeof SERVICE_BINDINGS)[number];

/** Answers one call to a service; `body` is the parsed JSON request body. */
export type ServiceHandler = (body: Record<string, unknown>) => Response | Promise<Response>;

/** The fixed size of every fake artifact: well under the 24 MB monolith gate. */
export const FAKE_ARTIFACT_BYTES = 2048;

const CONTENT_TYPES: Record<ArtifactKind, string> = {
  'rendered.html': 'text/html',
  'rendered.md': 'text/markdown',
  'screenshot.png': 'image/png',
  'page.pdf': 'application/pdf',
  'singlefile.html': 'text/html',
  'readability.json': 'application/json',
  'readability.md': 'text/markdown',
  'monolith.html': 'text/html',
  'manifest.json': 'application/json',
};

/** A deterministic artifact: no clock or random input, so persist step names repeat. */
export function fakeArtifact(requestId: string, kind: ArtifactKind): ArtifactMeta {
  return {
    kind,
    r2Key: getR2Key(requestId, kind),
    bytes: FAKE_ARTIFACT_BYTES,
    sha256: `sha-${kind}`,
    contentType: CONTENT_TYPES[kind],
  };
}

/** The render artifacts the default renderer returns for a request body. */
export function renderArtifactsFor(body: Record<string, unknown>): ArtifactMeta[] {
  const requestId = String(body.request_id);
  const kinds: ArtifactKind[] = ['rendered.html'];
  if (body.include_markdown) kinds.push('rendered.md');
  if (body.include_pdf) kinds.push('page.pdf');
  if (body.include_screenshot) kinds.push('screenshot.png');
  return kinds.map((kind) => fakeArtifact(requestId, kind));
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function defaultHandlers(bucket: FakeBucket): Record<ServiceBinding, ServiceHandler> {
  const render: ServiceHandler = (body) => {
    const response: RendererResponse = {
      uses_browser_rendering: true,
      quota_kind_used: 'rest_request',
      artifacts: renderArtifactsFor(body),
    };
    return jsonResponse(response);
  };
  const derivative = (kind: ArtifactKind): ServiceHandler => (body) => {
    const response: DerivativeResponse = { artifact: fakeArtifact(String(body.request_id), kind) };
    return jsonResponse(response);
  };
  return {
    RENDERER: render,
    HYPERRENDERER: render,
    SINGLEFILE: derivative('singlefile.html'),
    MONOLITH: derivative('monolith.html'),
    READABILITY: (body) => {
      const requestId = String(body.request_id);
      const response: ReadabilityResponse = {
        json: fakeArtifact(requestId, 'readability.json'),
        md: fakeArtifact(requestId, 'readability.md'),
      };
      return jsonResponse(response);
    },
    // Answers from the manifest the workflow wrote, as the GCS worker does.
    GCS: async (body) => {
      const stored = await bucket.get(String(body.manifest_key));
      if (!stored) return new Response('manifest not found', { status: 404 });
      const manifest = (await stored.json()) as ArchiveManifest;
      const response: GcsResponse = {
        success: true,
        firestore_doc_id: 'doc-1',
        uploaded: manifest.artifacts.length,
        artifacts: manifest.artifacts.map((artifact) => ({
          kind: artifact.kind,
          gcs_path: `gs://archive/${manifest.requestId}/${artifact.kind}`,
        })),
      };
      return jsonResponse(response);
    },
  };
}

export interface LoggedEvent {
  type: EventType;
  data: Record<string, unknown>;
}

export interface FakeLogger {
  /** Every event from /event and /events/batch, flattened in arrival order. */
  events: LoggedEvent[];
  /** Bodies of PATCH /request/<id>, with the request id. */
  patches: Array<{ requestId: string; body: unknown }>;
}

export interface FakeQuota {
  acquired: string[];
  released: string[];
}

export interface FakeEnvOptions {
  /** Per-binding handlers that replace the default success answers. */
  handlers?: Partial<Record<ServiceBinding, ServiceHandler>>;
  /** Reuse a bucket, as a restarted instance sees the same R2 objects. */
  bucket?: FakeBucket;
}

export interface FakeEnv {
  env: Env;
  bucket: FakeBucket;
  calls: Record<ServiceBinding, Array<Record<string, unknown>>>;
  logger: FakeLogger;
  quota: FakeQuota;
}

interface FakeFetcher {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

function makeServiceFetcher(
  handler: ServiceHandler,
  calls: Array<Record<string, unknown>>
): FakeFetcher {
  return {
    async fetch(_input, init) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      return await handler(body);
    },
  };
}

interface EventBody {
  type: EventType;
  data?: Record<string, unknown>;
}

function makeLoggerFetcher(logger: FakeLogger): FakeFetcher {
  return {
    async fetch(input, init) {
      const { pathname } = new URL(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (init?.method === 'PATCH' && pathname.startsWith('/request/')) {
        logger.patches.push({ requestId: pathname.slice('/request/'.length), body });
      } else if (pathname === '/event') {
        const event = body.event as EventBody;
        logger.events.push({ type: event.type, data: event.data ?? {} });
      } else if (pathname === '/events/batch') {
        for (const event of body.events as EventBody[]) {
          logger.events.push({ type: event.type, data: event.data ?? {} });
        }
      } else {
        return new Response('not found', { status: 404 });
      }
      return new Response('ok', { status: 200 });
    },
  };
}

function makeQuotaNamespace(quota: FakeQuota) {
  let issued = 0;
  const stub = {
    async acquire(pool: string, _requestId: string) {
      issued += 1;
      const leaseId = `lease-${pool}-${issued}`;
      quota.acquired.push(leaseId);
      return { granted: true, leaseId };
    },
    async release(leaseId: string) {
      quota.released.push(leaseId);
    },
    async listSandboxLeases() {
      return [];
    },
  };
  return {
    idFromName: (name: string) => name,
    get: (_id: string) => stub,
  };
}

/**
 * Every binding the archive run uses, faked: an R2 bucket, one recording
 * fetcher per service (default answers succeed deterministically), the logger
 * and the browser quota namespace, which grants every lease.
 */
export function makeFakeEnv(options: FakeEnvOptions = {}): FakeEnv {
  const bucket = options.bucket ?? makeFakeBucket();
  const handlers = { ...defaultHandlers(bucket), ...options.handlers };
  const calls: FakeEnv['calls'] = {
    RENDERER: [],
    HYPERRENDERER: [],
    SINGLEFILE: [],
    READABILITY: [],
    MONOLITH: [],
    GCS: [],
  };
  const logger: FakeLogger = { events: [], patches: [] };
  const quota: FakeQuota = { acquired: [], released: [] };

  const services = Object.fromEntries(
    SERVICE_BINDINGS.map((binding) => [binding, makeServiceFetcher(handlers[binding], calls[binding])])
  );
  const fake = {
    ...services,
    ARCHIVE_BUCKET: bucket,
    LOGGER: makeLoggerFetcher(logger),
    BROWSER_QUOTA: makeQuotaNamespace(quota),
    MOCK_PIPELINE: 'false',
    INTERNAL_API_KEY: 'test-key',
  };
  // The fakes implement only the binding methods the workflow calls; the Env
  // types (R2Bucket, Fetcher, DurableObjectNamespace) are far wider.
  return { env: fake as unknown as Env, bucket, calls, logger, quota };
}

/** A fixed start time, so nothing in an event depends on the clock. */
const EVENT_TIMESTAMP = new Date('2026-01-01T00:00:00.000Z');

export function makeEvent(requestId: string, url: string): WorkflowEvent<WorkflowParams> {
  return {
    payload: { request_id: requestId, url, options_r2_key: getOptionsKey(requestId) },
    timestamp: EVENT_TIMESTAMP,
    instanceId: requestId,
    workflowName: 'archive-workflow',
  };
}

/** Stores the request options where the run reads them. */
export async function seedOptions(
  bucket: FakeBucket,
  requestId: string,
  options: ArchiveOptions
): Promise<void> {
  await bucket.put(getOptionsKey(requestId), JSON.stringify(options));
}

export type RunOutcome =
  | { status: 'resolved'; result: WorkflowResult }
  | { status: 'rejected'; error: unknown };

/** Runs a fresh workflow object and settles the run, so a test can inspect a failure. */
export async function runArchiveWorkflow(
  env: Env,
  event: WorkflowEvent<WorkflowParams>,
  step: WorkflowStep
): Promise<RunOutcome> {
  // The run reads only `this.env`; the execution context is never touched.
  const workflow = new ArchiveWorkflow({} as ExecutionContext, env);
  try {
    return { status: 'resolved', result: await workflow.run(event, step) };
  } catch (error) {
    return { status: 'rejected', error };
  }
}

/** The result of a run that must have resolved. */
export function resultOf(outcome: RunOutcome): WorkflowResult {
  if (outcome.status !== 'resolved') {
    throw new Error(`expected the run to resolve, it rejected: ${String(outcome.error)}`);
  }
  return outcome.result;
}

/** The error of a run that must have rejected. */
export function errorOf(outcome: RunOutcome): Error {
  if (outcome.status !== 'rejected') throw new Error('expected the run to reject, it resolved');
  if (!(outcome.error instanceof Error)) throw new Error(`run rejected with a non-error: ${String(outcome.error)}`);
  return outcome.error;
}

export function eventsOfType(logger: FakeLogger, type: EventType): LoggedEvent[] {
  return logger.events.filter((event) => event.type === type);
}

/** A Browser Rendering failure for a host that does not resolve, wrapped by the renderer. */
export function deadHostRenderFailure(): Response {
  return jsonResponse(
    {
      error: 'Browser Rendering /content failed',
      status: 500,
      details: 'dial tcp: lookup dead.example.com on 1.1.1.1:53: no such host',
    },
    502
  );
}

/** A plain 403 from a service: access blocked, never retried. */
export function accessBlockedResponse(): Response {
  return new Response('Forbidden', { status: 403 });
}

/** A plain-text service failure; a 5xx is retryable. */
export function serviceError(status: number): Response {
  return new Response(`upstream failure ${status}`, { status });
}

/** The monolith worker refusing an oversized input: never retried. */
export function monolithInputTooLarge(): Response {
  return jsonResponse({ error: 'Monolith failed', message: 'Monolith input too large: 40000000 bytes' }, 500);
}
