import { describe, expect, it } from 'vitest';
import type { ArchiveManifest, ArchiveOptions } from '@warg/shared';
import {
  accessBlockedResponse,
  deadHostRenderFailure,
  errorOf,
  eventsOfType,
  makeEvent,
  makeFakeEnv,
  makeFakeStep,
  resultOf,
  runArchiveWorkflow,
  seedOptions,
  serviceError,
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

  describe('option-driven skips', () => {
    it('runs only singlefile when it is the only requested step', async () => {
      const { fake, run, outcome } = await runRequest({ steps: ['singlefile'] });

      expect(resultOf(outcome).status).toBe('done');
      expect(fake.calls.SINGLEFILE).toHaveLength(1);
      expect(fake.calls.RENDERER).toHaveLength(0);
      expect(fake.calls.READABILITY).toHaveLength(0);
      expect(fake.calls.MONOLITH).toHaveLength(0);
      expect(countOf(run.names, 'check-existing-render')).toBe(1);
    });

    it('persists nothing to GCS on a dry run', async () => {
      const { fake, run, outcome } = await runRequest({ dryRun: true });

      expect(resultOf(outcome)).toMatchObject({ status: 'done', dryRun: true });
      expect(fake.calls.GCS).toHaveLength(0);
      expect(run.names.filter((name) => name.startsWith('persist-gcs-'))).toHaveLength(0);
      expect(countOf(run.names, 'log-done-dryrun')).toBe(1);
      expect(countOf(run.names, 'log-completed')).toBe(0);
    });

    it('adds render when a pdf is requested without it', async () => {
      const { fake, outcome } = await runRequest({ steps: ['singlefile'], includePdf: true });

      expect(resultOf(outcome).status).toBe('done');
      expect(fake.calls.RENDERER).toHaveLength(1);
      expect(fake.calls.RENDERER[0]).toMatchObject({ include_pdf: true });
      expect(fake.calls.SINGLEFILE).toHaveLength(1);
    });
  });

  describe('a render failure that cannot be retried', () => {
    it.each([
      {
        name: 'access blocked',
        handlers: { RENDERER: () => accessBlockedResponse() },
        hyperrendererCalls: 0,
      },
      {
        name: 'dead host whose fallback also fails',
        handlers: {
          RENDERER: () => deadHostRenderFailure(),
          HYPERRENDERER: () => serviceError(500),
        },
        hyperrendererCalls: 1,
      },
    ])('$name: one attempt, request.failed once, lease released', async ({ handlers, hyperrendererCalls }) => {
      const { fake, run, outcome } = await runRequest({ steps: ['render'] }, { handlers });

      expect(errorOf(outcome).name).toBe('WorkflowTerminalError');
      expect(run.attempts.get('render')).toBe(1);
      expect(fake.calls.RENDERER).toHaveLength(1);
      expect(fake.calls.HYPERRENDERER).toHaveLength(hyperrendererCalls);

      const renderFailures = eventsOfType(fake.logger, 'step.failed').filter(
        (event) => event.data.step === 'render'
      );
      expect(renderFailures).toHaveLength(1);
      expect(renderFailures[0]?.data.retryable).toBe(false);

      const requestFailed = eventsOfType(fake.logger, 'request.failed');
      expect(requestFailed).toHaveLength(1);
      expect(requestFailed[0]?.data.errorCode).toBe('NO_OUTPUTS_PRODUCED');
      expect(eventsOfType(fake.logger, 'workflow.failed')).toHaveLength(1);

      expect(countOf(run.names, 'release-render-quota')).toBe(1);
      expect(fake.quota.acquired).toHaveLength(1);
      expect(fake.quota.released).toEqual(fake.quota.acquired);
    });
  });

  it('retries a retryable render failure up to its limit', async () => {
    const { fake, run, outcome } = await runRequest(
      { steps: ['render'] },
      { handlers: { RENDERER: () => serviceError(500) } }
    );

    expect(errorOf(outcome).name).toBe('WorkflowTerminalError');
    // The render step allows 3 retries: 4 attempts in all, against one attempt above.
    expect(run.attempts.get('render')).toBe(4);
    expect(fake.calls.RENDERER).toHaveLength(4);
    expect(eventsOfType(fake.logger, 'request.failed')).toHaveLength(1);
    expect(fake.quota.acquired).toHaveLength(1);
    expect(fake.quota.released).toEqual(fake.quota.acquired);
  });
});
