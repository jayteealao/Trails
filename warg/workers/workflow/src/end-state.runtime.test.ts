import { applyD1Migrations, introspectWorkflowInstance } from 'cloudflare:test';
import type { WorkflowInstanceIntrospector, WorkflowInstanceModifier } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { getR2Key } from '@warg/shared';
import type { ArchiveOptions, ArtifactKind, ArtifactMeta } from '@warg/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const URL_UNDER_TEST = 'https://example.com/article';

// The target URLs that the stubs of vitest.runtime.config.ts answer with a blocked or a recorded page.
const CHALLENGE_URL = 'https://challenge.example/article';
const BLOCKED_URL = 'https://blocked.example/article';
const ARTICLE_URL = 'https://article.example/post';

// The target URL that the stubs of vitest.runtime.config.ts answer with a refused R2 handler request.
const R2_REFUSED_URL = 'https://r2-refused.example/article';

// The target URL whose first PDF load the browser stand-in of vitest.runtime.config.ts rate-limits.
const RETRY_URL = 'https://retry.example/article';

interface RequestStatus {
  derived: {
    stage: string;
    terminal: boolean;
    diagnostics?: { degradedSteps?: string[]; errorCode?: string };
  };
  events: Array<{ type: string; data?: Record<string, unknown> }>;
}

type RunOptions = Omit<ArchiveOptions, 'url'>;

let nextRequest = 0;

function newRequestId(): string {
  nextRequest += 1;
  return `end-state-${nextRequest}-${crypto.randomUUID()}`;
}

function loggerFetch(path: string, init?: RequestInit): Promise<Response> {
  return env.LOGGER.fetch(`https://logger${path}`, {
    ...init,
    headers: { 'X-Internal-API-Key': env.INTERNAL_API_KEY, 'Content-Type': 'application/json' }
  });
}

/** Stores the options and registers the request, as the gateway does before a run. */
async function seedRequest(requestId: string, options: RunOptions, url: string): Promise<string> {
  const optionsKey = `archives/${requestId}/options.json`;
  await env.ARCHIVE_BUCKET.put(optionsKey, JSON.stringify({ url, ...options }));
  const response = await loggerFetch('/request/init', {
    method: 'POST',
    body: JSON.stringify({ requestId, url })
  });
  expect(response.status).toBe(201);
  return optionsKey;
}

function seedLeftover(requestId: string, kind: ArtifactKind): Promise<unknown> {
  return env.ARCHIVE_BUCKET.put(getR2Key(requestId, kind), `leftover ${kind}`);
}

function artifactMeta(requestId: string, kind: ArtifactKind): ArtifactMeta {
  return {
    kind,
    r2Key: getR2Key(requestId, kind),
    bytes: 16,
    sha256: `sha-${kind}`,
    contentType: 'text/html'
  };
}

async function readStatus(requestId: string): Promise<RequestStatus> {
  const response = await loggerFetch(`/request/${requestId}`);
  expect(response.status).toBe(200);
  return (await response.json()) as RequestStatus;
}

/** Starts a real run. Services fail unless `mock` gives a step its result. */
async function startRun(
  requestId: string,
  options: RunOptions,
  mock?: (m: WorkflowInstanceModifier) => Promise<void>,
  url: string = URL_UNDER_TEST
): Promise<WorkflowInstanceIntrospector> {
  const optionsKey = await seedRequest(requestId, options, url);
  const instance = await introspectWorkflowInstance(env.ARCHIVE_WORKFLOW, requestId);
  await instance.modify(async (m) => {
    await m.disableSleeps();
    await m.disableRetryDelays();
    await mock?.(m);
  });
  await env.ARCHIVE_WORKFLOW.create({
    id: requestId,
    params: { request_id: requestId, url, options_r2_key: optionsKey }
  });
  return instance;
}

/**
 * Grants the quota lease of a step at once. Several runs in a row would
 * otherwise spend the launch-rate burst of the quota, and with sleeps
 * disabled the last run would give up on its lease instead of waiting.
 */
async function grantLease(m: WorkflowInstanceModifier, kind: 'render' | 'singlefile' | 'monolith') {
  await m.mockStepResult({ name: `acquire-${kind}-quota-attempt-1` }, { granted: true, leaseId: `test-lease-${kind}` });
}

function failedStepCodes(status: RequestStatus, step: string): unknown[] {
  return status.events
    .filter((event) => event.type === 'step.failed' && event.data?.step === step)
    .map((event) => event.data?.errorCode);
}

/** Waits for the run to finish, so a run that ends the wrong way fails on its status. */
async function waitForEnd(requestId: string): Promise<string> {
  const instance = await env.ARCHIVE_WORKFLOW.get(requestId);
  await vi.waitFor(
    async () => {
      expect(['complete', 'errored', 'terminated']).toContain((await instance.status()).status);
    },
    { timeout: 20_000, interval: 50 }
  );
  return (await instance.status()).status;
}

describe('end state of an archive run', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.INDEX_DB, env.TEST_MIGRATIONS);
  });

  it('marks the request incomplete when one requested step degrades', async () => {
    const id = newRequestId();
    await using instance = await startRun(id, { steps: ['singlefile', 'readability'] }, async (m) => {
      await m.mockStepResult({ name: 'singlefile' }, { artifact: artifactMeta(id, 'singlefile.html') });
    });
    await instance.waitForStatus('complete');

    const status = await readStatus(id);
    expect(status.derived.stage).toBe('incomplete');
    expect(status.derived.terminal).toBe(true);
    expect(status.derived.diagnostics?.degradedSteps).toEqual(['readability']);
    const started = status.events.find((event) => event.type === 'workflow.started');
    expect(started?.data?.requestedSteps).toEqual(['singlefile', 'readability']);
  });

  async function expectNoOutputsFailure(requestId: string, instance: WorkflowInstanceIntrospector) {
    expect(await waitForEnd(requestId)).toBe('errored');

    const error = await instance.getError();
    expect(error.message).toContain('No requested outputs were produced');

    const status = await readStatus(requestId);
    expect(status.derived.stage).toBe('failed');
    expect(status.derived.diagnostics?.errorCode).toBe('NO_OUTPUTS_PRODUCED');
  }

  it('fails the run when the only requested step fails beside a leftover singlefile', async () => {
    const id = newRequestId();
    await seedLeftover(id, 'singlefile.html');

    await using instance = await startRun(id, { steps: ['monolith'] });

    await expectNoOutputsFailure(id, instance);
  });

  it('fails the run when the only requested step fails beside leftover render and readability', async () => {
    const id = newRequestId();
    await seedLeftover(id, 'rendered.html');
    await seedLeftover(id, 'readability.json');

    await using instance = await startRun(id, { steps: ['monolith'] });

    await expectNoOutputsFailure(id, instance);
  });

  it('fails the run when every default step fails beside a leftover rendered page', async () => {
    const id = newRequestId();
    await seedLeftover(id, 'rendered.html');

    await using instance = await startRun(id, {});

    await expectNoOutputsFailure(id, instance);
  });

  it('marks the request done when every requested step succeeds', async () => {
    const id = newRequestId();

    await using _instance = await startRun(id, {}, async (m) => {
      await m.mockStepResult(
        { name: 'render' },
        {
          result: {
            uses_browser_rendering: true,
            quota_kind_used: 'rest_request',
            artifacts: [artifactMeta(id, 'rendered.html'), artifactMeta(id, 'rendered.md')]
          },
          fallbackUsed: false
        }
      );
      await m.mockStepResult({ name: 'singlefile' }, { artifact: artifactMeta(id, 'singlefile.html') });
      await m.mockStepResult(
        { name: 'readability' },
        { json: artifactMeta(id, 'readability.json'), md: artifactMeta(id, 'readability.md') }
      );
      await m.mockStepResult({ name: 'monolith-attempt-1' }, { artifact: artifactMeta(id, 'monolith.html') });
    });

    expect(await waitForEnd(id)).toBe('complete');

    const status = await readStatus(id);
    expect(status.derived.stage).toBe('done');
    expect(status.derived.terminal).toBe(true);
    expect(status.derived.diagnostics?.degradedSteps ?? []).toEqual([]);
  });

  it('persists the Readability archive before SingleFile starts', async () => {
    const id = newRequestId();

    await using _instance = await startRun(id, {}, async (m) => {
      await m.mockStepResult(
        { name: 'render' },
        {
          result: {
            uses_browser_rendering: true,
            quota_kind_used: 'rest_request',
            artifacts: [artifactMeta(id, 'rendered.html'), artifactMeta(id, 'rendered.md')]
          },
          fallbackUsed: false
        }
      );
      await m.mockStepResult({ name: 'singlefile' }, { artifact: artifactMeta(id, 'singlefile.html') });
      await m.mockStepResult(
        { name: 'readability' },
        { json: artifactMeta(id, 'readability.json'), md: artifactMeta(id, 'readability.md') }
      );
      await m.mockStepResult({ name: 'ai-markdown' }, artifactMeta(id, 'ai-markdown.md'));
      await m.mockStepResult({ name: 'monolith-attempt-1' }, { artifact: artifactMeta(id, 'monolith.html') });
    });

    expect(await waitForEnd(id)).toBe('complete');

    const { events } = await readStatus(id);
    const readabilityPersisted = events.findIndex(
      (event) => event.type === 'persist.completed' && event.data?.checkpointStep === 'readability'
    );
    const singlefileStarted = events.findIndex(
      (event) => event.type === 'step.started' && event.data?.step === 'singlefile'
    );
    const singlefileCompleted = events.findIndex(
      (event) => event.type === 'step.completed' && event.data?.step === 'singlefile'
    );
    expect(readabilityPersisted).toBeGreaterThanOrEqual(0);
    expect(singlefileStarted).toBeGreaterThanOrEqual(0);
    expect(singlefileCompleted).toBeGreaterThanOrEqual(0);
    expect(readabilityPersisted).toBeLessThan(singlefileStarted);
    expect(readabilityPersisted).toBeLessThan(singlefileCompleted);
  });

  it('marks the request incomplete when a resumed render is the only step that succeeds', async () => {
    const id = newRequestId();
    await seedLeftover(id, 'rendered.html');
    await seedLeftover(id, 'rendered.md');

    await using _instance = await startRun(id, {});

    expect(await waitForEnd(id)).toBe('complete');

    const status = await readStatus(id);
    expect(status.derived.stage).toBe('incomplete');
    expect(status.derived.terminal).toBe(true);
    expect([...(status.derived.diagnostics?.degradedSteps ?? [])].sort()).toEqual([
      'monolith',
      'readability',
      'singlefile'
    ]);
  });
});

describe('blocked pages', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.INDEX_DB, env.TEST_MIGRATIONS);
  });

  it('records a challenge page served with HTTP 200 as blocked and does not store it', async () => {
    const id = newRequestId();
    await using _instance = await startRun(
      id,
      { steps: ['render', 'singlefile'] },
      async (m) => {
        await grantLease(m, 'render');
        await grantLease(m, 'singlefile');
        await m.mockStepResult({ name: 'singlefile' }, { artifact: artifactMeta(id, 'singlefile.html') });
      },
      CHALLENGE_URL
    );

    expect(await waitForEnd(id)).toBe('complete');

    const status = await readStatus(id);
    expect(status.derived.stage).toBe('incomplete');
    expect(status.derived.diagnostics?.degradedSteps).toEqual(['render']);
    expect(status.derived.diagnostics?.errorCode).toBe('ACCESS_BLOCKED');
    expect(failedStepCodes(status, 'render')).toContain('ACCESS_BLOCKED');
    expect(await env.ARCHIVE_BUCKET.head(getR2Key(id, 'rendered.html'))).toBeNull();
  });

  it('records a 401 or 403 singlefile navigation as blocked and stores no capture', async () => {
    const id = newRequestId();
    await using _instance = await startRun(
      id,
      { steps: ['singlefile', 'render'] },
      async (m) => {
        await grantLease(m, 'render');
        await grantLease(m, 'singlefile');
        await m.mockStepResult(
          { name: 'render' },
          {
            result: {
              uses_browser_rendering: true,
              quota_kind_used: 'rest_request',
              artifacts: [artifactMeta(id, 'rendered.html'), artifactMeta(id, 'rendered.md')]
            },
            fallbackUsed: false
          }
        );
      },
      BLOCKED_URL
    );

    expect(await waitForEnd(id)).toBe('complete');

    const status = await readStatus(id);
    expect(status.derived.stage).toBe('incomplete');
    expect(status.derived.diagnostics?.degradedSteps).toEqual(['singlefile']);
    expect(status.derived.diagnostics?.errorCode).toBe('ACCESS_BLOCKED');
    expect(failedStepCodes(status, 'singlefile')).toContain('ACCESS_BLOCKED');
    expect(await env.ARCHIVE_BUCKET.head(getR2Key(id, 'singlefile.html'))).toBeNull();
  });

  it('stores an article that quotes challenge words as a successful archive', async () => {
    const id = newRequestId();
    await using _instance = await startRun(
      id,
      { steps: ['render'] },
      (m) => grantLease(m, 'render'),
      ARTICLE_URL
    );

    expect(await waitForEnd(id)).toBe('complete');

    const status = await readStatus(id);
    expect(status.derived.stage).toBe('done');
    expect(await env.ARCHIVE_BUCKET.head(getR2Key(id, 'rendered.html'))).not.toBeNull();
  });
});

describe('monolith R2 handler failures', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.INDEX_DB, env.TEST_MIGRATIONS);
  });

  it('records a container request that the R2 handler refuses under its own code', async () => {
    const id = newRequestId();
    await using _instance = await startRun(
      id,
      { steps: ['render', 'monolith'] },
      async (m) => {
        await grantLease(m, 'render');
        await grantLease(m, 'monolith');
      },
      R2_REFUSED_URL
    );

    expect(await waitForEnd(id)).toBe('complete');

    const status = await readStatus(id);
    expect(status.derived.stage).toBe('incomplete');
    expect(status.derived.diagnostics?.degradedSteps).toEqual(['monolith']);
    expect(status.derived.diagnostics?.errorCode).toBe('MONOLITH_R2_HANDLER_FAILED');
    expect(failedStepCodes(status, 'monolith')).toContain('MONOLITH_R2_HANDLER_FAILED');
  });
});

describe('render step retry', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.INDEX_DB, env.TEST_MIGRATIONS);
  });

  /** The actions the browser stand-in recorded for a URL, one entry per call. */
  async function recordedLoads(url: string): Promise<string[]> {
    const prefix = `stand-in-calls/${encodeURIComponent(url)}/`;
    const listed = await env.ARCHIVE_BUCKET.list({ prefix });
    return listed.objects.map((object) => object.key.slice(prefix.length).split('/')[0] ?? '').sort();
  }

  it('completes a retried render with one load of each kind and one copy of each artifact', async () => {
    const id = newRequestId();
    await using _instance = await startRun(
      id,
      { steps: ['render'], includeScreenshot: true, includePdf: true },
      (m) => grantLease(m, 'render'),
      RETRY_URL
    );

    expect(await waitForEnd(id)).toBe('complete');

    const status = await readStatus(id);
    expect(status.derived.stage).toBe('done');

    // The first attempt loads the snapshot and is rate limited on the PDF; the retry loads only the PDF.
    expect(await recordedLoads(RETRY_URL)).toEqual(['pdf', 'pdf', 'snapshot']);

    const stored = await env.ARCHIVE_BUCKET.list({ prefix: `archives/${id}/raw/` });
    expect(stored.objects.map((object) => object.key.split('/').pop()).sort()).toEqual([
      'page.pdf',
      'rendered.html',
      'rendered.md',
      'screenshot.png'
    ]);

    const written = status.events
      .filter((event) => event.type === 'artifact.written')
      .map((event) => event.data?.kind)
      .sort();
    expect(written).toEqual(['page.pdf', 'rendered.html', 'rendered.md', 'screenshot.png']);

    const renderCompleted = status.events.find(
      (event) => event.type === 'step.completed' && event.data?.step === 'render'
    );
    expect(renderCompleted?.data?.meta).toMatchObject({
      reused: ['rendered.html', 'screenshot.png', 'rendered.md']
    });
  });
});

describe('monolith step retry', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.INDEX_DB, env.TEST_MIGRATIONS);
  });

  const RETRYABLE_MONOLITH_FAILURE = 'Service error 503: upstream failure 503';

  async function mockRenderAndLeases(m: WorkflowInstanceModifier, id: string): Promise<void> {
    await m.mockStepResult(
      { name: 'render' },
      {
        result: {
          uses_browser_rendering: true,
          quota_kind_used: 'rest_request',
          artifacts: [artifactMeta(id, 'rendered.html')]
        },
        fallbackUsed: false
      }
    );
    await grantLease(m, 'render');
    await grantLease(m, 'monolith');
  }

  it('completes when the one monolith step succeeds on its retry', async () => {
    const id = newRequestId();
    await using _instance = await startRun(id, { steps: ['render', 'monolith'] }, async (m) => {
      await mockRenderAndLeases(m, id);
      await m.mockStepError({ name: 'monolith-attempt-1' }, new Error(RETRYABLE_MONOLITH_FAILURE), 1);
      await m.mockStepResult({ name: 'monolith-attempt-1' }, { artifact: artifactMeta(id, 'monolith.html') });
    });

    expect(await waitForEnd(id)).toBe('complete');

    const status = await readStatus(id);
    expect(status.derived.stage).toBe('done');
    expect(status.derived.diagnostics?.degradedSteps ?? []).toEqual([]);
  });

  it('degrades monolith when every attempt of the step fails', async () => {
    const id = newRequestId();
    await using _instance = await startRun(id, { steps: ['render', 'monolith'] }, async (m) => {
      await mockRenderAndLeases(m, id);
      await m.mockStepError({ name: 'monolith-attempt-1' }, new Error(RETRYABLE_MONOLITH_FAILURE));
    });

    expect(await waitForEnd(id)).toBe('complete');

    const status = await readStatus(id);
    expect(status.derived.stage).toBe('incomplete');
    expect(status.derived.diagnostics?.degradedSteps).toEqual(['monolith']);
  });
});
