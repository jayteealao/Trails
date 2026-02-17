import { describe, expect, it } from 'vitest';
import { canSoftFailMonolithFailure } from './monolith-policy.js';

describe('canSoftFailMonolithFailure', () => {
  it('returns true when monolith fails after render/readability succeeded', () => {
    expect(
      canSoftFailMonolithFailure({
        failingStep: 'monolith',
        renderArtifactPresent: true,
        readabilityRequested: true,
        readabilityStepStatus: 'succeeded',
        readabilityArtifactsPresent: true,
      })
    ).toBe(true);
  });

  it('returns false when monolith is the only requested derivative', () => {
    expect(
      canSoftFailMonolithFailure({
        failingStep: 'monolith',
        renderArtifactPresent: true,
        readabilityRequested: false,
        readabilityStepStatus: 'pending',
        readabilityArtifactsPresent: false,
      })
    ).toBe(false);
  });

  it('returns false when render artifact is missing', () => {
    expect(
      canSoftFailMonolithFailure({
        failingStep: 'monolith',
        renderArtifactPresent: false,
        readabilityRequested: true,
        readabilityStepStatus: 'succeeded',
        readabilityArtifactsPresent: true,
      })
    ).toBe(false);
  });

  it('returns false when readability did not succeed', () => {
    expect(
      canSoftFailMonolithFailure({
        failingStep: 'monolith',
        renderArtifactPresent: true,
        readabilityRequested: true,
        readabilityStepStatus: 'failed',
        readabilityArtifactsPresent: false,
      })
    ).toBe(false);
  });
});
