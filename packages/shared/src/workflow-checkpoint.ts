import type { ArtifactKind, ArtifactMeta, WorkflowStep } from './types.js';

export const CHECKPOINT_VERSION = 1 as const;

export const CHECKPOINT_STEPS = [
  'render',
  'singlefile',
  'readability',
  'monolith',
] as const satisfies readonly WorkflowStep[];

export type CheckpointStep = (typeof CHECKPOINT_STEPS)[number];

export type StepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped';

export interface StepCheckpoint {
  status: StepStatus;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  resumed?: boolean;
  skippedByCheckpoint?: boolean;
}

export interface ArtifactCheckpoint extends ArtifactMeta {
  producedBy: CheckpointStep;
  persisted: boolean;
  persistedAt?: string;
  gcsPath?: string;
}

export interface WorkflowFailureCheckpoint {
  step?: CheckpointStep | 'persist' | 'workflow';
  message: string;
  ts: string;
}

export interface WorkflowCheckpoint {
  version: typeof CHECKPOINT_VERSION;
  requestId: string;
  optionsR2Key: string;
  createdAt: string;
  updatedAt: string;
  resumeFromCheckpoint: boolean;
  steps: Record<CheckpointStep, StepCheckpoint>;
  artifacts: Partial<Record<ArtifactKind, ArtifactCheckpoint>>;
  lastFailure?: WorkflowFailureCheckpoint;
}

