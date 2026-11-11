import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveManifest, ArchiveOptions, WorkflowCheckpoint } from '@warg/shared';
import { getCheckpointKey, getOptionsKey, getR2Key } from '@warg/shared';
import { createCheckpoint, markArtifactsPersisted, recordArtifacts } from './checkpoint.js';
import {
  accessBlockedResponse,
  deadHostRenderFailure,
  derivativeAnswer,
  echoLinksAsMarkdown,
  errorOf,
  eventsOfType,
  fakeArtifact,
  FIXTURE_READABILITY_MD,
  makeEvent,
  makeFakeBucket,
  makeFakeEnv,
  makeFakeStep,
  monolithInputTooLarge,
  renderArtifactsFor,
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
  'ai-markdown.md',
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
      'ai-markdown',
      'write-manifest-manifest.json',
      'update-manifest-key',
      'log-completed',
    ]) {
      expect(countOf(run.names, name), name).toBe(1);
    }
    // Derivatives read rendered.html, so they come after render; their own order is free.
    expect(run.names.indexOf('render')).toBeLessThan(run.names.indexOf('readability'));
    expect(run.names.indexOf('render')).toBeLessThan(run.names.indexOf('monolith-attempt-1'));
    // AI Markdown reads the stored Readability JSON, so it comes after readability.
    expect(run.names.indexOf('readability')).toBeLessThan(run.names.indexOf('ai-markdown'));
    // The text archives are persisted before SingleFile and Monolith start.
    for (const textStep of ['readability', 'ai-markdown']) {
      const persistIndex = run.names.findIndex((name) => name.startsWith(`persist-gcs-${textStep}-`));
      expect(persistIndex, textStep).toBeGreaterThanOrEqual(0);
      expect(persistIndex, textStep).toBeLessThan(run.names.indexOf('singlefile'));
      expect(persistIndex, textStep).toBeLessThan(run.names.indexOf('monolith-attempt-1'));
    }

    expect(run.names.filter((name) => name.startsWith('persist-gcs-'))).toHaveLength(5);
    expect(persistedSteps(fake).sort()).toEqual(['ai-markdown', 'monolith', 'readability', 'render', 'singlefile']);

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

  it('falls back to the hyperrenderer once for a dead host and keeps going', async () => {
    const { fake, run, outcome } = await runRequest(
      {},
      { handlers: { RENDERER: () => deadHostRenderFailure() } }
    );

    expect(resultOf(outcome).status).toBe('done');
    expect(fake.calls.RENDERER).toHaveLength(1);
    expect(fake.calls.HYPERRENDERER).toHaveLength(1);
    expect(run.attempts.get('render')).toBe(1);

    const renderCompleted = eventsOfType(fake.logger, 'step.completed').filter(
      (event) => event.data.step === 'render'
    );
    expect(renderCompleted).toHaveLength(1);
    expect(renderCompleted[0]?.data).toMatchObject({
      fallbackUsed: true,
      fallbackReason: 'browser_rendering_dead_host',
    });
    // This fallback answer carries no stealth setting, so the event logs none.
    expect(renderCompleted[0]?.data).not.toHaveProperty('fallbackStealth');

    // The derivatives read the rendered.html that the fallback produced.
    expect(fake.calls.READABILITY).toHaveLength(1);
    expect(fake.calls.MONOLITH).toHaveLength(1);
  });

  it('logs the fallback with its provider and stealth setting', async () => {
    const { fake, outcome } = await runRequest(
      {},
      {
        handlers: {
          RENDERER: () => deadHostRenderFailure(),
          HYPERRENDERER: (body) =>
            Response.json({
              uses_browser_rendering: true,
              quota_kind_used: 'rest_request',
              artifacts: renderArtifactsFor(body),
              meta: { skipped: [], provider: 'hyperbrowser', stealth: 'none' },
            }),
        },
      }
    );

    expect(resultOf(outcome).status).toBe('done');
    const renderCompleted = eventsOfType(fake.logger, 'step.completed').filter(
      (event) => event.data.step === 'render'
    );
    expect(renderCompleted).toHaveLength(1);
    expect(renderCompleted[0]?.data).toMatchObject({
      fallbackUsed: true,
      fallbackReason: 'browser_rendering_dead_host',
      fallbackProvider: 'hyperbrowser',
      fallbackStealth: 'none',
    });
  });

  it('logs no fallback fields when the primary renderer answers', async () => {
    const { fake, outcome } = await runRequest({});

    expect(resultOf(outcome).status).toBe('done');
    const renderCompleted = eventsOfType(fake.logger, 'step.completed').filter(
      (event) => event.data.step === 'render'
    );
    expect(renderCompleted).toHaveLength(1);
    expect(renderCompleted[0]?.data).not.toHaveProperty('fallbackUsed');
    expect(renderCompleted[0]?.data).not.toHaveProperty('fallbackStealth');
  });

  it('logs request.failed once when no requested output is produced', async () => {
    const { fake, run, outcome } = await runRequest(
      { steps: ['singlefile'] },
      { handlers: { SINGLEFILE: () => serviceError(500) } }
    );

    expect(errorOf(outcome).name).toBe('WorkflowTerminalError');
    expect(run.attempts.get('singlefile')).toBe(4);

    const requestFailed = eventsOfType(fake.logger, 'request.failed');
    expect(requestFailed).toHaveLength(1);
    expect(requestFailed[0]?.data.errorCode).toBe('NO_OUTPUTS_PRODUCED');
    expect(eventsOfType(fake.logger, 'request.done')).toHaveLength(0);
    expect(countOf(run.names, 'checkpoint-workflow-failure')).toBe(1);
    expect(countOf(run.names, 'log-workflow-failed')).toBe(1);

    const checkpoint = fake.bucket.objects.get(getCheckpointKey(REQUEST_ID));
    expect(checkpoint).toBeDefined();
    expect(JSON.parse(checkpoint ?? '{}')).toMatchObject({ lastFailure: { step: 'workflow' } });
  });

  describe('resume', () => {
    it('replays a restarted instance without persisting render again, under the same step names', async () => {
      const first = await runRequest({});
      const firstResult = resultOf(first.outcome);

      // The engine replays an instance from its step history: keep the results
      // up to the end of the render persist, as if the instance stopped there.
      const restartCache = new Map<string, unknown>();
      for (const [key, value] of first.run.cache) {
        restartCache.set(key, value);
        if (key.startsWith('log-persist-complete-render-')) break;
      }
      expect([...restartCache.keys()].some((key) => key.startsWith('persist-gcs-render-'))).toBe(true);

      const second = await runRequest({}, { bucket: first.fake.bucket }, makeFakeStep(restartCache));

      expect(resultOf(second.outcome).manifestKey).toBe(firstResult.manifestKey);
      expect(second.run.names).toEqual(first.run.names);
      expect(second.fake.calls.RENDERER).toHaveLength(0);
      // Exactly the persists that came after the render persist in the first run run again.
      const renderPersistEnd = first.run.names.findIndex((name) => name.startsWith('log-persist-complete-render-'));
      const laterPersists = first.run.names
        .slice(renderPersistEnd + 1)
        .filter((name) => name.startsWith('persist-gcs-'))
        .map((name) => name.slice('persist-gcs-'.length).replace(/-[0-9a-f]{16}_json$/, ''));
      expect(persistedSteps(second.fake)).not.toContain('render');
      expect(persistedSteps(second.fake).sort()).toEqual(laterPersists.sort());
    });

    it('skips render in a new instance whose stored checkpoint has it persisted', async () => {
      const bucket = makeFakeBucket();
      const renderArtifacts = [
        fakeArtifact(REQUEST_ID, 'rendered.html'),
        fakeArtifact(REQUEST_ID, 'rendered.md'),
      ];
      const stored = createCheckpoint(REQUEST_ID, getOptionsKey(REQUEST_ID), true);
      recordArtifacts(stored, 'render', renderArtifacts);
      markArtifactsPersisted(
        stored,
        renderArtifacts.map((artifact) => ({ kind: artifact.kind, gcsPath: `gs://archive/${artifact.kind}` }))
      );
      await bucket.put(getCheckpointKey(REQUEST_ID), JSON.stringify(stored));

      const { fake, run, outcome } = await runRequest({}, { bucket });

      const result = resultOf(outcome);
      expect(fake.calls.RENDERER).toHaveLength(0);
      expect(run.names).not.toContain('render');
      expect(run.names.filter((name) => name.startsWith('write-manifest-render-'))).toHaveLength(0);
      expect(persistedSteps(fake).sort()).toEqual(['ai-markdown', 'monolith', 'readability', 'singlefile']);
      expect(fake.calls.SINGLEFILE).toHaveLength(1);
      expect(fake.calls.READABILITY).toHaveLength(1);
      expect(fake.calls.MONOLITH).toHaveLength(1);

      const kinds = storedManifest(fake.bucket, result.manifestKey).artifacts.map((artifact) => artifact.kind);
      expect(kinds).toEqual(expect.arrayContaining(['rendered.html', 'rendered.md']));
    });
  });

  it.each([
    { name: 'success', options: {}, handlers: {}, leases: 3 },
    {
      name: 'render that cannot be retried',
      options: { steps: ['render' as const] },
      handlers: { RENDERER: () => accessBlockedResponse() },
      leases: 1,
    },
    {
      name: 'singlefile failure',
      options: {},
      handlers: { SINGLEFILE: () => serviceError(500) },
      leases: 3,
    },
    {
      name: 'monolith failure',
      options: {},
      handlers: { MONOLITH: () => monolithInputTooLarge() },
      leases: 3,
    },
  ])('releases every quota lease exactly once: $name', async ({ options, handlers, leases }) => {
    const { fake } = await runRequest(options, { handlers });

    expect(fake.quota.acquired).toHaveLength(leases);
    expect(new Set(fake.quota.released).size).toBe(fake.quota.released.length);
    expect([...fake.quota.released].sort()).toEqual([...fake.quota.acquired].sort());
  });
});

describe('AI Markdown archive', () => {
  const AI_MARKDOWN_KEY = getR2Key(REQUEST_ID, 'ai-markdown.md');

  function storedCheckpoint(bucket: FakeBucket): WorkflowCheckpoint {
    const body = bucket.objects.get(getCheckpointKey(REQUEST_ID));
    if (body === undefined) throw new Error('no checkpoint stored');
    return JSON.parse(body) as WorkflowCheckpoint;
  }

  it('stores AI Markdown as a separate artifact and leaves readability.md as Readability wrote it', async () => {
    const { fake, outcome } = await runRequest({});

    expect(resultOf(outcome)).toMatchObject({ status: 'done', degraded: false });
    expect(fake.aiCalls).toHaveLength(1);
    expect(fake.bucket.objects.get(AI_MARKDOWN_KEY)).toBe(
      echoLinksAsMarkdown(fake.aiCalls[0]?.html ?? '').data
    );

    expect(fake.bucket.objects.get(getR2Key(REQUEST_ID, 'readability.md'))).toBe(FIXTURE_READABILITY_MD);
    const checkpoint = storedCheckpoint(fake.bucket);
    expect(checkpoint.artifacts['readability.md']).toMatchObject({
      ...fakeArtifact(REQUEST_ID, 'readability.md'),
      producedBy: 'readability',
    });
    expect(checkpoint.artifacts['ai-markdown.md']).toMatchObject({
      kind: 'ai-markdown.md',
      r2Key: AI_MARKDOWN_KEY,
      contentType: 'text/markdown',
      producedBy: 'ai-markdown',
      persisted: true,
    });
    expect(checkpoint.steps['ai-markdown'].status).toBe('succeeded');
  });

  it('resolves the relative link and image of the cleaned HTML against the article URL', async () => {
    const { fake } = await runRequest({});

    const stored = fake.bucket.objects.get(AI_MARKDOWN_KEY) ?? '';
    expect(stored).toContain('[link](https://example.com/next)');
    expect(stored).toContain('![image](https://example.com/img/a.png)');
    expect(fake.aiCalls[0]).toMatchObject({
      type: 'text/html',
      options: { conversionOptions: { html: { hostname: URL } } },
    });
    expect(fake.aiCalls[0]?.html).not.toContain('href="../next"');
  });

  it('records a failed conversion for its step only and completes the request', async () => {
    const { fake, run, outcome } = await runRequest(
      {},
      {
        ai: () => {
          throw new Error('Workers AI unavailable');
        },
      }
    );

    const result = resultOf(outcome);
    expect(result).toMatchObject({ status: 'done', degraded: false });
    expect(result.partialFailures).toEqual([]);

    const checkpoint = storedCheckpoint(fake.bucket);
    expect(checkpoint.steps['ai-markdown']).toMatchObject({ status: 'failed', error: 'Workers AI unavailable' });
    expect(checkpoint.artifacts['ai-markdown.md']).toBeUndefined();
    expect(fake.bucket.objects.has(AI_MARKDOWN_KEY)).toBe(false);

    const failures = eventsOfType(fake.logger, 'step.failed');
    expect(failures.map((event) => event.data.step)).toEqual(['ai-markdown']);

    expect(persistedSteps(fake).sort()).toEqual(['monolith', 'readability', 'render', 'singlefile']);
    const kinds = storedManifest(fake.bucket, result.manifestKey).artifacts.map((artifact) => artifact.kind);
    expect(kinds).not.toContain('ai-markdown.md');
    expect(kinds).toEqual(
      expect.arrayContaining(['rendered.html', 'singlefile.html', 'readability.json', 'readability.md', 'monolith.html'])
    );
    expect(countOf(run.names, 'log-completed')).toBe(1);
    expect(fake.logger.settles.map((entry) => entry.body.state)).toEqual(['done']);
  });

  it('skips the conversion on resume when the checkpoint holds a persisted AI Markdown artifact', async () => {
    const bucket = makeFakeBucket();
    const aiMarkdown = fakeArtifact(REQUEST_ID, 'ai-markdown.md');
    const stored = createCheckpoint(REQUEST_ID, getOptionsKey(REQUEST_ID), true);
    recordArtifacts(stored, 'ai-markdown', [aiMarkdown]);
    markArtifactsPersisted(stored, [{ kind: aiMarkdown.kind, gcsPath: `gs://archive/${aiMarkdown.kind}` }]);
    await bucket.put(getCheckpointKey(REQUEST_ID), JSON.stringify(stored));

    const { fake, run, outcome } = await runRequest({}, { bucket });

    expect(resultOf(outcome).status).toBe('done');
    expect(fake.calls.READABILITY).toHaveLength(1);
    expect(fake.aiCalls).toHaveLength(0);
    expect(run.names).not.toContain('ai-markdown');
    expect(persistedSteps(fake)).not.toContain('ai-markdown');
  });

  it('makes no conversion when readability is not requested', async () => {
    const { fake, run, outcome } = await runRequest({ steps: ['singlefile'] });

    expect(resultOf(outcome).status).toBe('done');
    expect(fake.aiCalls).toHaveLength(0);
    expect(run.names).not.toContain('ai-markdown');
  });
});

describe('settle to the logger', () => {
  let consoleError: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(() => {
    consoleError?.mockRestore();
    consoleError = undefined;
  });

  function settlesFor(fake: FakeEnv): Array<Record<string, unknown>> {
    return fake.logger.settles.filter((entry) => entry.requestId === REQUEST_ID).map((entry) => entry.body);
  }

  it('settles a run that finishes done once, after the completion log', async () => {
    const { fake, run, outcome } = await runRequest({});

    expect(resultOf(outcome).status).toBe('done');
    const settles = settlesFor(fake);
    expect(settles).toHaveLength(1);
    expect(settles[0]).toMatchObject({ state: 'done', runId: makeEvent(REQUEST_ID, URL).instanceId });
    expect(Number.isNaN(Date.parse(String(settles[0]?.settledAt)))).toBe(false);
    expect(countOf(run.names, 'settle-logger')).toBe(1);
    expect(run.names.indexOf('settle-logger')).toBeGreaterThan(run.names.indexOf('log-completed'));
  });

  it('settles a dry run as done', async () => {
    const { fake, outcome } = await runRequest({ dryRun: true });

    expect(resultOf(outcome).dryRun).toBe(true);
    expect(settlesFor(fake).map((body) => body.state)).toEqual(['done']);
  });

  it('settles a mock pipeline run as done', async () => {
    const { fake, outcome } = await runRequest({}, { mockPipeline: true });

    expect(resultOf(outcome).mock).toBe(true);
    expect(settlesFor(fake).map((body) => body.state)).toEqual(['done']);
  });

  it('settles a failed run as failed with the error code of the failure log', async () => {
    const { fake, run, outcome } = await runRequest(
      { steps: ['render'] },
      { handlers: { RENDERER: () => accessBlockedResponse() } }
    );

    expect(errorOf(outcome).name).toBe('WorkflowTerminalError');
    const requestFailed = eventsOfType(fake.logger, 'request.failed');
    expect(requestFailed[0]?.data.errorCode).toBe('NO_OUTPUTS_PRODUCED');
    const settles = settlesFor(fake);
    expect(settles).toHaveLength(1);
    expect(settles[0]).toMatchObject({ state: 'failed', errorCode: requestFailed[0]?.data.errorCode });
    expect(run.names.indexOf('settle-logger')).toBeGreaterThan(run.names.indexOf('log-workflow-failed'));
  });

  it('settles a run whose monolith output is missing as incomplete', async () => {
    const { fake, outcome } = await runRequest({}, { handlers: { MONOLITH: () => monolithInputTooLarge() } });

    expect(resultOf(outcome).degraded).toBe(true);
    expect(settlesFor(fake).map((body) => body.state)).toEqual(['incomplete']);
    const monolithFailures = eventsOfType(fake.logger, 'step.failed').filter((event) =>
      String(event.data.step).startsWith('monolith')
    );
    expect(monolithFailures.map((event) => event.data.errorCode)).toContain('MONOLITH_INPUT_TOO_LARGE');
  });

  it('keeps the archive result when the logger rejects the settle, and logs the failure', async () => {
    const baseline = resultOf((await runRequest({})).outcome);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { run, outcome } = await runRequest({}, { settle: () => new Response('boom', { status: 500 }) });

    expect(resultOf(outcome)).toEqual(baseline);
    expect(run.attempts.get('settle-logger')).toBe(3);
    expect(consoleError.mock.calls.some((args: unknown[]) => String(args[0]).includes('settle failed'))).toBe(true);
  });

  it('rethrows the archive failure, not the settle failure, when the settle times out', async () => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { fake, outcome } = await runRequest(
      { steps: ['render'] },
      {
        handlers: { RENDERER: () => accessBlockedResponse() },
        settle: () => {
          throw new DOMException('timed out', 'TimeoutError');
        },
      }
    );

    expect(errorOf(outcome).name).toBe('WorkflowTerminalError');
    expect(eventsOfType(fake.logger, 'request.failed')).toHaveLength(1);
  });
});

describe('monolith step retries', () => {
  const REMOVED_STEPS = ['monolith-attempt-2', 'monolith-backoff-1'];
  // Monolith reads rendered.html, so the narrowest request renders too.
  const MONOLITH_ONLY: Omit<ArchiveOptions, 'url'> = { steps: ['render', 'monolith'] };

  function sandboxLeases(ids: string[]): string[] {
    return ids.filter((id) => id.startsWith('lease-sandbox_exec-'));
  }

  function manifestKinds(fake: FakeEnv, outcome: Run['outcome']): string[] {
    return storedManifest(fake.bucket, resultOf(outcome).manifestKey).artifacts.map((artifact) => artifact.kind);
  }

  it('runs the monolith call as one step with a timeout and a retry policy', async () => {
    const { run } = await runRequest(MONOLITH_ONLY);

    expect(run.configs.get('monolith-attempt-1')).toEqual({
      timeout: '2 minutes',
      retries: { limit: 1, delay: '6 seconds', backoff: 'exponential' },
    });
  });

  it('retries a retryable monolith failure inside the one step and succeeds', async () => {
    let calls = 0;
    const succeed = derivativeAnswer('monolith.html');
    const { fake, run, outcome } = await runRequest(
      MONOLITH_ONLY,
      { handlers: { MONOLITH: (body) => (++calls === 1 ? serviceError(503) : succeed(body)) } }
    );

    expect(fake.calls.MONOLITH).toHaveLength(2);
    expect(run.attempts.get('monolith-attempt-1')).toBe(2);
    expect(countOf(run.names, 'monolith-attempt-1')).toBe(1);
    for (const removed of REMOVED_STEPS) expect(run.names).not.toContain(removed);

    const result = resultOf(outcome);
    expect(result.status).toBe('done');
    expect(result.degraded ?? false).toBe(false);
    expect(manifestKinds(fake, outcome)).toContain('monolith.html');

    expect(sandboxLeases(fake.quota.acquired)).toHaveLength(1);
    expect(sandboxLeases(fake.quota.released)).toEqual(sandboxLeases(fake.quota.acquired));
  });

  it('fails a deterministic monolith failure at once, with no retry', async () => {
    const { fake, run } = await runRequest(
      MONOLITH_ONLY,
      { handlers: { MONOLITH: () => monolithInputTooLarge() } }
    );

    expect(fake.calls.MONOLITH).toHaveLength(1);
    expect(run.attempts.get('monolith-attempt-1')).toBe(1);
    const monolithFailures = eventsOfType(fake.logger, 'step.failed').filter(
      (event) => event.data.step === 'monolith'
    );
    expect(monolithFailures.map((event) => event.data.errorCode)).toContain('MONOLITH_INPUT_TOO_LARGE');
  });

  it('replays a cached monolith result without calling the monolith worker again', async () => {
    const seeded = makeFakeStep(
      new Map([['monolith-attempt-1#1', { artifact: fakeArtifact(REQUEST_ID, 'monolith.html') }]])
    );
    const { fake, run, outcome } = await runRequest(MONOLITH_ONLY, {}, seeded);

    expect(fake.calls.MONOLITH).toHaveLength(0);
    expect(resultOf(outcome).status).toBe('done');
    expect(manifestKinds(fake, outcome)).toContain('monolith.html');
    for (const removed of REMOVED_STEPS) expect(run.names).not.toContain(removed);
  });

  it('replays a cached monolith failure to the same degraded end state', async () => {
    const seeded = makeFakeStep(new Map(), {
      failed: new Map([['monolith-attempt-1#1', new Error('Service error 503: upstream failure 503')]]),
    });
    const { fake, run, outcome } = await runRequest({}, {}, seeded);

    expect(fake.calls.MONOLITH).toHaveLength(0);
    const result = resultOf(outcome);
    expect(result.degraded).toBe(true);
    expect(result.partialFailures?.map((failure) => failure.step)).toEqual(['monolith']);
    for (const removed of REMOVED_STEPS) expect(run.names).not.toContain(removed);
    expect(sandboxLeases(fake.quota.acquired)).toHaveLength(1);
    expect(sandboxLeases(fake.quota.released)).toEqual(sandboxLeases(fake.quota.acquired));
  });
});
