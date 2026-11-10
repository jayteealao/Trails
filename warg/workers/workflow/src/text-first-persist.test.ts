/**
 * The text archives (Readability JSON and Markdown, AI Markdown) are stored
 * before every other archive; a heavy archive whose upload fails leaves the
 * stored text as it was; and an archive stopped right before its page archives
 * were uploaded still finishes.
 *
 * The fixture `__fixtures__/render-persist-replay.json` holds the step history
 * and bucket contents of an archive stopped before its page archive upload under
 * the earlier persist order, captured once from the code at its `baseCommit`.
 * Never regenerate it: a capture from the current code would test the current
 * order against itself.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveManifest, ArtifactKind, WorkflowCheckpoint } from '@warg/shared';
import { getCheckpointKey } from '@warg/shared';
import {
  errorOf,
  eventsOfType,
  gcsAnswer,
  makeEvent,
  makeFakeBucket,
  makeFakeEnv,
  makeFakeStep,
  resultOf,
  runArchiveWorkflow,
  seedOptions,
  serviceError,
  type FakeBucket,
  type FakeEnv,
  type ServiceHandler,
} from './test-support/workflow-harness.js';

const REQUEST_ID = 'req-render-persist-0001';
const ARTICLE_URL = 'https://example.com/article';

const TEXT_KINDS: ArtifactKind[] = ['readability.json', 'readability.md', 'ai-markdown.md'];
const HEAVY_FAILING_KINDS: ArtifactKind[] = ['singlefile.html', 'monolith.html'];

type CountedService = 'RENDERER' | 'SINGLEFILE' | 'READABILITY' | 'MONOLITH' | 'AI';

interface RenderPersistCut {
  cut: string;
  baseCommit: string;
  cache: Array<[string, unknown]>;
  bucket: Array<[string, string]>;
  gcsKinds: string[];
  serviceCalls: Record<CountedService, number>;
}

// The fixture file is test data written by the capture; its shape is the interface above.
const CUTS = JSON.parse(
  readFileSync(new URL('./__fixtures__/render-persist-replay.json', import.meta.url), 'utf8')
) as RenderPersistCut[];

async function manifestKinds(bucket: FakeBucket, body: Record<string, unknown>): Promise<ArtifactKind[]> {
  const stored = await bucket.get(String(body.manifest_key));
  if (!stored) throw new Error(`no manifest at ${String(body.manifest_key)}`);
  return ((await stored.json()) as ArchiveManifest).artifacts.map((artifact) => artifact.kind);
}

interface SteppedGcs {
  handler: ServiceHandler;
  /** The kinds of each manifest the fake answered with success, in order. */
  succeeded: ArtifactKind[][];
}

/**
 * The default GCS answer behind a clock that moves 1 s per call, so each
 * persist gets its own `persistedAt`; `fails` picks the calls that answer 502.
 */
function steppedGcs(bucket: FakeBucket, fails: (kinds: ArtifactKind[]) => boolean = () => false): SteppedGcs {
  const answer = gcsAnswer(bucket);
  const succeeded: ArtifactKind[][] = [];
  return {
    succeeded,
    handler: async (body) => {
      vi.setSystemTime(new Date(Date.now() + 1000));
      const kinds = await manifestKinds(bucket, body);
      if (fails(kinds)) return serviceError(502);
      succeeded.push(kinds);
      return await answer(body);
    },
  };
}

function storedCheckpoint(fake: FakeEnv): WorkflowCheckpoint {
  const body = fake.bucket.objects.get(getCheckpointKey(REQUEST_ID));
  if (body === undefined) throw new Error('no stored checkpoint');
  return JSON.parse(body) as WorkflowCheckpoint;
}

function persistedAtOf(checkpoint: WorkflowCheckpoint, kind: ArtifactKind): number {
  const persistedAt = checkpoint.artifacts[kind]?.persistedAt;
  if (persistedAt === undefined) throw new Error(`${kind} has no persistedAt`);
  return Date.parse(persistedAt);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('text archives are stored first', () => {
  it('stores every text archive before every other archive', async () => {
    const bucket = makeFakeBucket();
    const gcs = steppedGcs(bucket);
    const fake = makeFakeEnv({ bucket, handlers: { GCS: gcs.handler } });
    await seedOptions(bucket, REQUEST_ID, { url: ARTICLE_URL, includePdf: true, includeScreenshot: true });
    const run = makeFakeStep();

    const outcome = await runArchiveWorkflow(fake.env, makeEvent(REQUEST_ID, ARTICLE_URL), run.step);

    expect(resultOf(outcome)).toMatchObject({ status: 'done', degraded: false });
    const checkpoint = storedCheckpoint(fake);
    const otherKinds: ArtifactKind[] = [
      'rendered.html',
      'rendered.md',
      'screenshot.png',
      'page.pdf',
      'singlefile.html',
      'monolith.html',
    ];
    const latestText = Math.max(...TEXT_KINDS.map((kind) => persistedAtOf(checkpoint, kind)));
    const earliestOther = Math.min(...otherKinds.map((kind) => persistedAtOf(checkpoint, kind)));
    expect(latestText).toBeLessThan(earliestOther);

    const renderPersist = run.names.findIndex((name) => name.startsWith('persist-gcs-render-'));
    const aiMarkdownPersist = run.names.findIndex((name) => name.startsWith('persist-gcs-ai-markdown-'));
    expect(aiMarkdownPersist).toBeGreaterThanOrEqual(0);
    expect(renderPersist).toBeGreaterThan(aiMarkdownPersist);
    expect(renderPersist).toBeLessThan(run.names.indexOf('singlefile'));
  });
});

describe('a heavy archive whose upload fails', () => {
  it('keeps the text archives stored and names only the heavy archives as not stored', async () => {
    const bucket = makeFakeBucket();
    const gcs = steppedGcs(bucket, (kinds) => kinds.some((kind) => HEAVY_FAILING_KINDS.includes(kind)));
    const fake = makeFakeEnv({ bucket, handlers: { GCS: gcs.handler } });
    await seedOptions(bucket, REQUEST_ID, { url: ARTICLE_URL });

    const outcome = await runArchiveWorkflow(
      fake.env,
      makeEvent(REQUEST_ID, ARTICLE_URL),
      makeFakeStep().step
    );

    expect(errorOf(outcome).message).toContain('Persistence incomplete');
    const requestFailed = eventsOfType(fake.logger, 'request.failed');
    expect(requestFailed).toHaveLength(1);
    const unpersisted = requestFailed[0]?.data.unpersistedKinds;
    expect(Array.isArray(unpersisted) ? [...unpersisted].sort() : unpersisted).toEqual([
      'monolith.html',
      'singlefile.html',
    ]);

    const checkpoint = storedCheckpoint(fake);
    for (const kind of [...TEXT_KINDS, 'rendered.html', 'rendered.md'] as const) {
      expect(checkpoint.artifacts[kind]?.persisted, kind).toBe(true);
      expect(checkpoint.artifacts[kind]?.persistedAt, kind).toBeDefined();
    }
    for (const kind of HEAVY_FAILING_KINDS) {
      expect(checkpoint.artifacts[kind]?.persisted, kind).toBe(false);
    }

    // No text archive is uploaded again by a later persist or the final reconcile.
    for (const kind of TEXT_KINDS) {
      expect(gcs.succeeded.filter((kinds) => kinds.includes(kind)), kind).toHaveLength(1);
    }
  });
});

describe('an archive stopped before its page archives were uploaded', () => {
  it('has one capture', () => {
    expect(CUTS).toHaveLength(1);
    expect(CUTS[0]?.cut).toMatch(/^write-manifest-render-/);
  });

  it.each(CUTS)('finishes with no lost, repeated or re-uploaded archive', async (cut) => {
    const bucket = makeFakeBucket();
    for (const [key, body] of cut.bucket) bucket.objects.set(key, body);
    const fake = makeFakeEnv({ bucket });
    const run = makeFakeStep(new Map(cut.cache));

    const outcome = await runArchiveWorkflow(fake.env, makeEvent(REQUEST_ID, ARTICLE_URL), run.step);

    expect(resultOf(outcome)).toMatchObject({ status: 'done', degraded: false });

    const uploaded: string[] = [];
    for (const body of fake.calls.GCS) uploaded.push(...(await manifestKinds(bucket, body)));
    expect([...cut.gcsKinds, ...uploaded].sort()).toEqual([
      'ai-markdown.md',
      'monolith.html',
      'readability.json',
      'readability.md',
      'rendered.html',
      'rendered.md',
      'singlefile.html',
    ]);

    const calls: Record<CountedService, number> = {
      RENDERER: fake.calls.RENDERER.length,
      SINGLEFILE: fake.calls.SINGLEFILE.length,
      READABILITY: fake.calls.READABILITY.length,
      MONOLITH: fake.calls.MONOLITH.length,
      AI: fake.aiCalls.length,
    };
    for (const service of Object.keys(calls) as CountedService[]) {
      expect(cut.serviceCalls[service] + calls[service], service).toBe(1);
    }
    expect(calls.RENDERER).toBe(0);
    expect(run.names.filter((name) => name === 'log-completed')).toHaveLength(1);
  });
});
