import { applyD1Migrations, introspectWorkflowInstance } from 'cloudflare:test';
import type { WorkflowInstanceIntrospector, WorkflowInstanceModifier } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { getR2Key } from '@warg/shared';
import type { ArtifactKind, ArtifactMeta } from '@warg/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ArchiveOptionsExtended } from './types.js';

const URL_UNDER_TEST = 'https://example.com/article';

interface RequestStatus {
  derived: {
    stage: string;
    terminal: boolean;
    diagnostics?: { degradedSteps?: string[]; errorCode?: string };
  };
}

type RunOptions = Omit<ArchiveOptionsExtended, 'url'>;

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
async function seedRequest(requestId: string, options: RunOptions): Promise<string> {
  const optionsKey = `archives/${requestId}/options.json`;
  await env.ARCHIVE_BUCKET.put(optionsKey, JSON.stringify({ url: URL_UNDER_TEST, ...options }));
  const response = await loggerFetch('/request/init', {
    method: 'POST',
    body: JSON.stringify({ requestId, url: URL_UNDER_TEST })
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
  mock?: (m: WorkflowInstanceModifier) => Promise<void>
): Promise<WorkflowInstanceIntrospector> {
  const optionsKey = await seedRequest(requestId, options);
  const instance = await introspectWorkflowInstance(env.ARCHIVE_WORKFLOW, requestId);
  await instance.modify(async (m) => {
    await m.disableSleeps();
    await m.disableRetryDelays();
    await mock?.(m);
  });
  await env.ARCHIVE_WORKFLOW.create({
    id: requestId,
    params: { request_id: requestId, url: URL_UNDER_TEST, options_r2_key: optionsKey }
  });
  return instance;
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
