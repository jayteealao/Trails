import {
  WorkflowEntrypoint,
  type WorkflowStep,
  type WorkflowEvent
} from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import type { ArtifactMeta, ArchiveManifest } from '@warg/shared';
import { getR2Key } from '@warg/shared';
import { BrowserQuotaDO } from './BrowserQuotaDO.js';
import type {
  WorkflowParams,
  ArchiveOptionsExtended,
  RenderStepResult,
  DerivativeStepResults,
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

export { BrowserQuotaDO };

/**
 * Archive workflow orchestrator.
 * Coordinates rendering, derivative extraction, manifest creation, and GCS persistence.
 */
export class ArchiveWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  async run(
    event: WorkflowEvent<WorkflowParams>,
    step: WorkflowStep
  ): Promise<WorkflowResult> {
    const { request_id, url, options_r2_key } = event.payload;

    try {
      return await this.executeWorkflow(event, step);
    } catch (err) {
      // Log workflow.failed + terminal request.failed before re-throwing
      await step.do('log-workflow-failed', async () => {
        const errorMsg = err instanceof Error ? err.message : String(err);
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

    // Step 2: Log workflow.started
    await step.do('log-started', async () => {
      await logEvent(this.env, request_id, 'workflow.started', 'Workflow started', {
        url
      });
    });

    // Step 3: Check mock mode
    if (this.env.MOCK_PIPELINE === 'true') {
      return await runMockPipeline(this.env, step, request_id, url, options);
    }

    // Step 4: Render (with quota)
    const renderResult = await this.renderWithQuota(step, request_id, url, options);

    // Step 5: Run singlefile (with quota)
    // SingleFile navigates to the live URL (not rendered HTML) to capture resources
    const singlefileResult = await this.singlefileWithQuota(
      step,
      request_id,
      url,
      options_r2_key
    );

    // Step 6: Parallel derivatives (readability + monolith - no browser needed)
    const parallelResults = await this.runParallelDerivatives(
      step,
      request_id,
      renderResult.renderedHtmlKey,
      url
    );

    // Combine derivative results
    const derivativeResults: DerivativeStepResults = {
      singlefile: singlefileResult,
      readabilityJson: parallelResults.readabilityJson,
      readabilityMd: parallelResults.readabilityMd,
      monolith: parallelResults.monolith
    };

    // Step 7: Build manifest
    const manifestKey = await this.buildManifest(
      step,
      request_id,
      url,
      renderResult,
      derivativeResults
    );

    // Step 8: Update manifest key in logger
    await step.do('update-manifest-key', async () => {
      await updateManifestKey(this.env, request_id, manifestKey);
    });

    // Step 9: Persist (unless dryRun)
    if (options.dryRun) {
      await step.do('log-done-dryrun', async () => {
        await logEvent(
          this.env,
          request_id,
          'workflow.completed',
          'Workflow completed (dry run)',
          { dryRun: true }
        );
        await logRequestDone(this.env, request_id, { dryRun: true });
      });
      return { status: 'done', dryRun: true, manifestKey };
    }

    const gcsResult = await this.persistToGcs(step, request_id, manifestKey);

    // Step 10: Log completion + terminal request.done
    await step.do('log-completed', async () => {
      await logEvent(
        this.env,
        request_id,
        'workflow.completed',
        'Workflow completed',
        { manifestKey }
      );
      await logRequestDone(this.env, request_id, { manifestKey });
    });

    return { status: 'done', manifestKey, gcsResult };
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
            include_pdf: options.includePdf
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
   * Build and write the manifest to R2.
   */
  private async buildManifest(
    step: WorkflowStep,
    requestId: string,
    url: string,
    renderResult: RenderStepResult,
    derivativeResults: DerivativeStepResults
  ): Promise<string> {
    return await step.do('build-manifest', async () => {
      const now = new Date().toISOString();

      // Collect all artifacts
      const artifacts: ArtifactMeta[] = [...renderResult.artifacts];

      if (derivativeResults.singlefile) {
        artifacts.push(derivativeResults.singlefile);
      }
      if (derivativeResults.readabilityJson) {
        artifacts.push(derivativeResults.readabilityJson);
      }
      if (derivativeResults.readabilityMd) {
        artifacts.push(derivativeResults.readabilityMd);
      }
      if (derivativeResults.monolith) {
        artifacts.push(derivativeResults.monolith);
      }

      const manifest: ArchiveManifest = {
        requestId,
        url,
        createdAt: now,
        completedAt: now,
        artifacts
      };

      const manifestKey = getR2Key(requestId, 'manifest.json');
      await this.env.ARCHIVE_BUCKET.put(
        manifestKey,
        JSON.stringify(manifest, null, 2),
        { httpMetadata: { contentType: 'application/json' } }
      );

      return manifestKey;
    });
  }

  /**
   * Persist artifacts to GCS.
   */
  private async persistToGcs(
    step: WorkflowStep,
    requestId: string,
    manifestKey: string
  ) {
    // Log start + capture timing
    const persistStartedAt = Date.now();
    await step.do('log-persist-start', async () => {
      await logEvent(this.env, requestId, 'persist.started', 'Starting GCS persistence');
    });

    // Call GCS service
    const result = await step.do(
      'persist-gcs',
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
    await step.do('log-persist-complete', async () => {
      const durationMs = Date.now() - persistStartedAt;
      await logEvent(
        this.env,
        requestId,
        'persist.completed',
        'GCS persistence completed',
        {
          firestore_doc_id: result.firestore_doc_id,
          duration_ms: durationMs,
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

        const instance = await env.ARCHIVE_WORKFLOW.create({
          id: body.request_id,
          params: body
        });

        return Response.json({ instanceId: instance.id, status: 'started' });
      } catch (err) {
        console.error('Error starting workflow:', err);
        const message = err instanceof Error ? err.message : 'Internal error';
        return Response.json({ error: message }, { status: 500 });
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
        console.error('Error getting workflow status:', err);
        const message = err instanceof Error ? err.message : 'Internal error';
        return Response.json({ error: message }, { status: 500 });
      }
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
};
