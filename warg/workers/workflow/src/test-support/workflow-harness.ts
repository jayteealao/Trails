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
  ReadabilityResult,
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

/** The step context the workflow reads: the attempt number, 1 on the first try. */
type StepCallback = (ctx: { attempt: number }) => Promise<unknown>;

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

/** Thrown by a fake step once its instance has stopped: no later step runs or records a result. */
export class InstanceStopped extends Error {
  constructor(at: string) {
    super(`instance stopped before step ${at}`);
    this.name = 'InstanceStopped';
  }
}

export interface FakeStepOptions {
  /**
   * Stops the instance when a step.do or step.sleep of this name is reached,
   * as an engine that goes away mid-run: that step and every later one throw
   * InstanceStopped without running, and a callback still in flight records no result.
   */
  haltBefore?: string;
  /** Called once, synchronously, at the moment the instance stops. */
  onHalt?: () => void;
}

/**
 * A step that behaves like the Workflows engine on the points the tests pin:
 * a result is cached by step name and occurrence (deep-cloned, as the engine
 * serializes it), so a run against a seeded cache replays it; a throwing
 * callback is re-run up to `retries.limit` extra times, and at once stops on a
 * NonRetryableError. A step without a config is not retried. Sleeps return at once.
 */
export function makeFakeStep(
  seed: Map<string, unknown> = new Map(),
  options: FakeStepOptions = {}
): FakeStep {
  const cache = new Map(seed);
  const names: string[] = [];
  const attempts = new Map<string, number>();
  const sleeps: Array<[string, unknown]> = [];
  const seen = new Map<string, number>();
  let stoppedAt: string | undefined;

  const stopIfHalted = (name: string): void => {
    if (stoppedAt === undefined && name === options.haltBefore) {
      stoppedAt = name;
      options.onHalt?.();
    }
    if (stoppedAt !== undefined) throw new InstanceStopped(stoppedAt);
  };

  const fake = {
    async do(name: string, configOrFn: StepConfig | StepCallback, fn?: StepCallback): Promise<unknown> {
      stopIfHalted(name);
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
          const value = await callback({ attempt });
          if (stoppedAt !== undefined) throw new InstanceStopped(stoppedAt);
          cache.set(key, structuredClone(value));
          return value;
        } catch (error) {
          if (stoppedAt !== undefined) throw new InstanceStopped(stoppedAt);
          lastError = error;
          if (error instanceof NonRetryableError) break;
        }
      }
      throw lastError;
    },
    async sleep(name: string, duration: unknown): Promise<void> {
      stopIfHalted(name);
      sleeps.push([name, duration]);
    },
  };

  // The fake implements only the step.do and step.sleep surface the workflow uses.
  return { step: fake as unknown as WorkflowStep, names, attempts, sleeps, cache };
}

/** An R2 bucket fake: bodies in a map, binary bodies decoded as UTF-8 text. */
export interface FakeBucket {
  objects: Map<string, string>;
  get(key: string): Promise<{ json(): Promise<unknown>; text(): Promise<string> } | null>;
  put(key: string, body: string | ArrayBuffer | ArrayBufferView): Promise<null>;
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
      objects.set(key, typeof body === 'string' ? body : new TextDecoder().decode(body));
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
  'ai-markdown.md': 'text/markdown',
  'manifest.json': 'application/json',
};

/** The cleaned HTML the default readability fake stores: one relative link, one relative image. */
export const FIXTURE_READABILITY_HTML =
  '<h1>Fixture title</h1><p>Read <a href="../next">the next post</a>.</p><img src="img/a.png" alt="A figure">';

/** The readability.md body the default readability fake stores. */
export const FIXTURE_READABILITY_MD = '# Fixture title\n\nRead the next post.\n';

function fixtureReadabilityResult(): ReadabilityResult {
  return {
    title: 'Fixture title',
    byline: null,
    dir: null,
    lang: 'en',
    content: FIXTURE_READABILITY_HTML,
    textContent: 'Fixture title Read the next post.',
    length: 33,
    excerpt: null,
    siteName: null,
    publishedTime: null,
    leadImage: null,
  };
}

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

/** The default success answer of the singlefile and monolith workers: one artifact of `kind`. */
export function derivativeAnswer(kind: ArtifactKind): ServiceHandler {
  return (body) => {
    const response: DerivativeResponse = { artifact: fakeArtifact(String(body.request_id), kind) };
    return jsonResponse(response);
  };
}

export interface HeldResponse {
  /** The handler to install for a binding; every call waits until `release`. */
  handler: ServiceHandler;
  /** Resolves when the first call arrives. */
  started: Promise<void>;
  /** The number of calls that have been answered. */
  answered(): number;
  /** Answers every waiting and later call, with `response` or the binding's normal answer. */
  release(response?: Response): void;
}

/**
 * A service that hangs: each call is recorded and answered only after
 * `release`, with `answer` (the binding's normal success answer) by default.
 */
export function holdResponse(answer: ServiceHandler): HeldResponse {
  let markStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let releaseAll: (response: Response | undefined) => void = () => undefined;
  const released = new Promise<Response | undefined>((resolve) => {
    releaseAll = resolve;
  });
  let answeredCount = 0;
  return {
    handler: async (body) => {
      markStarted();
      const response = await released;
      answeredCount += 1;
      return response?.clone() ?? (await answer(body));
    },
    started,
    answered: () => answeredCount,
    release: (response) => releaseAll(response),
  };
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
  return {
    RENDERER: render,
    HYPERRENDERER: render,
    SINGLEFILE: derivativeAnswer('singlefile.html'),
    MONOLITH: derivativeAnswer('monolith.html'),
    // Stores the JSON and Markdown bodies, as the readability worker does.
    READABILITY: async (body) => {
      const requestId = String(body.request_id);
      await bucket.put(getR2Key(requestId, 'readability.json'), JSON.stringify(fixtureReadabilityResult()));
      await bucket.put(getR2Key(requestId, 'readability.md'), FIXTURE_READABILITY_MD);
      const response: ReadabilityResponse = {
        json: fakeArtifact(requestId, 'readability.json'),
        md: fakeArtifact(requestId, 'readability.md'),
      };
      return jsonResponse(response);
    },
    GCS: gcsAnswer(bucket),
  };
}

/** The default GCS answer: answers from the manifest the workflow wrote, as the GCS worker does. */
export function gcsAnswer(bucket: FakeBucket): ServiceHandler {
  return async (body) => {
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
  /** Bodies of POST /request/<id>/settle, with the request id, one per attempt. */
  settles: Array<{ requestId: string; body: Record<string, unknown> }>;
}

/** Answers one settle call; it may also throw, as a timed-out fetch does. */
export type SettleHandler = (body: Record<string, unknown>) => Response | Promise<Response>;

/** Answers one Workers AI conversion; it may throw, as a failed binding call does. */
export type AiHandler = (html: string) => ConversionResponse | Promise<ConversionResponse>;

/** One recorded Workers AI conversion call. */
export interface AiCall {
  name: string;
  html: string;
  type: string;
  options?: ConversionRequestOptions;
}

/**
 * The default conversion: a heading, then one Markdown link or image per
 * `href`/`src` the HTML holds, so a test can read the URLs the binding received.
 */
export function echoLinksAsMarkdown(html: string): Exclude<ConversionResponse, { format: 'error' }> {
  const lines = ['# Fixture title', ''];
  for (const [, name, value] of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
    lines.push(name === 'src' ? `![image](${value})` : `[link](${value})`);
  }
  return {
    id: 'conversion-1',
    name: 'article.html',
    mimeType: 'text/html',
    format: 'markdown',
    tokens: lines.length,
    data: `${lines.join('\n')}\n`,
  };
}

function makeAiFake(handler: AiHandler, calls: AiCall[]) {
  return {
    async toMarkdown(document: MarkdownDocument, options?: ConversionRequestOptions): Promise<ConversionResponse> {
      const html = await document.blob.text();
      calls.push({ name: document.name, html, type: document.blob.type, options });
      return await handler(html);
    },
  };
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
  /** Replaces the default settle answer (200, applied). */
  settle?: SettleHandler;
  /** Runs the mock pipeline (MOCK_PIPELINE 'true'). */
  mockPipeline?: boolean;
  /** Replaces the default Workers AI conversion (echoLinksAsMarkdown). */
  ai?: AiHandler;
}

export interface FakeEnv {
  env: Env;
  bucket: FakeBucket;
  calls: Record<ServiceBinding, Array<Record<string, unknown>>>;
  logger: FakeLogger;
  quota: FakeQuota;
  /** Every Workers AI toMarkdown call, in order. */
  aiCalls: AiCall[];
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

const SETTLE_PATH = /^\/request\/([^/]+)\/settle$/;

function makeLoggerFetcher(logger: FakeLogger, settle: SettleHandler | undefined): FakeFetcher {
  return {
    async fetch(input, init) {
      const { pathname } = new URL(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const settleMatch = init?.method === 'POST' ? pathname.match(SETTLE_PATH) : null;
      if (settleMatch) {
        logger.settles.push({ requestId: decodeURIComponent(settleMatch[1] ?? ''), body });
        if (settle) return await settle(body);
        return new Response('{"found":true,"applied":true}', { status: 200 });
      }
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
  const logger: FakeLogger = { events: [], patches: [], settles: [] };
  const quota: FakeQuota = { acquired: [], released: [] };
  const aiCalls: AiCall[] = [];

  const services = Object.fromEntries(
    SERVICE_BINDINGS.map((binding) => [binding, makeServiceFetcher(handlers[binding], calls[binding])])
  );
  const fake = {
    ...services,
    ARCHIVE_BUCKET: bucket,
    LOGGER: makeLoggerFetcher(logger, options.settle),
    BROWSER_QUOTA: makeQuotaNamespace(quota),
    AI: makeAiFake(options.ai ?? echoLinksAsMarkdown, aiCalls),
    MOCK_PIPELINE: options.mockPipeline ? 'true' : 'false',
    INTERNAL_API_KEY: 'test-key',
  };
  // The fakes implement only the binding methods the workflow calls; the Env
  // types (R2Bucket, Fetcher, DurableObjectNamespace, Ai) are far wider.
  return { env: fake as unknown as Env, bucket, calls, logger, quota, aiCalls };
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
