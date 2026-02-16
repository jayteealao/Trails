import type {
  ArtifactCheckpoint,
  ArtifactKind,
  ArtifactMeta,
  CheckpointStep,
  StepCheckpoint,
  WorkflowCheckpoint,
} from '@warg/shared';
import {
  CHECKPOINT_STEPS,
  CHECKPOINT_VERSION,
  getCheckpointKey,
  getR2Key,
} from '@warg/shared';

type StepExecutionMode = 'run' | 'persist_only' | 'skip';

const KIND_TO_STEP: Partial<Record<ArtifactKind, CheckpointStep>> = {
  'rendered.html': 'render',
  'rendered.md': 'render',
  'screenshot.png': 'render',
  'page.pdf': 'render',
  'singlefile.html': 'singlefile',
  'readability.json': 'readability',
  'readability.md': 'readability',
  'monolith.html': 'monolith',
};

const CONTENT_TYPE_BY_KIND: Record<ArtifactKind, string> = {
  'rendered.html': 'text/html',
  'rendered.md': 'text/markdown',
  'screenshot.png': 'image/png',
  'page.pdf': 'application/pdf',
  'singlefile.html': 'text/html',
  'readability.json': 'application/json',
  'readability.md': 'text/markdown',
  'monolith.html': 'text/html',
  'manifest.json': 'application/json',
};

const DISCOVERABLE_KINDS: readonly ArtifactKind[] = [
  'rendered.html',
  'rendered.md',
  'screenshot.png',
  'page.pdf',
  'singlefile.html',
  'readability.json',
  'readability.md',
  'monolith.html',
];

function nowIso(): string {
  return new Date().toISOString();
}

function emptyStep(): StepCheckpoint {
  return { status: 'pending', attempts: 0 };
}

function buildEmptySteps(): Record<CheckpointStep, StepCheckpoint> {
  const record = {} as Record<CheckpointStep, StepCheckpoint>;
  for (const step of CHECKPOINT_STEPS) {
    record[step] = emptyStep();
  }
  return record;
}

export function createCheckpoint(
  requestId: string,
  optionsR2Key: string,
  resumeFromCheckpoint: boolean
): WorkflowCheckpoint {
  const ts = nowIso();
  return {
    version: CHECKPOINT_VERSION,
    requestId,
    optionsR2Key,
    createdAt: ts,
    updatedAt: ts,
    resumeFromCheckpoint,
    steps: buildEmptySteps(),
    artifacts: {},
  };
}

function touch(checkpoint: WorkflowCheckpoint): void {
  checkpoint.updatedAt = nowIso();
}

function coerceStep(value: unknown): StepCheckpoint {
  if (!value || typeof value !== 'object') {
    return emptyStep();
  }
  const src = value as Partial<StepCheckpoint>;
  return {
    status:
      src.status === 'running' ||
      src.status === 'succeeded' ||
      src.status === 'failed' ||
      src.status === 'skipped'
        ? src.status
        : 'pending',
    attempts:
      typeof src.attempts === 'number' && Number.isFinite(src.attempts)
        ? src.attempts
        : 0,
    startedAt:
      typeof src.startedAt === 'string' && src.startedAt ? src.startedAt : undefined,
    completedAt:
      typeof src.completedAt === 'string' && src.completedAt
        ? src.completedAt
        : undefined,
    error: typeof src.error === 'string' && src.error ? src.error : undefined,
    resumed: src.resumed === true ? true : undefined,
    skippedByCheckpoint: src.skippedByCheckpoint === true ? true : undefined,
  };
}

function isArtifactKind(value: string): value is ArtifactKind {
  return (
    value === 'rendered.html' ||
    value === 'rendered.md' ||
    value === 'screenshot.png' ||
    value === 'page.pdf' ||
    value === 'singlefile.html' ||
    value === 'readability.json' ||
    value === 'readability.md' ||
    value === 'monolith.html' ||
    value === 'manifest.json'
  );
}

function normalizeCheckpoint(
  requestId: string,
  optionsR2Key: string,
  parsed: unknown
): WorkflowCheckpoint | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const src = parsed as Partial<WorkflowCheckpoint>;
  if (src.version !== CHECKPOINT_VERSION) return null;
  if (typeof src.requestId !== 'string' || src.requestId !== requestId) return null;

  const steps = buildEmptySteps();
  for (const step of CHECKPOINT_STEPS) {
    steps[step] = coerceStep(src.steps?.[step]);
  }

  const artifacts: Partial<Record<ArtifactKind, ArtifactCheckpoint>> = {};
  const entries = src.artifacts && typeof src.artifacts === 'object'
    ? Object.entries(src.artifacts)
    : [];

  for (const [kindRaw, value] of entries) {
    if (!isArtifactKind(kindRaw)) continue;
    if (!value || typeof value !== 'object') continue;
    const artifact = value as Partial<ArtifactCheckpoint>;
    const producedBy = artifact.producedBy;
    if (
      producedBy !== 'render' &&
      producedBy !== 'singlefile' &&
      producedBy !== 'readability' &&
      producedBy !== 'monolith'
    ) {
      continue;
    }
    if (typeof artifact.r2Key !== 'string' || !artifact.r2Key) continue;
    if (
      typeof artifact.bytes !== 'number' ||
      !Number.isFinite(artifact.bytes) ||
      artifact.bytes < 0
    ) {
      continue;
    }
    if (typeof artifact.sha256 !== 'string' || !artifact.sha256) continue;
    if (typeof artifact.contentType !== 'string' || !artifact.contentType) continue;

    artifacts[kindRaw] = {
      kind: kindRaw,
      r2Key: artifact.r2Key,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      contentType: artifact.contentType,
      producedBy,
      persisted: artifact.persisted === true,
      persistedAt:
        typeof artifact.persistedAt === 'string' && artifact.persistedAt
          ? artifact.persistedAt
          : undefined,
      gcsPath:
        typeof artifact.gcsPath === 'string' && artifact.gcsPath
          ? artifact.gcsPath
          : undefined,
    };
  }

  return {
    version: CHECKPOINT_VERSION,
    requestId,
    optionsR2Key,
    createdAt:
      typeof src.createdAt === 'string' && src.createdAt ? src.createdAt : nowIso(),
    updatedAt:
      typeof src.updatedAt === 'string' && src.updatedAt ? src.updatedAt : nowIso(),
    resumeFromCheckpoint:
      typeof src.resumeFromCheckpoint === 'boolean'
        ? src.resumeFromCheckpoint
        : true,
    steps,
    artifacts,
    lastFailure:
      src.lastFailure &&
      typeof src.lastFailure === 'object' &&
      typeof src.lastFailure.message === 'string'
        ? {
            step:
              src.lastFailure.step === 'render' ||
              src.lastFailure.step === 'singlefile' ||
              src.lastFailure.step === 'readability' ||
              src.lastFailure.step === 'monolith' ||
              src.lastFailure.step === 'persist' ||
              src.lastFailure.step === 'workflow'
                ? src.lastFailure.step
                : undefined,
            message: src.lastFailure.message,
            ts:
              typeof src.lastFailure.ts === 'string' && src.lastFailure.ts
                ? src.lastFailure.ts
                : nowIso(),
          }
        : undefined,
  };
}

export async function loadCheckpoint(
  bucket: R2Bucket,
  requestId: string,
  optionsR2Key: string
): Promise<WorkflowCheckpoint | null> {
  const key = getCheckpointKey(requestId);
  const object = await bucket.get(key);
  if (!object) return null;
  const parsed = await object.json<unknown>();
  return normalizeCheckpoint(requestId, optionsR2Key, parsed);
}

export async function saveCheckpoint(
  bucket: R2Bucket,
  checkpoint: WorkflowCheckpoint
): Promise<void> {
  touch(checkpoint);
  await bucket.put(
    getCheckpointKey(checkpoint.requestId),
    JSON.stringify(checkpoint, null, 2),
    { httpMetadata: { contentType: 'application/json' } }
  );
}

export function markStepStarted(
  checkpoint: WorkflowCheckpoint,
  step: CheckpointStep,
  options?: { resumed?: boolean; skippedByCheckpoint?: boolean }
): void {
  const current = checkpoint.steps[step];
  checkpoint.steps[step] = {
    ...current,
    status: 'running',
    attempts: current.attempts + 1,
    startedAt: nowIso(),
    completedAt: undefined,
    error: undefined,
    resumed: options?.resumed,
    skippedByCheckpoint: options?.skippedByCheckpoint,
  };
  checkpoint.lastFailure = undefined;
  touch(checkpoint);
}

export function markStepSucceeded(
  checkpoint: WorkflowCheckpoint,
  step: CheckpointStep,
  options?: { resumed?: boolean; skippedByCheckpoint?: boolean }
): void {
  const current = checkpoint.steps[step];
  checkpoint.steps[step] = {
    ...current,
    status: 'succeeded',
    completedAt: nowIso(),
    error: undefined,
    resumed: options?.resumed,
    skippedByCheckpoint: options?.skippedByCheckpoint,
  };
  checkpoint.lastFailure = undefined;
  touch(checkpoint);
}

export function markStepSkipped(
  checkpoint: WorkflowCheckpoint,
  step: CheckpointStep
): void {
  const current = checkpoint.steps[step];
  checkpoint.steps[step] = {
    ...current,
    status: 'skipped',
    completedAt: nowIso(),
    skippedByCheckpoint: true,
    resumed: true,
  };
  touch(checkpoint);
}

export function markStepFailed(
  checkpoint: WorkflowCheckpoint,
  step: CheckpointStep,
  error: string
): void {
  const current = checkpoint.steps[step];
  checkpoint.steps[step] = {
    ...current,
    status: 'failed',
    completedAt: nowIso(),
    error,
  };
  checkpoint.lastFailure = {
    step,
    message: error,
    ts: nowIso(),
  };
  touch(checkpoint);
}

export function markWorkflowFailure(
  checkpoint: WorkflowCheckpoint,
  error: string
): void {
  checkpoint.lastFailure = {
    step: 'workflow',
    message: error,
    ts: nowIso(),
  };
  touch(checkpoint);
}

export function recordArtifacts(
  checkpoint: WorkflowCheckpoint,
  step: CheckpointStep,
  artifacts: ArtifactMeta[]
): void {
  for (const artifact of artifacts) {
    const producedBy = KIND_TO_STEP[artifact.kind];
    if (!producedBy) continue;
    checkpoint.artifacts[artifact.kind] = {
      ...artifact,
      producedBy,
      persisted: checkpoint.artifacts[artifact.kind]?.persisted ?? false,
      persistedAt: checkpoint.artifacts[artifact.kind]?.persistedAt,
      gcsPath: checkpoint.artifacts[artifact.kind]?.gcsPath,
    };
  }
  markStepSucceeded(checkpoint, step);
}

export function markArtifactsPersisted(
  checkpoint: WorkflowCheckpoint,
  persisted: Array<{ kind: ArtifactKind; gcsPath?: string }>
): ArtifactKind[] {
  const marked: ArtifactKind[] = [];
  const persistedAt = nowIso();
  for (const item of persisted) {
    const current = checkpoint.artifacts[item.kind];
    if (!current) continue;
    checkpoint.artifacts[item.kind] = {
      ...current,
      persisted: true,
      persistedAt,
      gcsPath: item.gcsPath ?? current.gcsPath,
    };
    marked.push(item.kind);
  }
  touch(checkpoint);
  return marked;
}

export function getArtifact(
  checkpoint: WorkflowCheckpoint,
  kind: ArtifactKind
): ArtifactCheckpoint | undefined {
  return checkpoint.artifacts[kind];
}

export function getStepArtifacts(
  checkpoint: WorkflowCheckpoint,
  step: CheckpointStep
): ArtifactCheckpoint[] {
  const artifacts = Object.values(checkpoint.artifacts).filter(
    (artifact): artifact is ArtifactCheckpoint => Boolean(artifact)
  );
  return artifacts.filter((artifact) => artifact.producedBy === step);
}

export function getAllArtifacts(
  checkpoint: WorkflowCheckpoint
): ArtifactMeta[] {
  return Object.values(checkpoint.artifacts)
    .filter((artifact): artifact is ArtifactCheckpoint => Boolean(artifact))
    .map((artifact) => ({
      kind: artifact.kind,
      r2Key: artifact.r2Key,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      contentType: artifact.contentType,
    }));
}

export function getUnpersistedArtifacts(
  checkpoint: WorkflowCheckpoint,
  steps?: CheckpointStep[]
): ArtifactMeta[] {
  const artifacts = Object.values(checkpoint.artifacts).filter(
    (artifact): artifact is ArtifactCheckpoint => Boolean(artifact)
  );
  return artifacts
    .filter((artifact) => !artifact.persisted)
    .filter((artifact) => (steps ? steps.includes(artifact.producedBy) : true))
    .map((artifact) => ({
      kind: artifact.kind,
      r2Key: artifact.r2Key,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      contentType: artifact.contentType,
    }));
}

export function resolveStepMode(
  checkpoint: WorkflowCheckpoint,
  step: CheckpointStep,
  options: {
    requested: boolean;
    resumeEnabled: boolean;
    requiredKinds: ArtifactKind[];
  }
): StepExecutionMode {
  if (!options.requested) return 'skip';
  if (!options.resumeEnabled) return 'run';

  const stepState = checkpoint.steps[step];
  if (stepState.status !== 'succeeded') {
    return 'run';
  }

  for (const kind of options.requiredKinds) {
    if (!checkpoint.artifacts[kind]) {
      return 'run';
    }
  }

  const stepArtifacts = options.requiredKinds.length
    ? options.requiredKinds
        .map((kind) => checkpoint.artifacts[kind])
        .filter((artifact): artifact is ArtifactCheckpoint => Boolean(artifact))
    : getStepArtifacts(checkpoint, step);

  if (stepArtifacts.length === 0) return 'run';
  if (stepArtifacts.every((artifact) => artifact.persisted)) return 'skip';
  return 'persist_only';
}

export async function discoverArtifactsFromR2(
  bucket: R2Bucket,
  checkpoint: WorkflowCheckpoint
): Promise<{ discovered: ArtifactMeta[] }> {
  const discovered: ArtifactMeta[] = [];

  for (const kind of DISCOVERABLE_KINDS) {
    if (checkpoint.artifacts[kind]) continue;

    const r2Key = getR2Key(checkpoint.requestId, kind);
    const head = await bucket.head(r2Key);
    if (!head) continue;

    const producedBy = KIND_TO_STEP[kind];
    if (!producedBy) continue;

    const meta: ArtifactMeta = {
      kind,
      r2Key,
      bytes: head.size,
      sha256: head.httpEtag ?? 'unknown',
      contentType: head.httpMetadata?.contentType ?? CONTENT_TYPE_BY_KIND[kind],
    };

    checkpoint.artifacts[kind] = {
      ...meta,
      producedBy,
      persisted: false,
    };
    discovered.push(meta);
  }

  const hasRender = Boolean(checkpoint.artifacts['rendered.html']);
  const hasSinglefile = Boolean(checkpoint.artifacts['singlefile.html']);
  const hasReadability =
    Boolean(checkpoint.artifacts['readability.json']) &&
    Boolean(checkpoint.artifacts['readability.md']);
  const hasMonolith = Boolean(checkpoint.artifacts['monolith.html']);

  if (hasRender) markStepSucceeded(checkpoint, 'render', { resumed: true });
  if (hasSinglefile) markStepSucceeded(checkpoint, 'singlefile', { resumed: true });
  if (hasReadability) markStepSucceeded(checkpoint, 'readability', { resumed: true });
  if (hasMonolith) markStepSucceeded(checkpoint, 'monolith', { resumed: true });

  if (discovered.length > 0) {
    touch(checkpoint);
  }

  return { discovered };
}

export const STEP_REQUIRED_ARTIFACTS: Record<CheckpointStep, readonly ArtifactKind[]> = {
  render: ['rendered.html', 'rendered.md'],
  singlefile: ['singlefile.html'],
  readability: ['readability.json', 'readability.md'],
  monolith: ['monolith.html'],
};

