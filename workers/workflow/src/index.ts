import {
  WorkflowEntrypoint,
  type WorkflowStep,
  type WorkflowEvent
} from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import type {
  ArtifactKind,
  ArtifactMeta,
  ArchiveManifest,
  CheckpointStep,
  WorkflowCheckpoint,
  WorkflowStep as WorkflowStepType,
} from '@warg/shared';
import { getR2Key, getStepManifestKey } from '@warg/shared';
import { BrowserQuotaDO } from './BrowserQuotaDO.js';
import type {
  WorkflowParams,
  ArchiveOptionsExtended,
  RenderStepResult,
  WorkflowResult
} from './types.js';
import {
  callRenderer,
  callSinglefile,
  callReadability,
  callMonolith,
  callGcs
} from './services.js';
import {
  logEvent,
  logStepStarted,
  logStepCompletedWithDuration,
  logStepFailed,
  logArtifactWritten,
  logRequestDone,
  logRequestFailed,
  updateManifestKey
} from './logging.js';
import { runMockPipeline } from './mock.js';
import {
  createCheckpoint,
  discoverArtifactsFromR2,
  getAllArtifacts,
  getArtifact,
  getStepArtifacts,
  getUnpersistedArtifacts,
  loadCheckpoint,
  markArtifactsPersisted,
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

function isAlreadyExistsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('instance.already_exists');
}

function buildRetryInstanceId(requestId: string): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  const maxBaseLength = 54; // keep ID length bounded for provider constraints
  const base = requestId.length > maxBaseLength ? requestId.slice(0, maxBaseLength) : requestId;
  return `${base}-${suffix}`;
}

/**
 * Archive workflow orchestrator.
 * Coordinates rendering, derivative extraction, manifest creation, and GCS persistence.
 */
export class ArchiveWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  override async run(
    event: WorkflowEvent<WorkflowParams>,
    step: WorkflowStep
  ): Promise<WorkflowResult> {
    const { request_id, options_r2_key } = event.payload;

    try {
      return await this.executeWorkflow(event, step);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
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
          { error: errorMsg, ...(stack ? { stack } : {}) },
          'error'
        );
        await logRequestFailed(this.env, request_id, err instanceof Error ? err : String(err));
      });
      throw err;
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
      return obj.json<ArchiveOptionsExtended>();
    });

    const normalizedOptions = this.normalizeOptions(options);
    const resumeEnabled = normalizedOptions.resumeFromCheckpoint !== false;

    // Step 2: Log workflow.started
    await step.do('log-started', async () => {
      await logEvent(this.env, request_id, 'workflow.started', 'Workflow started', {
        url,
        resumeFromCheckpoint: resumeEnabled
      });
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

    // Selective step execution: if options.steps is set, only run those steps
    const requestedSteps = normalizedOptions.steps;
    const shouldRun = (s: WorkflowStepType) => !requestedSteps || requestedSteps.includes(s);

    let lastPersistResult: WorkflowResult['gcsResult'];

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

    if (renderMode === 'run') {
      try {
        markCheckpointStepStarted(checkpoint, 'render', { resumed: resumeEnabled });
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);

        renderResult = await this.renderWithQuota(step, request_id, url, normalizedOptions);
        recordArtifacts(checkpoint, 'render', renderResult.artifacts);
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
      } catch (err) {
        markCheckpointStepFailed(
          checkpoint,
          'render',
          err instanceof Error ? err.message : String(err)
        );
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        throw err;
      }

      if (!normalizedOptions.dryRun) {
        const persistResult = await this.persistArtifactsIncremental(
          step,
          checkpoint,
          request_id,
          url,
          'render',
          getUnpersistedArtifacts(checkpoint, ['render']),
          'step_succeeded'
        );
        if (persistResult) lastPersistResult = persistResult;
      }
    } else if (renderMode === 'persist_only') {
      if (!normalizedOptions.dryRun) {
        const persistResult = await this.persistArtifactsIncremental(
          step,
          checkpoint,
          request_id,
          url,
          'render',
          getUnpersistedArtifacts(checkpoint, ['render']),
          'resume_persist_only'
        );
        if (persistResult) lastPersistResult = persistResult;
      }
      renderResult = {
        artifacts: this.toArtifactMeta(getStepArtifacts(checkpoint, 'render')),
        renderedHtmlKey: getArtifact(checkpoint, 'rendered.html')?.r2Key ?? '',
      };
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

    // Step 6: Singlefile (run/persist-only/skip)
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
      } catch (err) {
        markCheckpointStepFailed(
          checkpoint,
          'singlefile',
          err instanceof Error ? err.message : String(err)
        );
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        throw err;
      }

      if (!normalizedOptions.dryRun) {
        const persistResult = await this.persistArtifactsIncremental(
          step,
          checkpoint,
          request_id,
          url,
          'singlefile',
          getUnpersistedArtifacts(checkpoint, ['singlefile']),
          'step_succeeded'
        );
        if (persistResult) lastPersistResult = persistResult;
      }
    } else if (singlefileMode === 'persist_only') {
      if (!normalizedOptions.dryRun) {
        const persistResult = await this.persistArtifactsIncremental(
          step,
          checkpoint,
          request_id,
          url,
          'singlefile',
          getUnpersistedArtifacts(checkpoint, ['singlefile']),
          'resume_persist_only'
        );
        if (persistResult) lastPersistResult = persistResult;
      }
    }

    // Step 7: Readability + Monolith (resume-aware, partial-success friendly)
    const wantReadability = shouldRun('readability');
    const wantMonolith = shouldRun('monolith');
    const readabilityMode = resolveStepMode(checkpoint, 'readability', {
      requested: wantReadability,
      resumeEnabled,
      requiredKinds: [...STEP_REQUIRED_ARTIFACTS.readability]
    });
    const monolithMode = resolveStepMode(checkpoint, 'monolith', {
      requested: wantMonolith,
      resumeEnabled,
      requiredKinds: [...STEP_REQUIRED_ARTIFACTS.monolith]
    });

    if ((wantReadability || wantMonolith) && renderResult.renderedHtmlKey) {
      if (readabilityMode === 'persist_only' && !normalizedOptions.dryRun) {
        const persistResult = await this.persistArtifactsIncremental(
          step,
          checkpoint,
          request_id,
          url,
          'readability',
          getUnpersistedArtifacts(checkpoint, ['readability']),
          'resume_persist_only'
        );
        if (persistResult) lastPersistResult = persistResult;
      }

      if (monolithMode === 'persist_only' && !normalizedOptions.dryRun) {
        const persistResult = await this.persistArtifactsIncremental(
          step,
          checkpoint,
          request_id,
          url,
          'monolith',
          getUnpersistedArtifacts(checkpoint, ['monolith']),
          'resume_persist_only'
        );
        if (persistResult) lastPersistResult = persistResult;
      }

      const runTasks: Array<{
        stepName: CheckpointStep;
        promise: Promise<ArtifactMeta[]>;
      }> = [];

      if (readabilityMode === 'run') {
        markCheckpointStepStarted(checkpoint, 'readability', { resumed: resumeEnabled });
        runTasks.push({
          stepName: 'readability',
          promise: this.runReadabilityOnly(step, request_id, renderResult.renderedHtmlKey).then((result) =>
            [result.readabilityJson, result.readabilityMd].filter(
              (artifact): artifact is ArtifactMeta => Boolean(artifact)
            )
          ),
        });
      }

      if (monolithMode === 'run') {
        markCheckpointStepStarted(checkpoint, 'monolith', { resumed: resumeEnabled });
        runTasks.push({
          stepName: 'monolith',
          promise: this.runMonolithOnly(
            step,
            request_id,
            renderResult.renderedHtmlKey,
            url
          ).then((result) => (result.monolith ? [result.monolith] : [])),
        });
      }

      if (runTasks.length > 0) {
        await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
        const settled = await Promise.allSettled(runTasks.map((task) => task.promise));
        const failures: Error[] = [];
        const successfulSteps: CheckpointStep[] = [];

        for (const [index, outcome] of settled.entries()) {
          const task = runTasks[index]!;
          if (outcome.status === 'fulfilled') {
            recordArtifacts(checkpoint, task.stepName, outcome.value);
            await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
            successfulSteps.push(task.stepName);
            continue;
          }

          const reason = outcome.reason instanceof Error
            ? outcome.reason
            : new Error(String(outcome.reason));
          markCheckpointStepFailed(checkpoint, task.stepName, reason.message);
          await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
          failures.push(reason);
        }

        if (!normalizedOptions.dryRun) {
          for (const stepName of successfulSteps) {
            try {
              const persistResult = await this.persistArtifactsIncremental(
                step,
                checkpoint,
                request_id,
                url,
                stepName,
                getUnpersistedArtifacts(checkpoint, [stepName]),
                'step_succeeded'
              );
              if (persistResult) lastPersistResult = persistResult;
            } catch (persistErr) {
              failures.push(
                persistErr instanceof Error
                  ? persistErr
                  : new Error(String(persistErr))
              );
            }
          }
        }

        if (failures.length > 0) {
          throw failures[0]!;
        }
      }
    } else if ((wantReadability || wantMonolith) && !renderResult.renderedHtmlKey) {
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

    // Step 8: Persist any leftover unpersisted artifacts, then build final manifest
    if (!normalizedOptions.dryRun) {
      const remaining = getUnpersistedArtifacts(checkpoint);
      if (remaining.length > 0) {
        const persistResult = await this.persistArtifactsIncremental(
          step,
          checkpoint,
          request_id,
          url,
          'final',
          remaining,
          'final_reconcile'
        );
        if (persistResult) lastPersistResult = persistResult;
      }
    }

    const finalArtifacts = getAllArtifacts(checkpoint);
    const manifestKey = await this.writeManifest(
      step,
      request_id,
      url,
      finalArtifacts,
      getR2Key(request_id, 'manifest.json')
    );

    // Step 9: Update manifest key in logger
    await step.do('update-manifest-key', async () => {
      await updateManifestKey(this.env, request_id, manifestKey);
    });

    if (normalizedOptions.dryRun) {
      await step.do('log-done-dryrun', async () => {
        await logEvent(
          this.env,
          request_id,
          'workflow.completed',
          'Workflow completed (dry run)',
          { dryRun: true, manifestKey }
        );
        await logRequestDone(this.env, request_id, { dryRun: true, manifestKey });
      });
      return { status: 'done', dryRun: true, manifestKey };
    }

    // Step 10: Log completion + terminal request.done
    await step.do('log-completed', async () => {
      await logEvent(
        this.env,
        request_id,
        'workflow.completed',
        'Workflow completed',
        { manifestKey, resumed: resumeEnabled }
      );
      await logRequestDone(this.env, request_id, { manifestKey });
    });

    return { status: 'done', manifestKey, gcsResult: lastPersistResult };
  }

  private normalizeOptions(options: ArchiveOptionsExtended): ArchiveOptionsExtended {
    const normalized: ArchiveOptionsExtended = {
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

  private requiredRenderArtifacts(options: ArchiveOptionsExtended): ArtifactKind[] {
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

  private async persistArtifactsIncremental(
    step: WorkflowStep,
    checkpoint: WorkflowCheckpoint,
    requestId: string,
    url: string,
    stepName: CheckpointStep | 'final',
    artifacts: ArtifactMeta[],
    reason: 'step_succeeded' | 'resume_persist_only' | 'final_reconcile'
  ): Promise<WorkflowResult['gcsResult'] | undefined> {
    if (artifacts.length === 0) {
      return undefined;
    }

    const suffix = `${Date.now()}`;
    const manifestKey = await this.writeManifest(
      step,
      requestId,
      url,
      artifacts,
      getStepManifestKey(requestId, stepName, suffix)
    );

    const result = await this.persistToGcs(step, requestId, manifestKey, {
      checkpointStep: stepName,
      reason,
      resumed: true,
      artifactCount: artifacts.length,
    });

    markArtifactsPersisted(
      checkpoint,
      result.artifacts.map((artifact) => ({
        kind: artifact.kind,
        gcsPath: artifact.gcs_path,
      }))
    );
    await saveCheckpoint(this.env.ARCHIVE_BUCKET, checkpoint);
    return result;
  }

  private async writeManifest(
    step: WorkflowStep,
    requestId: string,
    url: string,
    artifacts: ArtifactMeta[],
    manifestKey: string
  ): Promise<string> {
    return await step.do(`write-manifest-${manifestKey.split('/').pop() ?? 'manifest'}`, async () => {
      const now = new Date().toISOString();
      const manifest: ArchiveManifest = {
        requestId,
        url,
        createdAt: now,
        completedAt: now,
        artifacts
      };
      await this.env.ARCHIVE_BUCKET.put(
        manifestKey,
        JSON.stringify(manifest, null, 2),
        { httpMetadata: { contentType: 'application/json' } }
      );
      return manifestKey;
    });
  }

  /**
   * Render the URL with browser quota management.
   */
  private async renderWithQuota(
    step: WorkflowStep,
    requestId: string,
    url: string,
    options: ArchiveOptionsExtended
  ): Promise<RenderStepResult> {
    // Acquire quota (with retry)
    const { leaseId } = await step.do(
      'acquire-render-quota',
      {
        retries: { limit: 20, delay: '3 seconds', backoff: 'linear' },
        timeout: '10 minutes'
      },
      async () => {
        const stub = this.env.BROWSER_QUOTA.get(
          this.env.BROWSER_QUOTA.idFromName('global')
        );
        const result = await stub.acquire('bindings_launch', requestId);
        if (!result.granted) {
          throw new Error(`Quota unavailable, retry after ${result.retryAfterMs}ms`);
        }
        return { leaseId: result.leaseId! };
      }
    );

    try {
      // Log step start + capture timing
      const renderStartedAt = Date.now();
      await step.do('log-render-start', async () => {
        await logStepStarted(this.env, requestId, 'render', { url });
      });

      // Call renderer
      const renderResult = await step.do(
        'render',
        {
          retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
          timeout: '5 minutes'
        },
        async () => {
          return await callRenderer(this.env, {
            request_id: requestId,
            url,
            browser_quota_kind: 'rest_request',
            include_screenshot: options.includeScreenshot,
            include_pdf: options.includePdf,
            include_markdown: options.includeMarkdown ?? true
          });
        }
      );

      // Log artifacts + duration + enriched meta
      await step.do('log-render-artifacts', async () => {
        for (const artifact of renderResult.artifacts) {
          await logArtifactWritten(
            this.env,
            requestId,
            artifact.kind,
            artifact.r2Key,
            artifact.bytes
          );
        }
        await logStepCompletedWithDuration(this.env, requestId, 'render', renderStartedAt, {
          artifactCount: renderResult.artifacts.length,
          ...(renderResult.meta ? { meta: renderResult.meta } : {})
        });
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
    // Acquire quota (with retry)
    const { leaseId } = await step.do(
      'acquire-singlefile-quota',
      {
        retries: { limit: 20, delay: '3 seconds', backoff: 'linear' },
        timeout: '10 minutes'
      },
      async () => {
        const stub = this.env.BROWSER_QUOTA.get(
          this.env.BROWSER_QUOTA.idFromName('global')
        );
        const result = await stub.acquire('bindings_launch', requestId);
        if (!result.granted) {
          throw new Error(`Quota unavailable, retry after ${result.retryAfterMs}ms`);
        }
        return { leaseId: result.leaseId! };
      }
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
          return await callSinglefile(this.env, {
            request_id: requestId,
            url,
            options_r2_key: optionsR2Key
          });
        }
      );

      // Log artifact + duration
      await step.do('log-singlefile-artifact', async () => {
        await logArtifactWritten(
          this.env,
          requestId,
          result.artifact.kind,
          result.artifact.r2Key,
          result.artifact.bytes
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
   * Run parallel derivative extractions (readability + monolith).
   * These don't require browser rendering.
   */
  private async runParallelDerivatives(
    step: WorkflowStep,
    requestId: string,
    renderedHtmlKey: string,
    url: string
  ): Promise<{
    readabilityJson?: ArtifactMeta;
    readabilityMd?: ArtifactMeta;
    monolith?: ArtifactMeta;
  }> {
    // Log start + capture timing
    const derivStartedAt = Date.now();
    await step.do('log-derivatives-start', async () => {
      await logStepStarted(this.env, requestId, 'derivatives');
    });

    // Run readability and monolith in parallel
    let readabilityResult: Awaited<ReturnType<typeof callReadability>>;
    let monolithResult: Awaited<ReturnType<typeof callMonolith>>;
    try {
      [readabilityResult, monolithResult] = await Promise.all([
        step.do(
          'readability',
          {
            retries: { limit: 2, delay: '5 seconds', backoff: 'linear' },
            timeout: '2 minutes'
          },
          async () => {
            return await callReadability(this.env, {
              request_id: requestId,
              rendered_html_key: renderedHtmlKey
            });
          }
        ),
        step.do(
          'monolith',
          {
            retries: { limit: 2, delay: '5 seconds', backoff: 'linear' },
            timeout: '2 minutes'
          },
          async () => {
            return await callMonolith(this.env, {
              request_id: requestId,
              rendered_html_key: renderedHtmlKey,
              base_url: url
            });
          }
        )
      ]);
    } catch (err) {
      await logStepFailed(
        this.env,
        requestId,
        'derivatives',
        err instanceof Error ? err : String(err)
      );
      throw err;
    }

    // Log artifacts + duration + enriched meta
    await step.do('log-derivative-artifacts', async () => {
      await logArtifactWritten(
        this.env,
        requestId,
        readabilityResult.json.kind,
        readabilityResult.json.r2Key,
        readabilityResult.json.bytes
      );
      await logArtifactWritten(
        this.env,
        requestId,
        readabilityResult.md.kind,
        readabilityResult.md.r2Key,
        readabilityResult.md.bytes
      );
      await logArtifactWritten(
        this.env,
        requestId,
        monolithResult.artifact.kind,
        monolithResult.artifact.r2Key,
        monolithResult.artifact.bytes
      );
      await logStepCompletedWithDuration(this.env, requestId, 'derivatives', derivStartedAt, {
        ...(readabilityResult.meta ? { readabilityMeta: readabilityResult.meta } : {}),
        ...(monolithResult.meta ? { monolithMeta: monolithResult.meta } : {})
      });
    });

    return {
      readabilityJson: readabilityResult.json,
      readabilityMd: readabilityResult.md,
      monolith: monolithResult.artifact
    };
  }

  /**
   * Run readability only (when monolith is not requested).
   */
  private async runReadabilityOnly(
    step: WorkflowStep,
    requestId: string,
    renderedHtmlKey: string
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
          rendered_html_key: renderedHtmlKey
        });
      }
    );

    await step.do('log-readability-artifacts', async () => {
      await logArtifactWritten(this.env, requestId, readabilityResult.json.kind, readabilityResult.json.r2Key, readabilityResult.json.bytes);
      await logArtifactWritten(this.env, requestId, readabilityResult.md.kind, readabilityResult.md.r2Key, readabilityResult.md.bytes);
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
   * Run monolith only (when readability is not requested).
   */
  private async runMonolithOnly(
    step: WorkflowStep,
    requestId: string,
    renderedHtmlKey: string,
    url: string
  ): Promise<{ monolith?: ArtifactMeta }> {
    const startedAt = Date.now();
    await step.do('log-monolith-start', async () => {
      await logStepStarted(this.env, requestId, 'monolith');
    });

    const monolithResult = await step.do(
      'monolith',
      {
        retries: { limit: 2, delay: '5 seconds', backoff: 'linear' },
        timeout: '2 minutes'
      },
      async () => {
        return await callMonolith(this.env, {
          request_id: requestId,
          rendered_html_key: renderedHtmlKey,
          base_url: url
        });
      }
    );

    await step.do('log-monolith-artifact', async () => {
      await logArtifactWritten(this.env, requestId, monolithResult.artifact.kind, monolithResult.artifact.r2Key, monolithResult.artifact.bytes);
      await logStepCompletedWithDuration(this.env, requestId, 'monolith', startedAt, {
        ...(monolithResult.meta ? { monolithMeta: monolithResult.meta } : {})
      });
    });

    return { monolith: monolithResult.artifact };
  }

  /**
   * Persist artifacts to GCS.
   */
  private async persistToGcs(
    step: WorkflowStep,
    requestId: string,
    manifestKey: string,
    context?: Record<string, unknown>
  ) {
    const persistToken = (manifestKey.split('/').pop() ?? `${Date.now()}`)
      .replace(/[^a-zA-Z0-9_-]/g, '_');

    // Log start + capture timing
    const persistStartedAt = Date.now();
    await step.do(`log-persist-start-${persistToken}`, async () => {
      await logEvent(this.env, requestId, 'persist.started', 'Starting GCS persistence', {
        manifestKey,
        ...(context ?? {}),
      });
    });

    // Call GCS service
    const result = await step.do(
      `persist-gcs-${persistToken}`,
      {
        retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
        timeout: '10 minutes'
      },
      async () => {
        return await callGcs(this.env, {
          request_id: requestId,
          manifest_key: manifestKey
        });
      }
    );

    // Log completion + duration + enriched meta
    await step.do(`log-persist-complete-${persistToken}`, async () => {
      const durationMs = Date.now() - persistStartedAt;
      await logEvent(
        this.env,
        requestId,
        'persist.completed',
        'GCS persistence completed',
        {
          firestore_doc_id: result.firestore_doc_id,
          duration_ms: durationMs,
          manifestKey,
          ...(context ?? {}),
          ...(result.meta ? { meta: result.meta } : {})
        }
      );
    });

    return result;
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

        const primaryInstanceId = body.request_id;
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
