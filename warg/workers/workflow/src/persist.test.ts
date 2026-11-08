import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowStep } from 'cloudflare:workers';
import type { ArtifactMeta, ArchiveManifest, WorkflowCheckpoint } from '@warg/shared';
import { getOptionsKey, getR2Key } from '@warg/shared';
import { createCheckpoint, recordArtifacts } from './checkpoint.js';
import { persistArtifactsIncremental, persistManifestSuffix, writeManifest } from './persist.js';

const REQUEST_ID = 'req-persist-1';
const URL = 'https://example.com/article';
const MANIFEST_PREFIX = `archives/${REQUEST_ID}/state/manifests/`;

type StepCallback = () => Promise<unknown>;

interface RecordingStep {
  step: WorkflowStep;
  names: string[];
  configs: Map<string, unknown>;
}

/**
 * A step that behaves like the Workflows engine on replay: results are cached
 * by step name and occurrence count, so a second run against the same cache
 * returns the cached value instead of running the callback again.
 */
function makeReplayStep(cache: Map<string, unknown> = new Map()): RecordingStep & {
  cache: Map<string, unknown>;
} {
  const names: string[] = [];
  const configs = new Map<string, unknown>();
  const seen = new Map<string, number>();
  const fake = {
    async do(name: string, configOrFn: unknown, fn?: StepCallback): Promise<unknown> {
      names.push(name);
      const callback = typeof configOrFn === 'function' ? (configOrFn as StepCallback) : fn;
      if (typeof configOrFn !== 'function') configs.set(name, configOrFn);
      const count = (seen.get(name) ?? 0) + 1;
      seen.set(name, count);
      const key = `${name}#${count}`;
      if (cache.has(key)) return cache.get(key);
      if (!callback) throw new Error(`step ${name} has no callback`);
      const value = await callback();
      cache.set(key, value);
      return value;
    },
  };
  // The fake implements only the step.do surface the persist helpers use.
  return { step: fake as unknown as WorkflowStep, names, configs, cache };
}

/** A step that runs every callback, as a re-executed step does. */
function makeNoCacheStep(): RecordingStep {
  const names: string[] = [];
  const configs = new Map<string, unknown>();
  const fake = {
    async do(name: string, configOrFn: unknown, fn?: StepCallback): Promise<unknown> {
      names.push(name);
      if (typeof configOrFn !== 'function') configs.set(name, configOrFn);
      const callback = typeof configOrFn === 'function' ? (configOrFn as StepCallback) : fn;
      if (!callback) throw new Error(`step ${name} has no callback`);
      return await callback();
    },
  };
  // The fake implements only the step.do surface the persist helpers use.
  return { step: fake as unknown as WorkflowStep, names, configs };
}

function makeBucket() {
  const objects = new Map<string, string>();
  const bucket = {
    put: vi.fn(async (key: string, body: string) => {
      objects.set(key, body);
      return null;
    }),
    get: vi.fn(async () => null),
  };
  return { bucket, objects };
}

function makeEnv(bucket: ReturnType<typeof makeBucket>) {
  const gcsBodies: Array<{ request_id: string; manifest_key: string }> = [];
  const gcsFetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { request_id: string; manifest_key: string };
    gcsBodies.push(body);
    const manifest = JSON.parse(bucket.objects.get(body.manifest_key) ?? '{"artifacts":[]}') as ArchiveManifest;
    return new Response(
      JSON.stringify({
        success: true,
        firestore_doc_id: 'doc-1',
        uploaded: manifest.artifacts.length,
        artifacts: manifest.artifacts.map((artifact) => ({
          kind: artifact.kind,
          gcs_path: `gs://archive/${REQUEST_ID}/${artifact.kind}`,
        })),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });
  const loggerFetch = vi.fn(async () => new Response('ok', { status: 200 }));
  // Only the bindings the persist helpers touch are provided.
  const env = {
    ARCHIVE_BUCKET: bucket.bucket,
    GCS: { fetch: gcsFetch },
    LOGGER: { fetch: loggerFetch },
    INTERNAL_API_KEY: 'test-key',
  } as unknown as Env;
  return { env, gcsFetch, gcsBodies, loggerFetch };
}

function artifact(kind: ArtifactMeta['kind'], contentType: string, bytes: number): ArtifactMeta {
  return {
    kind,
    r2Key: getR2Key(REQUEST_ID, kind),
    bytes,
    sha256: `sha-${kind}`,
    contentType,
  };
}

const renderedHtml = artifact('rendered.html', 'text/html', 1200);
const screenshot = artifact('screenshot.png', 'image/png', 5400);
const singlefileHtml = artifact('singlefile.html', 'text/html', 8800);
const renderArtifacts = [renderedHtml, screenshot];

function makeCheckpoint(): WorkflowCheckpoint {
  const checkpoint = createCheckpoint(REQUEST_ID, getOptionsKey(REQUEST_ID), true);
  recordArtifacts(checkpoint, 'render', renderArtifacts);
  recordArtifacts(checkpoint, 'singlefile', [singlefileHtml]);
  return checkpoint;
}

function persistRender(
  env: Env,
  step: WorkflowStep,
  checkpoint: WorkflowCheckpoint,
  artifacts: ArtifactMeta[] = renderArtifacts
) {
  return persistArtifactsIncremental(
    env,
    step,
    checkpoint,
    REQUEST_ID,
    URL,
    'render',
    artifacts,
    'step_succeeded'
  );
}

function manifestKeys(objects: Map<string, string>): string[] {
  return [...objects.keys()].filter((key) => key.startsWith(MANIFEST_PREFIX));
}

describe('persistArtifactsIncremental — persist flow', () => {
  it('runs the four persist steps in order under one shared token', async () => {
    const bucket = makeBucket();
    const { env } = makeEnv(bucket);
    const { step, names } = makeReplayStep();

    await persistRender(env, step, makeCheckpoint());

    expect(names).toHaveLength(4);
    const [manifest = '', start, gcs, complete] = names;
    expect(manifest).toMatch(/^write-manifest-render-.+\.json$/);
    const token = manifest.slice('write-manifest-'.length).replace(/[^a-zA-Z0-9_-]/g, '_');
    expect(start).toBe(`log-persist-start-${token}`);
    expect(gcs).toBe(`persist-gcs-${token}`);
    expect(complete).toBe(`log-persist-complete-${token}`);
  });

  it('keeps the GCS upload retry and timeout policy', async () => {
    const bucket = makeBucket();
    const { env } = makeEnv(bucket);
    const { step, names, configs } = makeReplayStep();

    await persistRender(env, step, makeCheckpoint());

    const gcsName = names.find((name) => name.startsWith('persist-gcs-'));
    expect(gcsName).toBeDefined();
    expect(configs.get(gcsName ?? '')).toEqual({
      retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
      timeout: '10 minutes',
    });
  });

  it('writes a step manifest listing the persisted artifacts', async () => {
    const bucket = makeBucket();
    const { env } = makeEnv(bucket);
    const { step } = makeReplayStep();

    await persistRender(env, step, makeCheckpoint());

    const keys = manifestKeys(bucket.objects);
    expect(keys).toHaveLength(1);
    const [key = ''] = keys;
    expect(key).toMatch(new RegExp(`^${MANIFEST_PREFIX}render-.+\\.json$`));
    const manifest = JSON.parse(bucket.objects.get(key) ?? '') as ArchiveManifest;
    expect(manifest).toMatchObject({ requestId: REQUEST_ID, url: URL, artifacts: renderArtifacts });
  });

  it('posts the manifest to GCS once and marks the artifacts persisted', async () => {
    const bucket = makeBucket();
    const { env, gcsFetch, gcsBodies } = makeEnv(bucket);
    const { step } = makeReplayStep();
    const checkpoint = makeCheckpoint();

    const result = await persistRender(env, step, checkpoint);

    expect(gcsFetch).toHaveBeenCalledTimes(1);
    expect(gcsBodies).toEqual([{ request_id: REQUEST_ID, manifest_key: manifestKeys(bucket.objects)[0] }]);
    expect(result?.firestore_doc_id).toBe('doc-1');
    expect(checkpoint.artifacts['rendered.html']?.persisted).toBe(true);
    expect(checkpoint.artifacts['screenshot.png']?.persisted).toBe(true);
    expect(checkpoint.artifacts['singlefile.html']?.persisted).toBe(false);
  });

  it('names the final manifest write after its fixed key', async () => {
    const bucket = makeBucket();
    const { env } = makeEnv(bucket);
    const { step, names } = makeReplayStep();
    const key = getR2Key(REQUEST_ID, 'manifest.json');

    const written = await writeManifest(env, step, REQUEST_ID, URL, renderArtifacts, key);

    expect(written).toBe(key);
    expect(names).toEqual(['write-manifest-manifest.json']);
  });
});

describe('persistArtifactsIncremental — replay-stable names', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function wakeLater(): void {
    vi.setSystemTime(new Date(Date.now() + 90_000));
  }

  it('replays the same step names after a sleep-wake and does not upload to GCS again', async () => {
    const bucket = makeBucket();
    const { env, gcsFetch } = makeEnv(bucket);
    const cache = new Map<string, unknown>();

    const first = makeReplayStep(cache);
    await persistRender(env, first.step, makeCheckpoint());
    expect(gcsFetch).toHaveBeenCalledTimes(1);

    wakeLater();
    const replay = makeReplayStep(cache);
    const checkpoint = makeCheckpoint();
    await persistRender(env, replay.step, checkpoint);

    expect(replay.names).toEqual(first.names);
    expect(gcsFetch).toHaveBeenCalledTimes(1);
    expect(checkpoint.artifacts['rendered.html']?.persisted).toBe(true);
  });

  it('gives a step persist and the final reconcile in one run different names', async () => {
    const bucket = makeBucket();
    const { env } = makeEnv(bucket);
    const run = makeReplayStep();
    const checkpoint = makeCheckpoint();

    await persistRender(env, run.step, checkpoint, [renderedHtml]);
    const stepNames = [...run.names];
    await persistArtifactsIncremental(
      env,
      run.step,
      checkpoint,
      REQUEST_ID,
      URL,
      'final',
      [singlefileHtml],
      'final_reconcile'
    );
    const finalNames = run.names.slice(stepNames.length);

    expect(stepNames).toHaveLength(4);
    expect(finalNames).toHaveLength(4);
    expect(finalNames.filter((name) => stepNames.includes(name))).toEqual([]);
  });

  it('derives a different suffix for a different step or a different artifact set', async () => {
    const render = await persistManifestSuffix(REQUEST_ID, 'render', renderArtifacts);
    const final = await persistManifestSuffix(REQUEST_ID, 'final', renderArtifacts);
    const renderHtmlOnly = await persistManifestSuffix(REQUEST_ID, 'render', [renderedHtml]);
    const otherRequest = await persistManifestSuffix('req-persist-2', 'render', renderArtifacts);

    expect(render).toMatch(/^[0-9a-f]{16}$/);
    expect(new Set([render, final, renderHtmlOnly, otherRequest]).size).toBe(4);
  });

  it('derives the same suffix whatever the order of the artifacts, without reordering them', async () => {
    const reversed = [screenshot, renderedHtml];

    const suffix = await persistManifestSuffix(REQUEST_ID, 'render', reversed);

    expect(suffix).toBe(await persistManifestSuffix(REQUEST_ID, 'render', renderArtifacts));
    expect(reversed).toEqual([screenshot, renderedHtml]);
  });

  it('overwrites one manifest object when the persist runs again later', async () => {
    const bucket = makeBucket();
    const { env } = makeEnv(bucket);

    const first = makeNoCacheStep();
    await persistRender(env, first.step, makeCheckpoint());
    wakeLater();
    const again = makeNoCacheStep();
    await persistRender(env, again.step, makeCheckpoint());

    const manifestPuts = bucket.bucket.put.mock.calls
      .map(([key]) => key)
      .filter((key) => key.startsWith(MANIFEST_PREFIX));
    expect(manifestPuts).toHaveLength(2);
    expect(manifestPuts[1]).toBe(manifestPuts[0]);
    expect(manifestKeys(bucket.objects)).toHaveLength(1);
  });

  it('addresses the same manifest key on replay', async () => {
    const bucket = makeBucket();
    const { env, gcsBodies } = makeEnv(bucket);
    const cache = new Map<string, unknown>();

    const first = makeReplayStep(cache);
    await persistRender(env, first.step, makeCheckpoint());
    wakeLater();
    const fresh = makeNoCacheStep();
    await persistRender(env, fresh.step, makeCheckpoint());

    expect(gcsBodies).toHaveLength(2);
    const [firstCall, laterCall] = gcsBodies;
    expect(laterCall?.manifest_key).toBe(firstCall?.manifest_key);
    expect(first.names[0]).toBe(`write-manifest-${firstCall?.manifest_key.split('/').pop() ?? ''}`);
    expect(fresh.names).toEqual(first.names);
  });
});
