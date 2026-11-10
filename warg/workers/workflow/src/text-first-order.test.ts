/**
 * The text archives (Readability, then AI Markdown, and their persists) do not
 * wait for the heavy archives (SingleFile, Monolith), and an archive that was
 * running under the earlier step order still finishes under this one.
 *
 * The fixture `__fixtures__/old-order-replay.json` holds the step histories and
 * bucket contents of archives stopped mid-run under the earlier order, captured
 * once from the code at its `baseCommit`. Never regenerate it: a capture from
 * the current code would test the current order against itself.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ArchiveManifest } from '@warg/shared';
import {
  derivativeAnswer,
  eventsOfType,
  holdResponse,
  makeEvent,
  makeFakeBucket,
  makeFakeEnv,
  makeFakeStep,
  resultOf,
  runArchiveWorkflow,
  seedOptions,
  type FakeBucket,
  type FakeEnv,
} from './test-support/workflow-harness.js';

const REQUEST_ID = 'req-old-order-0001';
const ARTICLE_URL = 'https://example.com/article';

/** Every kind the default request (no PDF, no screenshot) stores on its success path. */
const SUCCESS_KINDS = [
  'ai-markdown.md',
  'monolith.html',
  'readability.json',
  'readability.md',
  'rendered.html',
  'rendered.md',
  'singlefile.html',
];

type CountedService = 'RENDERER' | 'SINGLEFILE' | 'READABILITY' | 'MONOLITH' | 'AI';

/** The step whose cached result means the service call of that step completed. */
const SERVICE_STEP: Record<CountedService, string> = {
  RENDERER: 'render#1',
  SINGLEFILE: 'singlefile#1',
  READABILITY: 'readability#1',
  MONOLITH: 'monolith-attempt-1#1',
  AI: 'ai-markdown#1',
};

interface OldOrderCut {
  cut: string;
  baseCommit: string;
  cache: Array<[string, unknown]>;
  bucket: Array<[string, string]>;
  gcsKinds: string[];
  serviceCalls: Record<CountedService, number>;
}

// The fixture file is test data written by the capture; its shape is the interface above.
const CUTS = JSON.parse(
  readFileSync(new URL('./__fixtures__/old-order-replay.json', import.meta.url), 'utf8')
) as OldOrderCut[];

/** The checkpoint step each GCS persist call named in its step manifest key. */
function persistedSteps(fake: FakeEnv): string[] {
  return fake.calls.GCS.map((body) => {
    const file = String(body.manifest_key).split('/').pop() ?? '';
    return file.replace(/-[0-9a-f]{16}\.json$/, '');
  });
}

/** The kinds each GCS persist call of this run uploaded, read from the manifests it named. */
function uploadedKinds(fake: FakeEnv): string[] {
  return fake.calls.GCS.flatMap((body) => {
    const stored = fake.bucket.objects.get(String(body.manifest_key));
    if (stored === undefined) throw new Error(`no manifest at ${String(body.manifest_key)}`);
    return (JSON.parse(stored) as ArchiveManifest).artifacts.map((artifact) => artifact.kind);
  });
}

function serviceCalls(fake: FakeEnv): Record<CountedService, number> {
  return {
    RENDERER: fake.calls.RENDERER.length,
    SINGLEFILE: fake.calls.SINGLEFILE.length,
    READABILITY: fake.calls.READABILITY.length,
    MONOLITH: fake.calls.MONOLITH.length,
    AI: fake.aiCalls.length,
  };
}

function bucketOf(entries: Array<[string, string]>): FakeBucket {
  const bucket = makeFakeBucket();
  for (const [key, body] of entries) bucket.objects.set(key, body);
  return bucket;
}

describe('text archives first', () => {
  it('stores Readability and AI Markdown while SingleFile and Monolith hang', async () => {
    const singlefile = holdResponse(derivativeAnswer('singlefile.html'));
    const monolith = holdResponse(derivativeAnswer('monolith.html'));
    const fake = makeFakeEnv({ handlers: { SINGLEFILE: singlefile.handler, MONOLITH: monolith.handler } });
    await seedOptions(fake.bucket, REQUEST_ID, { url: ARTICLE_URL });

    const running = runArchiveWorkflow(fake.env, makeEvent(REQUEST_ID, ARTICLE_URL), makeFakeStep().step);
    try {
      await vi.waitFor(
        () => {
          expect(persistedSteps(fake)).toEqual(expect.arrayContaining(['readability', 'ai-markdown']));
        },
        { timeout: 2000, interval: 10 }
      );
      expect(singlefile.answered()).toBe(0);
      expect(monolith.answered()).toBe(0);
      expect(fake.bucket.objects.has(`archives/${REQUEST_ID}/derived/readability.md`)).toBe(true);
      expect(fake.bucket.objects.has(`archives/${REQUEST_ID}/derived/ai-markdown.md`)).toBe(true);
    } finally {
      singlefile.release();
      monolith.release();
    }

    expect(resultOf(await running)).toMatchObject({ status: 'done', degraded: false });
  });
});

describe('an archive stopped under the earlier step order', () => {
  it('has a capture for each cut', () => {
    expect(CUTS.map((cut) => cut.cut)).toEqual(['singlefile', 'monolith-attempt-1', 'log-ai-markdown-start']);
  });

  it.each(CUTS)('finishes from the cut before $cut with no lost or repeated artifact', async (cut) => {
    const fake = makeFakeEnv({ bucket: bucketOf(cut.bucket) });
    const run = makeFakeStep(new Map(cut.cache));

    const outcome = await runArchiveWorkflow(fake.env, makeEvent(REQUEST_ID, ARTICLE_URL), run.step);

    const result = resultOf(outcome);
    expect(result).toMatchObject({ status: 'done', degraded: false });

    // No lost artifact: the final manifest lists every kind of the success path.
    const finalManifest = fake.bucket.objects.get(result.manifestKey);
    expect(finalManifest).toBeDefined();
    const finalKinds = (JSON.parse(finalManifest ?? '{}') as ArchiveManifest).artifacts.map((a) => a.kind);
    expect(finalKinds.sort()).toEqual(SUCCESS_KINDS);

    // No repeated upload: each kind goes to GCS once across both lifetimes of the instance.
    expect([...cut.gcsKinds, ...uploadedKinds(fake)].sort()).toEqual(SUCCESS_KINDS);

    // No repeated step: a service whose step finished before the stop is not
    // called again; every other one is called once. A call that was still in
    // flight at the stop recorded no result, so it runs again.
    const calls = serviceCalls(fake);
    for (const service of Object.keys(SERVICE_STEP) as CountedService[]) {
      const finished = cut.cache.some(([key]) => key === SERVICE_STEP[service]);
      expect(calls[service], service).toBe(finished ? 0 : 1);
    }

    expect(run.names.filter((name) => name === 'log-completed')).toHaveLength(1);
    expect(eventsOfType(fake.logger, 'request.done')).toHaveLength(1);
  });
});
