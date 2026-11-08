/**
 * Incremental persistence of archived artifacts: write a step manifest to R2,
 * then hand it to the GCS service and mark the artifacts persisted in the
 * checkpoint.
 *
 * Kept free of runtime-only imports so the persist steps are unit-testable in
 * plain Node (same convention as quota-acquire.ts).
 */
import type { WorkflowStep } from 'cloudflare:workers';
import type {
  ArtifactMeta,
  ArchiveManifest,
  CheckpointStep,
  WorkflowCheckpoint,
} from '@warg/shared';
import { getStepManifestKey } from '@warg/shared';
import type { WorkflowResult } from './types.js';
import { callGcs } from './services.js';
import { logEvent } from './logging.js';
import { markArtifactsPersisted, saveCheckpoint } from './checkpoint.js';

export async function persistArtifactsIncremental(
  env: Env,
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
  const manifestKey = await writeManifest(
    env,
    step,
    requestId,
    url,
    artifacts,
    getStepManifestKey(requestId, stepName, suffix)
  );

  const result = await persistToGcs(env, step, requestId, manifestKey, {
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
  await saveCheckpoint(env.ARCHIVE_BUCKET, checkpoint);
  return result;
}

export async function writeManifest(
  env: Env,
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
    await env.ARCHIVE_BUCKET.put(
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
export async function persistToGcs(
  env: Env,
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
    await logEvent(env, requestId, 'persist.started', 'Starting GCS persistence', {
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
      return await callGcs(env, {
        request_id: requestId,
        manifest_key: manifestKey
      });
    }
  );

  // Log completion + duration + enriched meta
  await step.do(`log-persist-complete-${persistToken}`, async () => {
    const durationMs = Date.now() - persistStartedAt;
    await logEvent(
      env,
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
