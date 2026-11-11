import {
  WorkflowEntrypoint,
  type WorkflowStep,
  type WorkflowEvent
} from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import type {
  ArchiveOptions,
  ArtifactKind,
  ArtifactMeta,
  CheckpointStep,
  ReadabilityResult,
  RequestSettle,
  WorkflowStartedData,
  WorkflowStep as WorkflowStepType,
} from '@warg/shared';
import { WORKFLOW_STEPS, getR2Key, storeArtifact } from '@warg/shared';
import { convertArticleToMarkdown } from './ai-markdown.js';
import { BrowserQuotaDO } from './BrowserQuotaDO.js';
import { acquireQuotaWithSleep } from './quota-acquire.js';
import type {
  WorkflowParams,
  RenderStepResult,
  WorkflowResult
} from './types.js';
import {
  callRendererForStep,
  callSinglefileForStep,
  callReadability,
  callMonolith,
  ServiceCallError
} from './services.js';
import {
  logEvent,
  logEvents,
  logStepStarted,
  logStepCompletedWithDuration,
  logStepFailed,
  logArtifactWritten,
  logRequestDone,
  logRequestFailed,
  artifactWrittenEvent,
  settleForFailure,
  settleForResult,
  settleRequest,
  stepCompletedEvent,
  updateManifestKey
} from './logging.js';
import { runMockPipeline } from './mock.js';
import { persistArtifactsIncremental, snapshotPersistedArtifacts, writeManifest } from './persist.js';
import {
  createCheckpoint,
  discoverArtifactsFromR2,
  getAllArtifacts,
  getArtifact,
  getStepArtifacts,
  getUnpersistedArtifacts,
  loadCheckpoint,
  markStepFailed as markCheckpointStepFailed,
  markStepStarted as markCheckpointStepStarted,
  markWorkflowFailure,
  recordArtifacts,
  resolveStepMode,
  saveCheckpoint,
  STEP_REQUIRED_ARTIFACTS,
} from './checkpoint.js';

export { BrowserQuotaDO };

const ACTIVE_INSTANCE_STATUSES = new Set([
  'queued',
  'running',
  'waiting',
  'waitingForPause',
  'paused',
]);

const WORKFLOW_INSTANCE_ID_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,99}$/;

function isAlreadyExistsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('instance.already_exists');
}

function shortDeterministicHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeWorkflowInstanceId(requestId: string): string {
  const cleaned = requestId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const prefixed = /^[a-zA-Z0-9_]/.test(cleaned) ? cleaned : `r_${cleaned}`;
  const minLengthId = prefixed.length >= 8 ? prefixed : `${prefixed}${'_'.repeat(8 - prefixed.length)}`;

  if (minLengthId.length <= 100 && WORKFLOW_INSTANCE_ID_RE.test(minLengthId)) {
    return minLengthId;
  }

  const suffix = shortDeterministicHash(requestId);
  const maxBaseLength = 100 - suffix.length - 1;
  const base = minLengthId.slice(0, Math.max(1, maxBaseLength));
  const candidate = `${base}-${suffix}`;
  if (WORKFLOW_INSTANCE_ID_RE.test(candidate)) {
    return candidate;
  }
  return `r_${suffix}`;
}

function buildRetryInstanceId(instanceId: string): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  const maxBaseLength = 54; // keep ID length bounded for provider constraints
  const base = instanceId.length > maxBaseLength ? instanceId.slice(0, maxBaseLength) : instanceId;
  return `${base}-${suffix}`;
}

class WorkflowTerminalError extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = 'WorkflowTerminalError';
    this.details = details;
  }
}

/**
 * Archive workflow orchestrator.
 * Coordinates rendering, derivative extraction, manifest creation, and GCS persistence.
 */
export class ArchiveWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  // Workstream B3 (archive-completion-rootcause.md): the 30–32 MB band still
  // tripped the sandbox writeFile/exec 32 MiB RPC cap. Pre-gate at 24 MB so
  // oversized pages record a clean degraded:monolith (non-blocking after the
  // status-derivation fix) instead of attempting and RPC-failing.
  private static readonly MONOLITH_MAX_RENDERED_HTML_BYTES = 24 * 1024 * 1024;

  override async run(
    event: WorkflowEvent<WorkflowParams>,
    step: WorkflowStep
  ): Promise<WorkflowResult> {
    const { request_id, options_r2_key } = event.payload;

    let result: WorkflowResult;
    try {
      result = await this.executeWorkflow(event, step);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const terminalDetails =
        err instanceof WorkflowTerminalError ? err.details : undefined;
      await step.do('checkpoint-workflow-failure', async () => {
        const checkpoint = await loadCheckpoint(
          this.env.ARCHIVE_BUCKET,
          request_id,
          options_r2_key
        );
        if (checkpoint) {
          markWorkflowFailure(checkpoint, errorMsg);
          await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        }
      });

      // Log workflow.failed + terminal request.failed before re-throwing
      await step.do('log-workflow-failed', async () => {
        const stack = err instanceof Error ? err.stack?.slice(0, 1000) : undefined;
        await logEvent(
          this.env,
          request_id,
          'workflow.failed',
          `Workflow failed: ${errorMsg}`,
          {
            error: errorMsg,
            ...(stack ? { stack } : {}),
            ...(terminalDetails ?? {})
          },
          'error'
        );
        await logRequestFailed(
          this.env,
          request_id,
          err instanceof Error ? err : String(err),
          terminalDetails
        );
      });
      await this.settleLogger(step, request_id, (settledAt) =>
        settleForFailure(
          err instanceof Error ? err : String(err),
          terminalDetails,
          event.instanceId,
          settledAt
        )
      );
      throw err;
    }

    await this.settleLogger(step, request_id, (settledAt) =>
      settleForResult(result, event.instanceId, settledAt)
    );
    return result;
  }

  /**
   * Tell the logger the state this run settled the request in, so the
   * dashboard reads the state the workflow holds. One step, retried twice;
   * a settle that still fails is logged and never changes the run's outcome.
   */
  private async settleLogger(
    step: WorkflowStep,
    requestId: string,
    buildSettle: (settledAt: string) => RequestSettle
  ): Promise<void> {
    try {
      await step.do(
        'settle-logger',
        { retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' }, timeout: '30 seconds' },
        async () => {
          await settleRequest(this.env, requestId, buildSettle(new Date().toISOString()));
        }
      );
    } catch (err) {
      console.error(
        '[workflow] settle failed',
        JSON.stringify({ request_id: requestId, error: err instanceof Error ? err.message : String(err) })
      );
    }
  }

  /**
   * Main workflow execution logic.
   */
  private async executeWorkflow(
    event: WorkflowEvent<WorkflowParams>,
    step: WorkflowStep
  ): Promise<WorkflowResult> {
    const { request_id, url, options_r2_key } = event.payload;

    // Step 1: Read options from R2
    const options = await step.do('read-options', async () => {
      const obj = await this.env.ARCHIVE_BUCKET.get(options_r2_key);
      if (!obj) {
        await logStepFailed(
          this.env,
          request_id,
          'read-options',
          `Options not found: ${options_r2_key}`
        );
        throw new NonRetryableError(`Options not found: ${options_r2_key}`);
      }
      return obj.json<ArchiveOptions>();
    });

    const normalizedOptions = this.normalizeOptions(options);
    const resumeEnabled = normalizedOptions.resumeFromCheckpoint !== false;

    // Selective step execution: if options.steps is set, only run those steps
    const requestedSteps = normalizedOptions.steps;
    const requestedStepList: WorkflowStepType[] =
      requestedSteps && requestedSteps.length > 0
        ? Array.from(new Set(requestedSteps))
        : [...WORKFLOW_STEPS];
    const requestedStepSet = new Set<WorkflowStepType>(requestedStepList);
    const shouldRun = (stepName: WorkflowStepType) => requestedStepSet.has(stepName);

    // Step 2: Log workflow.started
    await step.do('log-started', async () => {
      const startedData: WorkflowStartedData = {
        url,
        resumeFromCheckpoint: resumeEnabled,
        requestedSteps: requestedStepList
      };
      await logEvent(this.env, request_id, 'workflow.started', 'Workflow started', startedData);
    });

    // Step 3: Check mock mode
    if ((this.env.MOCK_PIPELINE as string) === 'true') {
      return await runMockPipeline(this.env, step, request_id, url, normalizedOptions);
    }

    // Step 4: Load or initialize checkpoint state
    const checkpoint = await step.do('checkpoint-load-init', async () => {
      const loaded = resumeEnabled
        ? await loadCheckpoint(this.env.ARCHIVE_BUCKET, request_id, options_r2_key)
        : null;

      let state = loaded;
      if (!state) {
        state = createCheckpoint(request_id, options_r2_key, resumeEnabled);
        if (resumeEnabled) {
          await discoverArtifactsFromR2(this.env.ARCHIVE_BUCKET, state);
        }
      } else {
        state.optionsR2Key = options_r2_key;
        state.resumeFromCheckpoint = resumeEnabled;
      }

      await saveCheckpoint(this.env.ARCHIVE_BUCKET, state);
      return state;
    });
    // Before any later save overwrites the stored checkpoint.
    const persistedBefore = await snapshotPersistedArtifacts(this.env, step, request_id, options_r2_key);

    let lastPersistResult: WorkflowResult['gcsResult'];
    const partialFailures: Array<{ step: CheckpointStep | 'persist'; error: string }> = [];
    const successfulRequestedSteps = new Set<WorkflowStepType>();
    const failedRequestedSteps = new Map<WorkflowStepType, string>();

    const markRequestedStepSucceeded = (stepName: WorkflowStepType): void => {
      if (!requestedStepSet.has(stepName)) return;
      successfulRequestedSteps.add(stepName);
      failedRequestedSteps.delete(stepName);
    };

    const recordPartialFailure = (stepName: CheckpointStep | 'persist', error: string): void => {
      const existingIndex = partialFailures.findIndex((entry) => entry.step === stepName);
      if (existingIndex >= 0) {
        partialFailures[existingIndex] = { step: stepName, error };
      } else {
        partialFailures.push({ step: stepName, error });
      }

      if (stepName !== 'persist' && requestedStepSet.has(stepName as WorkflowStepType)) {
        failedRequestedSteps.set(stepName as WorkflowStepType, error);
      }
    };

    const persistStepArtifacts = async (
      stepName: CheckpointStep | 'final',
      reason: 'step_succeeded' | 'resume_persist_only' | 'final_reconcile'
    ): Promise<void> => {
      if (normalizedOptions.dryRun) return;

      const artifacts = stepName === 'final'
        ? getUnpersistedArtifacts(checkpoint)
        : getUnpersistedArtifacts(checkpoint, [stepName]);
      if (artifacts.length === 0) return;

      try {
        const persistResult = await persistArtifactsIncremental(
          this.env,
          step,
          checkpoint,
          request_id,
          url,
          stepName,
          artifacts,
          reason,
          persistedBefore
        );
        if (persistResult) lastPersistResult = persistResult;
      } catch (persistErr) {
        const persistError = persistErr instanceof Error
          ? persistErr
          : new Error(String(persistErr));
        await logStepFailed(
          this.env,
          request_id,
          'persist',
          persistError,
          {
            checkpointStep: stepName,
            reason,
            artifactCount: artifacts.length
          }
        );
        recordPartialFailure('persist', persistError.message);
      }
    };

    // Step 5: Render (run/persist-only/skip)
    const renderRequiredKinds = this.requiredRenderArtifacts(normalizedOptions);
    const renderMode = resolveStepMode(checkpoint, 'render', {
      requested: shouldRun('render'),
      resumeEnabled,
      requiredKinds: renderRequiredKinds
    });

    const renderArtifactsFromCheckpoint: ArtifactMeta[] = [];
    for (const kind of renderRequiredKinds) {
      const artifact = getArtifact(checkpoint, kind);
      if (!artifact) continue;
      renderArtifactsFromCheckpoint.push({
        kind: artifact.kind,
        r2Key: artifact.r2Key,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
        contentType: artifact.contentType,
      });
    }

    let renderResult: RenderStepResult = {
      artifacts: renderArtifactsFromCheckpoint,
      renderedHtmlKey: getArtifact(checkpoint, 'rendered.html')?.r2Key ?? ''
    };
    // Set when the render archives are to be persisted; they are, after the text chain.
    let renderPersistReason: 'step_succeeded' | 'resume_persist_only' | undefined;

    if (renderMode === 'run') {
      try {
        markCheckpointStepStarted(checkpoint, 'render', { resumed: resumeEnabled });
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);

        renderResult = await this.renderWithQuota(step, request_id, url, normalizedOptions, event.instanceId);
        recordArtifacts(checkpoint, 'render', renderResult.artifacts);
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        markRequestedStepSucceeded('render');
      } catch (err) {
        const renderError = err instanceof Error ? err : new Error(String(err));
        markCheckpointStepFailed(
          checkpoint,
          'render',
          renderError.message
        );
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        await logStepFailed(this.env, request_id, 'render', renderError);
        recordPartialFailure('render', renderError.message);
      }

      renderPersistReason = 'step_succeeded';
    } else if (renderMode === 'persist_only') {
      markRequestedStepSucceeded('render');
      renderPersistReason = 'resume_persist_only';
      renderResult = {
        artifacts: this.toArtifactMeta(getStepArtifacts(checkpoint, 'render')),
        renderedHtmlKey: getArtifact(checkpoint, 'rendered.html')?.r2Key ?? '',
      };
    } else if (renderMode === 'skip' && shouldRun('render')) {
      markRequestedStepSucceeded('render');
    } else if (!renderResult.renderedHtmlKey && !shouldRun('render')) {
      // Legacy fallback: if render not requested, try existing deterministic key in R2.
      renderResult = await step.do('check-existing-render', async () => {
        const renderedKey = getR2Key(request_id, 'rendered.html');
        const existing = await this.env.ARCHIVE_BUCKET.head(renderedKey);
        if (!existing) {
          return { artifacts: [], renderedHtmlKey: '' };
        }
        const recovered: ArtifactMeta = {
          kind: 'rendered.html',
          r2Key: renderedKey,
          bytes: existing.size,
          sha256: existing.httpEtag ?? 'unknown',
          contentType: existing.httpMetadata?.contentType ?? 'text/html',
        };
        recordArtifacts(checkpoint, 'render', [recovered]);
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        return { artifacts: [recovered], renderedHtmlKey: renderedKey };
      });
    }

    // Steps 6-9 run the text chain (Readability, then AI Markdown) before the
    // heavy archives (SingleFile, then Monolith). The text archives are each
    // persisted as soon as they finish, then the render archives, then each
    // heavy archive, so the text reaches storage before every other archive and
    // without waiting for a slow browser capture. Step names are the engine's
    // cache key: keep every name as it is, so an instance that started under an
    // earlier order still resumes.
    const wantReadability = shouldRun('readability');
    const wantMonolith = shouldRun('monolith');
    const renderedHtmlKey = renderResult.renderedHtmlKey;
    const missingPrereqError = 'Missing rendered.html prerequisite';

    if ((wantReadability || wantMonolith) && !renderedHtmlKey) {
      // Derivatives requested but no rendered HTML available
      await step.do('log-skip-derivatives', async () => {
        await logEvent(
          this.env,
          request_id,
          'step.completed',
          'Skipping derivatives: no rendered.html available',
          {
            skipped: true,
            reason: 'render step not run and no existing artifact found',
            resumed: resumeEnabled
          },
          'warn'
        );
      });
    }

    // Step 6: Readability (run/persist-only/skip)
    const readabilityMode = resolveStepMode(checkpoint, 'readability', {
      requested: wantReadability,
      resumeEnabled,
      requiredKinds: [...STEP_REQUIRED_ARTIFACTS.readability]
    });

    if (wantReadability && readabilityMode === 'skip') {
      markRequestedStepSucceeded('readability');
    } else if (readabilityMode === 'run' && !renderedHtmlKey) {
      markCheckpointStepFailed(checkpoint, 'readability', missingPrereqError);
      await logStepFailed(this.env, request_id, 'readability', missingPrereqError);
      recordPartialFailure('readability', missingPrereqError);
      await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
    } else if (readabilityMode === 'run') {
      try {
        markCheckpointStepStarted(checkpoint, 'readability', { resumed: resumeEnabled });
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);

        const readability = await this.runReadabilityOnly(step, request_id, renderedHtmlKey, url);
        recordArtifacts(
          checkpoint,
          'readability',
          [readability.readabilityJson, readability.readabilityMd].filter(
            (artifact): artifact is ArtifactMeta => Boolean(artifact)
          )
        );
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        markRequestedStepSucceeded('readability');
        await persistStepArtifacts('readability', 'step_succeeded');
      } catch (err) {
        const readabilityError = err instanceof Error ? err : new Error(String(err));
        markCheckpointStepFailed(checkpoint, 'readability', readabilityError.message);
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        await logStepFailed(this.env, request_id, 'readability', readabilityError);
        recordPartialFailure('readability', readabilityError.message);
      }
    } else if (readabilityMode === 'persist_only' && renderedHtmlKey) {
      markRequestedStepSucceeded('readability');
      await persistStepArtifacts('readability', 'resume_persist_only');
    }

    // Step 7: AI Markdown from the cleaned Readability HTML. Its failure marks
    // this step only: the request still completes with every other artifact.
    const aiMarkdownMode = resolveStepMode(checkpoint, 'ai-markdown', {
      requested: wantReadability && Boolean(getArtifact(checkpoint, 'readability.json')),
      resumeEnabled,
      requiredKinds: [...STEP_REQUIRED_ARTIFACTS['ai-markdown']]
    });

    if (aiMarkdownMode === 'run') {
      try {
        markCheckpointStepStarted(checkpoint, 'ai-markdown', { resumed: resumeEnabled });
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);

        const aiMarkdown = await this.runAiMarkdown(step, request_id, url);
        recordArtifacts(checkpoint, 'ai-markdown', [aiMarkdown]);
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        await persistStepArtifacts('ai-markdown', 'step_succeeded');
      } catch (err) {
        const aiMarkdownError = err instanceof Error ? err : new Error(String(err));
        markCheckpointStepFailed(checkpoint, 'ai-markdown', aiMarkdownError.message);
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        await logStepFailed(this.env, request_id, 'ai-markdown', aiMarkdownError);
      }
    } else if (aiMarkdownMode === 'persist_only') {
      await persistStepArtifacts('ai-markdown', 'resume_persist_only');
    }

    // The render archives are persisted after the text, so the text reaches
    // storage, and the article's archive list, before them.
    if (renderPersistReason) await persistStepArtifacts('render', renderPersistReason);

    // Monolith needs only the rendered page. Its call starts here, after the
    // text is persisted, and runs beside SingleFile; its result is recorded and
    // persisted at step 9. Nothing here saves the checkpoint: SingleFile's
    // saves carry the start.
    const monolithMode = resolveStepMode(checkpoint, 'monolith', {
      requested: wantMonolith,
      resumeEnabled,
      requiredKinds: [...STEP_REQUIRED_ARTIFACTS.monolith]
    });
    const renderedArtifact = getArtifact(checkpoint, 'rendered.html');
    const sizeGateError = this.monolithSizeGateError(renderedArtifact?.bytes);
    let monolithRun:
      | Promise<
          | { ok: true; value: Awaited<ReturnType<ArchiveWorkflow['runMonolithOnly']>> }
          | { ok: false; error: unknown }
        >
      | undefined;
    if (monolithMode === 'run' && renderedHtmlKey && !sizeGateError) {
      markCheckpointStepStarted(checkpoint, 'monolith', { resumed: resumeEnabled });
      monolithRun = this.runMonolithOnly(step, request_id, renderedHtmlKey, url).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      );
    }

    // Step 8: Singlefile (run/persist-only/skip)
    const singlefileMode = resolveStepMode(checkpoint, 'singlefile', {
      requested: shouldRun('singlefile'),
      resumeEnabled,
      requiredKinds: [...STEP_REQUIRED_ARTIFACTS.singlefile]
    });

    if (singlefileMode === 'run') {
      try {
        markCheckpointStepStarted(checkpoint, 'singlefile', { resumed: resumeEnabled });
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);

        const singlefile = await this.singlefileWithQuota(
          step,
          request_id,
          url,
          options_r2_key
        );
        recordArtifacts(checkpoint, 'singlefile', [singlefile]);
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        markRequestedStepSucceeded('singlefile');
      } catch (err) {
        const singlefileError = err instanceof Error ? err : new Error(String(err));
        markCheckpointStepFailed(
          checkpoint,
          'singlefile',
          singlefileError.message
        );
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        await logStepFailed(this.env, request_id, 'singlefile', singlefileError);
        recordPartialFailure('singlefile', singlefileError.message);
      }

      await persistStepArtifacts('singlefile', 'step_succeeded');
    } else if (singlefileMode === 'persist_only') {
      markRequestedStepSucceeded('singlefile');
      await persistStepArtifacts('singlefile', 'resume_persist_only');
    } else if (singlefileMode === 'skip' && shouldRun('singlefile')) {
      markRequestedStepSucceeded('singlefile');
    }

    // Step 9: Monolith (run/persist-only/skip), behind the rendered HTML size gate;
    // a run started before the text steps is awaited here.

    if (wantMonolith && monolithMode === 'skip') {
      markRequestedStepSucceeded('monolith');
    } else if (monolithMode === 'run' && !renderedHtmlKey) {
      markCheckpointStepFailed(checkpoint, 'monolith', missingPrereqError);
      await logStepFailed(this.env, request_id, 'monolith', missingPrereqError);
      recordPartialFailure('monolith', missingPrereqError);
      await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
    } else if (monolithMode === 'run' && sizeGateError) {
      markCheckpointStepFailed(checkpoint, 'monolith', sizeGateError.message);
      await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
      await logStepFailed(this.env, request_id, 'monolith', sizeGateError, {
        renderedHtmlBytes: renderedArtifact?.bytes,
        maxAllowedBytes: ArchiveWorkflow.MONOLITH_MAX_RENDERED_HTML_BYTES,
      });
      recordPartialFailure('monolith', sizeGateError.message);
    } else if (monolithMode === 'run' && monolithRun) {
      try {
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);

        const settled = await monolithRun;
        if (!settled.ok) throw settled.error;
        const { monolith } = settled.value;
        recordArtifacts(checkpoint, 'monolith', monolith ? [monolith] : []);
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        markRequestedStepSucceeded('monolith');
        await persistStepArtifacts('monolith', 'step_succeeded');
      } catch (err) {
        const monolithError = err instanceof Error ? err : new Error(String(err));
        markCheckpointStepFailed(checkpoint, 'monolith', monolithError.message);
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        await logStepFailed(this.env, request_id, 'monolith', monolithError);
        recordPartialFailure('monolith', monolithError.message);
      }
    } else if (monolithMode === 'persist_only' && renderedHtmlKey) {
      markRequestedStepSucceeded('monolith');
      await persistStepArtifacts('monolith', 'resume_persist_only');
    }

    // Step 10: Persist any leftover unpersisted artifacts, then build final manifest
    await persistStepArtifacts('final', 'final_reconcile');

    const finalArtifacts = getAllArtifacts(checkpoint);
    const manifestKey = await writeManifest(
      this.env,
      step,
      request_id,
      url,
      finalArtifacts,
      getR2Key(request_id, 'manifest.json')
    );

    // Step 11: Update manifest key in logger
    await step.do('update-manifest-key', async () => {
      await updateManifestKey(this.env, request_id, manifestKey);
    });

    const unpersistedKinds = normalizedOptions.dryRun
      ? []
      : getUnpersistedArtifacts(checkpoint).map((artifact) => artifact.kind);
    if (unpersistedKinds.length === 0) {
      const persistFailureIndex = partialFailures.findIndex((failure) => failure.step === 'persist');
      if (persistFailureIndex >= 0) {
        partialFailures.splice(persistFailureIndex, 1);
      }
    }
    const noRequestedOutputs =
      requestedStepSet.size > 0 && successfulRequestedSteps.size === 0;
    const coreArtifactsPresent = this.hasCoreArtifacts(finalArtifacts);
    const failedSteps = Array.from(failedRequestedSteps.entries()).map(
      ([stepName, error]) => ({ step: stepName, error })
    );
    const completionData = {
      manifestKey,
      resumed: resumeEnabled,
      ...(partialFailures.length > 0
        ? {
            degraded: true,
            partialFailures,
            degradedSteps: partialFailures.map((failure) => failure.step)
          }
        : {}),
    };

    if (noRequestedOutputs || unpersistedKinds.length > 0) {
      const noOutputsDetails = noRequestedOutputs
        ? {
            errorCode: 'NO_OUTPUTS_PRODUCED',
            retryable: true,
            recommendedAction: 'retry_full',
          }
        : {};
      throw new WorkflowTerminalError(
        noRequestedOutputs
          ? `No requested outputs were produced (requested: ${requestedStepList.join(', ')})`
          : `Persistence incomplete for artifacts: ${unpersistedKinds.join(', ')}`,
        {
          failureReason: noRequestedOutputs
            ? 'NO_OUTPUTS_PRODUCED'
            : 'UNPERSISTED_ARTIFACTS',
          requestedSteps: requestedStepList,
          successfulSteps: Array.from(successfulRequestedSteps),
          failedSteps,
          partialFailures,
          unpersistedKinds,
          coreArtifactsPresent,
          manifestKey,
          resumed: resumeEnabled,
          ...noOutputsDetails
        }
      );
    }

    if (normalizedOptions.dryRun) {
      await step.do('log-done-dryrun', async () => {
        await logEvent(
          this.env,
          request_id,
          'workflow.completed',
          'Workflow completed (dry run)',
          { dryRun: true, ...completionData }
        );
        await logRequestDone(this.env, request_id, { dryRun: true, ...completionData });
      });
      return {
        status: 'done',
        dryRun: true,
        manifestKey,
        degraded: partialFailures.length > 0,
        partialFailures
      };
    }

    // Step 12: Log completion + terminal request.done
    await step.do('log-completed', async () => {
      await logEvent(
        this.env,
        request_id,
        'workflow.completed',
        'Workflow completed',
        completionData
      );
      await logRequestDone(this.env, request_id, completionData);
    });

    return {
      status: 'done',
      manifestKey,
      gcsResult: lastPersistResult,
      degraded: partialFailures.length > 0,
      partialFailures
    };
  }

  private normalizeOptions(options: ArchiveOptions): ArchiveOptions {
    const normalized: ArchiveOptions = {
      ...options,
      resumeFromCheckpoint: options.resumeFromCheckpoint ?? true,
    };

    if (
      normalized.steps &&
      normalized.steps.length > 0 &&
      (normalized.includePdf || normalized.includeScreenshot) &&
      !normalized.steps.includes('render')
    ) {
      normalized.steps = Array.from(
        new Set<WorkflowStepType>([...normalized.steps, 'render'])
      );
    }

    return normalized;
  }

  private requiredRenderArtifacts(options: ArchiveOptions): ArtifactKind[] {
    const required: ArtifactKind[] = ['rendered.html'];
    if (options.includeMarkdown ?? true) {
      required.push('rendered.md');
    }
    if (options.includePdf) {
      required.push('page.pdf');
    }
    if (options.includeScreenshot) {
      required.push('screenshot.png');
    }
    return required;
  }

  private toArtifactMeta(
    artifacts: Array<{ kind: ArtifactKind; r2Key: string; bytes: number; sha256: string; contentType: string }>
  ): ArtifactMeta[] {
    return artifacts.map((artifact) => ({
      kind: artifact.kind,
      r2Key: artifact.r2Key,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      contentType: artifact.contentType,
    }));
  }

  private hasCoreArtifacts(artifacts: ArtifactMeta[]): boolean {
    const kinds = new Set(artifacts.map((artifact) => artifact.kind));
    const hasRender = kinds.has('rendered.html');
    const hasReadability = kinds.has('readability.json') || kinds.has('readability.md');
    const hasSinglefile = kinds.has('singlefile.html');
    const hasMonolith = kinds.has('monolith.html');

    return (hasRender && hasReadability) || hasSinglefile || hasMonolith;
  }

  private monolithSizeGateError(renderedBytes: number | undefined): Error | undefined {
    if (typeof renderedBytes !== 'number' || !Number.isFinite(renderedBytes)) {
      return undefined;
    }
    if (renderedBytes <= ArchiveWorkflow.MONOLITH_MAX_RENDERED_HTML_BYTES) {
      return undefined;
    }

    return new Error(
      `Monolith input too large: rendered.html ${renderedBytes} bytes exceeds ${ArchiveWorkflow.MONOLITH_MAX_RENDERED_HTML_BYTES} byte safety threshold`
    );
  }

  private shouldRetryMonolithError(error: unknown): boolean {
    if (error instanceof ServiceCallError) {
      if (
        error.classification.errorCode === 'MONOLITH_RPC_32MIB_LIMIT' ||
        error.classification.errorCode === 'MONOLITH_INPUT_TOO_LARGE'
      ) {
        return false;
      }
      return error.classification.retryable;
    }
    return true;
  }

  private async callMonolithWithRetry(
    step: WorkflowStep,
    requestId: string,
    renderedHtmlKey: string,
    monolithBaseUrl: string
  ): Promise<Awaited<ReturnType<typeof callMonolith>>> {
    // Workstream B2: monolith either produces in well under 2 min or it won't;
    // 3×5-min retries were the main driver of the derive-latency tail. Cap at
    // 2 attempts × 2-min step timeout. Deterministic failures (RPC 32 MiB,
    // input-too-large) already short-circuit via shouldRetryMonolithError.
    const maxAttempts = 2;
    let delayMs = 6000;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await step.do(
          `monolith-attempt-${attempt}`,
          { timeout: '2 minutes' },
          async () => {
            return await callMonolith(this.env, {
              request_id: requestId,
              rendered_html_key: renderedHtmlKey,
              base_url: monolithBaseUrl
            });
          }
        );
      } catch (error) {
        const lastAttempt = attempt >= maxAttempts;
        if (lastAttempt || !this.shouldRetryMonolithError(error)) {
          throw error;
        }

        await step.do(`monolith-backoff-${attempt}`, async () => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        });
        delayMs *= 2;
      }
    }

    throw new Error('Monolith retry loop exhausted unexpectedly');
  }

  /**
   * Run the monolith call under a Sandbox-exec concurrency lease (B1a).
   *
   * Monolith is the only pipeline step that drives the Cloudflare Sandbox, and
   * a settling backfill batch fires many calls within a second — bursting the
   * Sandbox provisioner into HTTP 500s on the host→container write. Gate
   * concurrency through the same BrowserQuotaDO used for browser launches, via
   * a separate `sandbox_exec` pool. The lease is held across the B2 retry loop
   * (one lease per job; retries reuse it).
   */
  private async monolithWithQuota(
    step: WorkflowStep,
    requestId: string,
    renderedHtmlKey: string,
    monolithBaseUrl: string
  ): Promise<Awaited<ReturnType<typeof callMonolith>>> {
    const { leaseId } = await acquireQuotaWithSleep(
      step,
      'monolith',
      async () => {
        const stub = this.env.BROWSER_QUOTA.get(
          this.env.BROWSER_QUOTA.idFromName('global')
        );
        const result = await stub.acquire('sandbox_exec', requestId);
        if (!result.granted) {
          return { granted: false, retryAfterMs: result.retryAfterMs };
        }
        return { granted: true, leaseId: result.leaseId! };
      },
      undefined,
      undefined,
      (m) => new NonRetryableError(m)
    );

    // No warm pool: the monolith worker keys the sandbox off the request id and
    // stops the container after the job, trading per-job cold starts for not
    // billing idle DO duration between jobs.
    try {
      return await this.callMonolithWithRetry(
        step,
        requestId,
        renderedHtmlKey,
        monolithBaseUrl
      );
    } finally {
      await step.do('release-monolith-quota', async () => {
        const stub = this.env.BROWSER_QUOTA.get(
          this.env.BROWSER_QUOTA.idFromName('global')
        );
        await stub.release(leaseId);
      });
    }
  }

  /**
   * Render the URL with browser quota management.
   */
  private async renderWithQuota(
    step: WorkflowStep,
    requestId: string,
    url: string,
    options: ArchiveOptions,
    reuseScope: string
  ): Promise<RenderStepResult> {
    // Acquire quota (sleep-reschedule between denied attempts)
    const { leaseId } = await acquireQuotaWithSleep(
      step,
      'render',
      async () => {
        const stub = this.env.BROWSER_QUOTA.get(
          this.env.BROWSER_QUOTA.idFromName('global')
        );
        // One launch token per render, also when the PDF takes a second load (see BROWSER_QUOTA_LIMITS).
        const result = await stub.acquire('bindings_launch', requestId);
        if (!result.granted) {
          return { granted: false, retryAfterMs: result.retryAfterMs };
        }
        return { granted: true, leaseId: result.leaseId! };
      },
      undefined,
      undefined,
      (m) => new NonRetryableError(m)
    );

    try {
      // Log step start + capture timing
      const renderStartedAt = Date.now();
      await step.do('log-render-start', async () => {
        await logStepStarted(this.env, requestId, 'render', { url });
      });

      // Call renderer
      const renderOutcome = await step.do(
        'render',
        {
          retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
          timeout: '5 minutes'
        },
        async (ctx) => {
          return await callRendererForStep(
            this.env,
            {
              request_id: requestId,
              url,
              browser_quota_kind: 'bindings_launch',
              include_screenshot: options.includeScreenshot,
              include_pdf: options.includePdf,
              include_markdown: options.includeMarkdown ?? true,
              // Every attempt of this step shares the run id, so a retry reuses what an earlier attempt stored.
              reuse_scope: reuseScope,
              first_attempt: ctx.attempt === 1
            },
            (m) => new NonRetryableError(m)
          );
        }
      );
      const renderResult = renderOutcome.result;

      // Log artifacts + duration + enriched meta
      await step.do('log-render-artifacts', async () => {
        const events = renderResult.artifacts.map((artifact) =>
          artifactWrittenEvent(
            artifact.kind,
            artifact.r2Key,
            artifact.bytes,
            artifact.contentType,
            artifact.sha256
          )
        );
        events.push(
          stepCompletedEvent(
            'render',
            renderStartedAt,
            {
              artifactCount: renderResult.artifacts.length,
              ...(renderOutcome.fallbackUsed
                ? {
                    fallbackUsed: true,
                    fallbackReason: renderOutcome.fallbackReason,
                    fallbackProvider: renderResult.meta?.provider ?? 'hyperbrowser'
                  }
                : {}),
              ...(renderResult.meta ? { meta: renderResult.meta } : {})
            },
            'info'
          )
        );
        await logEvents(this.env, requestId, events);
      });

      // Find the rendered HTML key
      const renderedHtml = renderResult.artifacts.find(
        (a) => a.kind === 'rendered.html'
      );
      if (!renderedHtml) {
        await logStepFailed(
          this.env,
          requestId,
          'render',
          'Renderer did not produce rendered.html'
        );
        throw new NonRetryableError('Renderer did not produce rendered.html');
      }

      return {
        artifacts: renderResult.artifacts,
        renderedHtmlKey: renderedHtml.r2Key
      };
    } finally {
      // Always release quota
      await step.do('release-render-quota', async () => {
        const stub = this.env.BROWSER_QUOTA.get(
          this.env.BROWSER_QUOTA.idFromName('global')
        );
        await stub.release(leaseId);
      });
    }
  }

  /**
   * Run singlefile extraction with browser quota management.
   * SingleFile navigates to the live URL (not rendered HTML) to capture resources.
   */
  private async singlefileWithQuota(
    step: WorkflowStep,
    requestId: string,
    url: string,
    optionsR2Key: string
  ): Promise<ArtifactMeta> {
    // Acquire quota (sleep-reschedule between denied attempts)
    const { leaseId } = await acquireQuotaWithSleep(
      step,
      'singlefile',
      async () => {
        const stub = this.env.BROWSER_QUOTA.get(
          this.env.BROWSER_QUOTA.idFromName('global')
        );
        const result = await stub.acquire('bindings_launch', requestId);
        if (!result.granted) {
          return { granted: false, retryAfterMs: result.retryAfterMs };
        }
        return { granted: true, leaseId: result.leaseId! };
      },
      undefined,
      undefined,
      (m) => new NonRetryableError(m)
    );

    try {
      // Log step start + capture timing
      const sfStartedAt = Date.now();
      await step.do('log-singlefile-start', async () => {
        await logStepStarted(this.env, requestId, 'singlefile');
      });

      // Call singlefile (navigates to live URL to capture resources)
      const result = await step.do(
        'singlefile',
        {
          retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
          timeout: '3 minutes'
        },
        async () => {
          return await callSinglefileForStep(
            this.env,
            { request_id: requestId, url, options_r2_key: optionsR2Key },
            (m) => new NonRetryableError(m)
          );
        }
      );

      // Log artifact + duration
      await step.do('log-singlefile-artifact', async () => {
        await logArtifactWritten(
          this.env,
          requestId,
          result.artifact.kind,
          result.artifact.r2Key,
          result.artifact.bytes,
          result.artifact.contentType,
          result.artifact.sha256
        );
        await logStepCompletedWithDuration(this.env, requestId, 'singlefile', sfStartedAt);
      });

      return result.artifact;
    } finally {
      // Always release quota
      await step.do('release-singlefile-quota', async () => {
        const stub = this.env.BROWSER_QUOTA.get(
          this.env.BROWSER_QUOTA.idFromName('global')
        );
        await stub.release(leaseId);
      });
    }
  }

  /**
   * Run readability only (when monolith is not requested).
   */
  private async runReadabilityOnly(
    step: WorkflowStep,
    requestId: string,
    renderedHtmlKey: string,
    url: string
  ): Promise<{ readabilityJson?: ArtifactMeta; readabilityMd?: ArtifactMeta }> {
    const startedAt = Date.now();
    await step.do('log-readability-start', async () => {
      await logStepStarted(this.env, requestId, 'readability');
    });

    const readabilityResult = await step.do(
      'readability',
      {
        retries: { limit: 2, delay: '5 seconds', backoff: 'linear' },
        timeout: '2 minutes'
      },
      async () => {
        return await callReadability(this.env, {
          request_id: requestId,
          rendered_html_key: renderedHtmlKey,
          url
        });
      }
    );

    await step.do('log-readability-artifacts', async () => {
      await logArtifactWritten(this.env, requestId, readabilityResult.json.kind, readabilityResult.json.r2Key, readabilityResult.json.bytes, readabilityResult.json.contentType, readabilityResult.json.sha256);
      await logArtifactWritten(this.env, requestId, readabilityResult.md.kind, readabilityResult.md.r2Key, readabilityResult.md.bytes, readabilityResult.md.contentType, readabilityResult.md.sha256);
      await logStepCompletedWithDuration(this.env, requestId, 'readability', startedAt, {
        ...(readabilityResult.meta ? { readabilityMeta: readabilityResult.meta } : {})
      });
    });

    return {
      readabilityJson: readabilityResult.json,
      readabilityMd: readabilityResult.md
    };
  }

  /**
   * Convert the stored Readability HTML of this request to the AI Markdown artifact.
   */
  private async runAiMarkdown(
    step: WorkflowStep,
    requestId: string,
    url: string
  ): Promise<ArtifactMeta> {
    const startedAt = Date.now();
    await step.do('log-ai-markdown-start', async () => {
      await logStepStarted(this.env, requestId, 'ai-markdown');
    });

    const artifact = await step.do(
      'ai-markdown',
      {
        retries: { limit: 2, delay: '5 seconds', backoff: 'linear' },
        timeout: '2 minutes'
      },
      async () => {
        const readabilityKey = getR2Key(requestId, 'readability.json');
        const stored = await this.env.ARCHIVE_BUCKET.get(readabilityKey);
        if (!stored) {
          throw new NonRetryableError(`Readability JSON not found: ${readabilityKey}`);
        }
        const { content } = await stored.json<Partial<ReadabilityResult>>();
        if (typeof content !== 'string' || !content) {
          throw new NonRetryableError('Readability JSON has no cleaned HTML content');
        }
        const markdown = await convertArticleToMarkdown(this.env.AI, content, url);
        return await storeArtifact(
          this.env.ARCHIVE_BUCKET,
          requestId,
          'ai-markdown.md',
          await new Response(markdown).arrayBuffer(),
          'text/markdown'
        );
      }
    );

    await step.do('log-ai-markdown-artifact', async () => {
      await logArtifactWritten(this.env, requestId, artifact.kind, artifact.r2Key, artifact.bytes, artifact.contentType, artifact.sha256);
      await logStepCompletedWithDuration(this.env, requestId, 'ai-markdown', startedAt);
    });

    return artifact;
  }

  /**
   * Run monolith only (when readability is not requested).
   */
  private async runMonolithOnly(
    step: WorkflowStep,
    requestId: string,
    renderedHtmlKey: string,
    url: string
  ): Promise<{ monolith?: ArtifactMeta }> {
    const monolithBaseUrl = this.toMonolithBaseUrl(url);

    const startedAt = Date.now();
    await step.do('log-monolith-start', async () => {
      await logStepStarted(this.env, requestId, 'monolith');
    });

    const monolithResult = await this.monolithWithQuota(
      step,
      requestId,
      renderedHtmlKey,
      monolithBaseUrl
    );

    await step.do('log-monolith-artifact', async () => {
      await logArtifactWritten(
        this.env,
        requestId,
        monolithResult.artifact.kind,
        monolithResult.artifact.r2Key,
        monolithResult.artifact.bytes,
        monolithResult.artifact.contentType,
        monolithResult.artifact.sha256
      );
      await logStepCompletedWithDuration(this.env, requestId, 'monolith', startedAt, {
        ...(monolithResult.meta ? { monolithMeta: monolithResult.meta } : {})
      });
    });

    return { monolith: monolithResult.artifact };
  }

  private toMonolithBaseUrl(rawUrl: string): string {
    // eslint-disable-next-line no-control-regex -- stripping control chars from URLs is the point
    const sanitized = rawUrl.replace(/[\u0000-\u001F\u007F]/g, '').trim();
    try {
      const parsed = new URL(sanitized);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Invalid URL protocol');
      }
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      throw new Error(`Invalid URL for monolith base URL: ${sanitized || '(empty)'}`);
    }
  }
}

/**
 * HTTP entrypoint for the workflow worker.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // POST /start - Start a new workflow instance
    if (request.method === 'POST' && url.pathname === '/start') {
      try {
        const body = (await request.json()) as WorkflowParams;

        if (!body.request_id || !body.url || !body.options_r2_key) {
          return Response.json(
            { error: 'request_id, url, and options_r2_key are required' },
            { status: 400 }
          );
        }

        const primaryInstanceId = normalizeWorkflowInstanceId(body.request_id);
        try {
          const instance = await env.ARCHIVE_WORKFLOW.create({
            id: primaryInstanceId,
            params: body
          });
          return Response.json({ instanceId: instance.id, status: 'started' });
        } catch (createErr) {
          if (!isAlreadyExistsError(createErr)) {
            throw createErr;
          }

          let existingStatus: string | undefined;
          try {
            // If a previous instance with this request_id is still active, treat start as idempotent success.
            const existing = await env.ARCHIVE_WORKFLOW.get(primaryInstanceId);
            const status = await existing.status();
            existingStatus = status.status;
            if (ACTIVE_INSTANCE_STATUSES.has(status.status)) {
              return Response.json({
                instanceId: primaryInstanceId,
                status: 'already_running',
                existingStatus: status.status
              });
            }
          } catch (statusErr) {
            console.warn('[workflow] Failed to inspect existing instance status:', statusErr);
          }

          // Prior instance is terminal; create a new workflow instance for retry while preserving request_id payload.
          const retryInstance = await env.ARCHIVE_WORKFLOW.create({
            id: buildRetryInstanceId(primaryInstanceId),
            params: body
          });
          return Response.json({
            instanceId: retryInstance.id,
            status: 'started_retry',
            previousStatus: existingStatus ?? 'unknown'
          });
        }
      } catch (err) {
        console.error('[workflow] Error starting workflow:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        return Response.json({ error: 'Internal error', message: errMsg }, { status: 500 });
      }
    }

    // GET /status/:instanceId - Get workflow status
    if (request.method === 'GET' && url.pathname.startsWith('/status/')) {
      const instanceId = url.pathname.slice('/status/'.length);
      if (!instanceId) {
        return Response.json({ error: 'instanceId is required' }, { status: 400 });
      }

      try {
        const instance = await env.ARCHIVE_WORKFLOW.get(instanceId);
        const status = await instance.status();
        return Response.json(status);
      } catch (err) {
        console.error('[workflow] Error getting workflow status:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        return Response.json({ error: 'Internal error', message: errMsg }, { status: 500 });
      }
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
};
