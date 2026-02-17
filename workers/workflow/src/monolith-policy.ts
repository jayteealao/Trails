import type { CheckpointStep, StepStatus } from '@warg/shared';

export interface MonolithSoftFailInput {
  failingStep: CheckpointStep;
  renderArtifactPresent: boolean;
  readabilityRequested: boolean;
  readabilityStepStatus: StepStatus;
  readabilityArtifactsPresent: boolean;
}

/**
 * Monolith can be treated as a non-terminal degradation when core reader artifacts
 * already exist and readability succeeded.
 */
export function canSoftFailMonolithFailure(input: MonolithSoftFailInput): boolean {
  if (input.failingStep !== 'monolith') return false;
  if (!input.renderArtifactPresent) return false;
  if (!input.readabilityRequested) return false;
  if (input.readabilityStepStatus !== 'succeeded') return false;
  if (!input.readabilityArtifactsPresent) return false;
  return true;
}
