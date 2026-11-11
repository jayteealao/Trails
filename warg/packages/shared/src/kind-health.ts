import type { ArtifactKind, WorkflowStep } from './types.js';

/** The primary artifact of each archive kind; its creation time is a success. */
export const HEALTH_KIND_ARTIFACTS: Readonly<Record<WorkflowStep, ArtifactKind>> = {
  render: 'rendered.html',
  singlefile: 'singlefile.html',
  readability: 'readability.json',
  monolith: 'monolith.html'
};

/**
 * The data of a `workflow.started` event, which the workflow writes and the
 * logger reads for the daily health check. A type alias, so it fits event data.
 */
export type WorkflowStartedData = {
  url: string;
  resumeFromCheckpoint: boolean;
  /** The archive kinds this run asked for. */
  requestedSteps: WorkflowStep[];
};

export interface KindHealthArtifact {
  kind: ArtifactKind;
  /** ISO-8601 UTC: when the logger recorded the artifact as written. */
  createdAt: string;
}

/** One request, as the daily health check reads it. Carries no step status. */
export interface KindHealthRow {
  requestId: string;
  /** ISO-8601 UTC: when the request was initialized. */
  createdAt: string;
  /** From the latest `workflow.started`; undefined when the run never started or predates the field. */
  requestedSteps?: WorkflowStep[];
  artifacts: KindHealthArtifact[];
}
