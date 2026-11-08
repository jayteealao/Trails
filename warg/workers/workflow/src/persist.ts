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
  ArtifactKind,
  ArtifactMeta,
  ArchiveManifest,
  CheckpointStep,
  WorkflowCheckpoint,
} from '@warg/shared';
import { getStepManifestKey, sha256 } from '@warg/shared';
import type { WorkflowResult } from './types.js';
import { callGcs } from './services.js';
import { logEvent } from './logging.js';
import { loadCheckpoint, markArtifactsPersisted, saveCheckpoint } from './checkpoint.js';

/**
 * Suffix for a persist's manifest key and step names, derived only from the
 * request, the persisting step and the artifacts it persists.
 *
 * A workflow that wakes from a sleep replays its run from the top; the persist
 * steps must come back with the same names so the cached results are reused
 * instead of uploading to GCS again. Every input here comes from cached step
 * results, so a replay reproduces the same suffix; never add an input that can
 * change between replays, such as the clock.
 */
export async function persistManifestSuffix(
  requestId: string,
  stepName: string,
  artifacts: readonly ArtifactMeta[]
): Promise<string> {
  const sorted = [...artifacts].sort((a, b) => a.kind.localeCompare(b.kind));
  const canonical = JSON.stringify([
    requestId,
    stepName,
    sorted.map((a) => [a.kind, a.r2Key, a.sha256, a.bytes, a.contentType]),
  ]);
  const digest = await sha256(new TextEncoder().encode(canonical));
  return digest.slice(0, 16);
}

/** The artifacts a stored checkpoint records as persisted, by kind. */
export type PersistedArtifacts = Partial<
  Record<ArtifactKind, { r2Key: string; sha256: string; gcsPath?: string }>
>;

/**
 * Reads, once per instance, which artifacts its stored checkpoint already
 * records as persisted.
 *
 * An instance that was running when the persist step names changed resumes
 * under the new names, so its earlier persists are not found in its history.
 * The stored checkpoint still says what those persists uploaded until the run
 * saves its checkpoint again, so this must run right after the checkpoint is
 * loaded. The step result is cached, so later replays see the same snapshot.
 */
export async function snapshotPersistedArtifacts(
  env: Env,
  step: WorkflowStep,
  requestId: string,
  optionsR2Key: string
): Promise<PersistedArtifacts> {
  return await step.do('checkpoint-persisted-snapshot', async () => {
    const stored = await loadCheckpoint(env.ARCHIVE_BUCKET, requestId, optionsR2Key);
    const persisted: PersistedArtifacts = {};
    for (const artifact of Object.values(stored?.artifacts ?? {})) {
      if (!artifact?.persisted) continue;
      persisted[artifact.kind] = {
        r2Key: artifact.r2Key,
        sha256: artifact.sha256,
        gcsPath: artifact.gcsPath,
      };
    }
    return persisted;
  });
}

export async function persistArtifactsIncremental(
  env: Env,
  step: WorkflowStep,
  checkpoint: WorkflowCheckpoint,
  requestId: string,
  url: string,
  stepName: CheckpointStep | 'final',
  artifacts: ArtifactMeta[],
  reason: 'step_succeeded' | 'resume_persist_only' | 'final_reconcile',
  persistedBefore: PersistedArtifacts = {}
): Promise<WorkflowResult['gcsResult'] | undefined> {
  if (artifacts.length === 0) {
    return undefined;
  }

  // Same content already persisted by an earlier run of this instance: mark it
  // and upload only the rest.
  const isPersistedBefore = (artifact: ArtifactMeta): boolean => {
    const before = persistedBefore[artifact.kind];
    return before?.r2Key === artifact.r2Key && before.sha256 === artifact.sha256;
  };
  const already = artifacts.filter(isPersistedBefore);
  const remaining = artifacts.filter((artifact) => !isPersistedBefore(artifact));
  if (already.length > 0) {
    markArtifactsPersisted(
      checkpoint,
      already.map((artifact) => ({
        kind: artifact.kind,
        gcsPath: persistedBefore[artifact.kind]?.gcsPath,
      }))
    );
  }
  if (remaining.length === 0) {
    await saveCheckpoint(env.ARCHIVE_BUCKET, checkpoint);
    return undefined;
  }

  const suffix = await persistManifestSuffix(requestId, stepName, remaining);
  const manifestKey = await writeManifest(
    env,
    step,
    requestId,
    url,
    remaining,
    getStepManifestKey(requestId, stepName, suffix)
  );

  const result = await persistToGcs(env, step, requestId, manifestKey, {
    checkpointStep: stepName,
    reason,
    resumed: true,
    artifactCount: remaining.length,
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
  const persistToken = (manifestKey.split('/').pop() ?? 'manifest')
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
