import { describe, expect, it } from 'vitest';
import type { ArchiveManifest, ArchiveOptions } from '@warg/shared';
import {
  eventsOfType,
  makeEvent,
  makeFakeEnv,
  makeFakeStep,
  resultOf,
  runArchiveWorkflow,
  seedOptions,
  type FakeBucket,
  type FakeEnv,
  type FakeEnvOptions,
  type FakeStep,
} from './test-support/workflow-harness.js';

const REQUEST_ID = 'req-exec-0001';
const URL = 'https://example.com/article';

const ALL_KINDS = [
  'monolith.html',
  'page.pdf',
  'readability.json',
  'readability.md',
  'rendered.html',
  'rendered.md',
  'screenshot.png',
  'singlefile.html',
];

interface Run {
  fake: FakeEnv;
  run: FakeStep;
  outcome: Awaited<ReturnType<typeof runArchiveWorkflow>>;
}

/** Seeds the options, then runs one archive request against fresh fakes. */
async function runRequest(
  options: Omit<ArchiveOptions, 'url'>,
  envOptions: FakeEnvOptions = {},
  run: FakeStep = makeFakeStep()
): Promise<Run> {
  const fake = makeFakeEnv(envOptions);
  await seedOptions(fake.bucket, REQUEST_ID, { url: URL, ...options });
  const outcome = await runArchiveWorkflow(fake.env, makeEvent(REQUEST_ID, URL), run.step);
  return { fake, run, outcome };
}

function countOf(names: string[], name: string): number {
  return names.filter((entry) => entry === name).length;
}

/** The checkpoint step each GCS persist call named in its step manifest key. */
function persistedSteps(fake: FakeEnv): string[] {
  return fake.calls.GCS.map((body) => {
    const file = String(body.manifest_key).split('/').pop() ?? '';
    return file.replace(/-[0-9a-f]{16}\.json$/, '');
  });
}

function storedManifest(bucket: FakeBucket, key: string): ArchiveManifest {
  const body = bucket.objects.get(key);
  if (body === undefined) throw new Error(`no manifest at ${key}`);
  return JSON.parse(body) as ArchiveManifest;
}

describe('ArchiveWorkflow.run', () => {
  it('runs every step once and persists every artifact on the success path', async () => {
    const { fake, run, outcome } = await runRequest({ includePdf: true, includeScreenshot: true });

    const result = resultOf(outcome);
    expect(result).toMatchObject({ status: 'done', degraded: false });

    expect(fake.calls.RENDERER).toHaveLength(1);
    expect(fake.calls.SINGLEFILE).toHaveLength(1);
    expect(fake.calls.READABILITY).toHaveLength(1);
    expect(fake.calls.MONOLITH).toHaveLength(1);
    expect(fake.calls.HYPERRENDERER).toHaveLength(0);

    for (const name of [
      'render',
      'singlefile',
      'readability',
      'monolith-attempt-1',
      'write-manifest-manifest.json',
      'update-manifest-key',
      'log-completed',
    ]) {
      expect(countOf(run.names, name), name).toBe(1);
    }
    // Derivatives read rendered.html, so they come after render; their own order is free.
    expect(run.names.indexOf('render')).toBeLessThan(run.names.indexOf('readability'));
    expect(run.names.indexOf('render')).toBeLessThan(run.names.indexOf('monolith-attempt-1'));

    expect(run.names.filter((name) => name.startsWith('persist-gcs-'))).toHaveLength(4);
    expect(persistedSteps(fake).sort()).toEqual(['monolith', 'readability', 'render', 'singlefile']);

    const manifest = storedManifest(fake.bucket, result.manifestKey);
    expect(manifest.artifacts.map((artifact) => artifact.kind).sort()).toEqual(ALL_KINDS);

    expect(eventsOfType(fake.logger, 'request.done')).toHaveLength(1);
    expect(eventsOfType(fake.logger, 'request.failed')).toHaveLength(0);
  });
});
