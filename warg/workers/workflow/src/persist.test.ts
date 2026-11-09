import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowStep } from 'cloudflare:workers';
import type { ArtifactMeta, ArchiveManifest, CheckpointStep, WorkflowCheckpoint } from '@warg/shared';
import { getCheckpointKey, getOptionsKey, getR2Key } from '@warg/shared';
import {
  createCheckpoint,
  getUnpersistedArtifacts,
  markArtifactsPersisted,
  recordArtifacts,
} from './checkpoint.js';
import type { PersistedArtifacts } from './persist.js';
import {
  persistArtifactsIncremental,
  persistManifestSuffix,
  snapshotPersistedArtifacts,
  writeManifest,
} from './persist.js';

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

/**
 * An R2 bucket fake. With `stored`, `get` serves that checkpoint at the
 * request's checkpoint key, as the bucket of an instance that ran before.
 */
function makeBucket(stored?: WorkflowCheckpoint) {
  const objects = new Map<string, string>();
  const bucket = {
    put: vi.fn(async (key: string, body: string) => {
      objects.set(key, body);
      return null;
    }),
    get: vi.fn(async (key: string) =>
      stored && key === getCheckpointKey(REQUEST_ID)
        ? { json: async () => structuredClone(stored) }
        : null
    ),
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
  const loggerBodies: string[] = [];
  const loggerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
    loggerBodies.push(String(init?.body));
    return new Response('ok', { status: 200 });
  });
  // Only the bindings the persist helpers touch are provided.
  const env = {
    ARCHIVE_BUCKET: bucket.bucket,
    GCS: { fetch: gcsFetch },
    LOGGER: { fetch: loggerFetch },
    INTERNAL_API_KEY: 'test-key',
  } as unknown as Env;
  return { env, gcsFetch, gcsBodies, loggerFetch, loggerBodies };
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

function gcsPathOf(kind: ArtifactMeta['kind']): string {
  return `gs://archive/${REQUEST_ID}/${kind}`;
}

/** A checkpoint whose given artifacts the GCS service already persisted. */
function persistedCheckpoint(kinds: ArtifactMeta['kind'][]): WorkflowCheckpoint {
  const checkpoint = makeCheckpoint();
  markArtifactsPersisted(
    checkpoint,
    kinds.map((kind) => ({ kind, gcsPath: gcsPathOf(kind) }))
  );
  return checkpoint;
}

/**
 * Seeds a replay cache with the four persist steps of a run that used the
 * earlier, clock-based step names, with the values that run returned.
 */
function seedOldHistory(
  cache: Map<string, unknown>,
  stepName: string,
  artifacts: ArtifactMeta[],
  ms = 1762596000000
): string[] {
  const manifestKey = `${MANIFEST_PREFIX}${stepName}-${ms}.json`;
  const token = `${stepName}-${ms}_json`;
  const entries: Array<[string, unknown]> = [
    [`write-manifest-${stepName}-${ms}.json`, manifestKey],
    [`log-persist-start-${token}`, undefined],
    [
      `persist-gcs-${token}`,
      {
        success: true,
        firestore_doc_id: 'doc-old',
        uploaded: artifacts.length,
        artifacts: artifacts.map((a) => ({ kind: a.kind, gcs_path: gcsPathOf(a.kind) })),
      },
    ],
    [`log-persist-complete-${token}`, undefined],
  ];
  for (const [name, value] of entries) cache.set(`${name}#1`, value);
  return entries.map(([name]) => name);
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

describe('persist after a deploy that renamed the persist steps', () => {
  const OPTIONS_KEY = getOptionsKey(REQUEST_ID);

  type PersistReason = 'step_succeeded' | 'resume_persist_only' | 'final_reconcile';

  function persistWith(
    env: Env,
    step: WorkflowStep,
    checkpoint: WorkflowCheckpoint,
    stepName: CheckpointStep | 'final',
    artifacts: ArtifactMeta[],
    reason: PersistReason,
    persistedBefore: PersistedArtifacts
  ) {
    return persistArtifactsIncremental(
      env,
      step,
      checkpoint,
      REQUEST_ID,
      URL,
      stepName,
      artifacts,
      reason,
      persistedBefore
    );
  }

  /**
   * Replays the persist sequence of one run, as the run does after its
   * checkpoint is loaded: snapshot, render, singlefile, then the final
   * reconcile of whatever is still unpersisted.
   */
  async function replayRun(env: Env, cache: Map<string, unknown>) {
    const run = makeReplayStep(cache);
    const persistedBefore = await snapshotPersistedArtifacts(env, run.step, REQUEST_ID, OPTIONS_KEY);
    // The cached load-init result: the state before any persist of the run.
    const checkpoint = makeCheckpoint();
    for (const stepName of ['render', 'singlefile'] as const) {
      const pending = getUnpersistedArtifacts(checkpoint, [stepName]);
      if (pending.length > 0) {
        await persistWith(env, run.step, checkpoint, stepName, pending, 'step_succeeded', persistedBefore);
      }
    }
    const remaining = getUnpersistedArtifacts(checkpoint);
    if (remaining.length > 0) {
      await persistWith(env, run.step, checkpoint, 'final', remaining, 'final_reconcile', persistedBefore);
    }
    return { run, checkpoint };
  }

  function checkpointPuts(bucket: ReturnType<typeof makeBucket>): number {
    return bucket.bucket.put.mock.calls.filter(([key]) => key === getCheckpointKey(REQUEST_ID)).length;
  }

  function manifestArtifactKinds(bucket: ReturnType<typeof makeBucket>, manifestKey: string): string[] {
    const manifest = JSON.parse(bucket.objects.get(manifestKey) ?? '{"artifacts":[]}') as ArchiveManifest;
    return manifest.artifacts.map((a) => a.kind);
  }

  it('keeps the names and the single upload of a new instance when nothing was persisted before', async () => {
    const plainBucket = makeBucket();
    const plain = makeEnv(plainBucket);
    const plainRun = makeReplayStep();
    await persistRender(plain.env, plainRun.step, makeCheckpoint());

    const bucket = makeBucket();
    const withSnapshot = makeEnv(bucket);
    const run = makeReplayStep();
    await persistWith(
      withSnapshot.env,
      run.step,
      makeCheckpoint(),
      'render',
      renderArtifacts,
      'step_succeeded',
      {}
    );

    expect(run.names).toEqual(plainRun.names);
    expect(run.names).toHaveLength(4);
    expect(withSnapshot.gcsFetch).toHaveBeenCalledTimes(1);
  });

  it('does not upload artifacts again that an earlier run already persisted under the old step names', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cache = new Map<string, unknown>();
    seedOldHistory(cache, 'render', renderArtifacts);
    const bucket = makeBucket(persistedCheckpoint(['rendered.html', 'screenshot.png']));
    const { env, gcsFetch } = makeEnv(bucket);
    const run = makeReplayStep(cache);

    const persistedBefore = await snapshotPersistedArtifacts(env, run.step, REQUEST_ID, OPTIONS_KEY);
    const checkpoint = makeCheckpoint();
    const result = await persistWith(
      env,
      run.step,
      checkpoint,
      'render',
      renderArtifacts,
      'step_succeeded',
      persistedBefore
    );

    expect(result).toBeUndefined();
    expect(gcsFetch).not.toHaveBeenCalled();
    expect(run.names).toEqual(['checkpoint-persisted-snapshot']);
    expect(logSpy).toHaveBeenCalledWith(
      '[workflow] artifacts already persisted by an earlier run; not uploaded again',
      expect.objectContaining({ checkpointStep: 'render', kinds: ['rendered.html', 'screenshot.png'], remaining: 0 })
    );
    expect(manifestKeys(bucket.objects)).toEqual([]);
    expect(checkpoint.artifacts['rendered.html']).toMatchObject({
      persisted: true,
      gcsPath: gcsPathOf('rendered.html'),
    });
    expect(checkpoint.artifacts['screenshot.png']).toMatchObject({
      persisted: true,
      gcsPath: gcsPathOf('screenshot.png'),
    });
    expect(checkpoint.artifacts['singlefile.html']?.persisted).toBe(false);
    expect(checkpointPuts(bucket)).toBe(1);
  });

  it('uploads an artifact again when its content differs from the one recorded as persisted', async () => {
    const stored = persistedCheckpoint(['rendered.html', 'screenshot.png']);
    const storedHtml = stored.artifacts['rendered.html'];
    if (storedHtml) storedHtml.sha256 = 'sha-earlier-content';
    const bucket = makeBucket(stored);
    const { env, gcsFetch, gcsBodies } = makeEnv(bucket);
    const run = makeReplayStep();

    const persistedBefore = await snapshotPersistedArtifacts(env, run.step, REQUEST_ID, OPTIONS_KEY);
    await persistWith(env, run.step, makeCheckpoint(), 'render', renderArtifacts, 'step_succeeded', persistedBefore);

    expect(gcsFetch).toHaveBeenCalledTimes(1);
    expect(manifestArtifactKinds(bucket, gcsBodies[0]?.manifest_key ?? '')).toEqual(['rendered.html']);
  });

  it('uploads only the artifacts the stored checkpoint does not record as persisted', async () => {
    const cache = new Map<string, unknown>();
    seedOldHistory(cache, 'render', [renderedHtml]);
    const bucket = makeBucket(persistedCheckpoint(['rendered.html']));
    const { env, gcsFetch, gcsBodies, loggerBodies } = makeEnv(bucket);
    const run = makeReplayStep(cache);

    const persistedBefore = await snapshotPersistedArtifacts(env, run.step, REQUEST_ID, OPTIONS_KEY);
    const checkpoint = makeCheckpoint();
    await persistWith(env, run.step, checkpoint, 'render', renderArtifacts, 'step_succeeded', persistedBefore);

    expect(gcsFetch).toHaveBeenCalledTimes(1);
    expect(manifestArtifactKinds(bucket, gcsBodies[0]?.manifest_key ?? '')).toEqual(['screenshot.png']);
    expect(loggerBodies.find((body) => body.includes('"persist.started"'))).toContain(
      '"alreadyPersisted":["rendered.html"]'
    );
    expect(checkpoint.artifacts['rendered.html']?.persisted).toBe(true);
    expect(checkpoint.artifacts['screenshot.png']?.persisted).toBe(true);
  });

  it('completes an in-flight run with every artifact persisted and no repeated persist events', async () => {
    const cache = new Map<string, unknown>();
    seedOldHistory(cache, 'render', renderArtifacts);
    const bucket = makeBucket(persistedCheckpoint(['rendered.html', 'screenshot.png']));
    const { env, gcsFetch, gcsBodies, loggerBodies } = makeEnv(bucket);

    const first = await replayRun(env, cache);

    expect(gcsFetch).toHaveBeenCalledTimes(1);
    expect(manifestArtifactKinds(bucket, gcsBodies[0]?.manifest_key ?? '')).toEqual(['singlefile.html']);
    expect(getUnpersistedArtifacts(first.checkpoint)).toEqual([]);
    const persistEvents = loggerBodies.filter((body) => body.includes('"persist.'));
    expect(persistEvents).toHaveLength(2);
    expect(persistEvents.every((body) => body.includes('"checkpointStep":"singlefile"'))).toBe(true);
    expect(loggerBodies.some((body) => body.includes('"checkpointStep":"render"'))).toBe(false);
    expect(first.run.names.filter((name) => name === 'checkpoint-persisted-snapshot')).toHaveLength(1);

    // The instance sleeps again and replays on the same history.
    const second = await replayRun(env, cache);

    expect(second.run.names).toEqual(first.run.names);
    expect(gcsFetch).toHaveBeenCalledTimes(1);
    expect(getUnpersistedArtifacts(second.checkpoint)).toEqual([]);
  });

  it('uploads once more and still completes when the earlier run never saved its persisted flags', async () => {
    const cache = new Map<string, unknown>();
    seedOldHistory(cache, 'render', renderArtifacts);
    const bucket = makeBucket(makeCheckpoint());
    const { env, gcsFetch, gcsBodies } = makeEnv(bucket);

    const { checkpoint } = await replayRun(env, cache);

    expect(gcsFetch).toHaveBeenCalledTimes(2);
    const uploaded = gcsBodies.map((body) => manifestArtifactKinds(bucket, body.manifest_key));
    expect(uploaded).toEqual([['rendered.html', 'screenshot.png'], ['singlefile.html']]);
    expect(getUnpersistedArtifacts(checkpoint)).toEqual([]);
  });
});
