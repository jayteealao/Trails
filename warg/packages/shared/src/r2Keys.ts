import type { ArtifactKind } from './types.js';

/**
 * Generates a deterministic R2 key for a given artifact.
 */
export function getR2Key(requestId: string, kind: ArtifactKind): string {
  const prefix = `archives/${requestId}`;

  switch (kind) {
    case 'rendered.html':
      return `${prefix}/raw/rendered.html`;
    case 'rendered.md':
      return `${prefix}/raw/rendered.md`;
    case 'screenshot.png':
      return `${prefix}/raw/screenshot.png`;
    case 'page.pdf':
      return `${prefix}/raw/page.pdf`;
    case 'singlefile.html':
      return `${prefix}/derived/singlefile.html`;
    case 'readability.json':
      return `${prefix}/derived/readability.json`;
    case 'readability.md':
      return `${prefix}/derived/readability.md`;
    case 'monolith.html':
      return `${prefix}/derived/monolith.html`;
    case 'manifest.json':
      return `${prefix}/manifest.json`;
  }
}

/**
 * Generates the R2 key for input options.
 */
export function getOptionsKey(requestId: string): string {
  return `archives/${requestId}/input/options.json`;
}

/**
 * Generates the R2 key for workflow checkpoint state.
 */
export function getCheckpointKey(requestId: string): string {
  return `archives/${requestId}/state/checkpoint.json`;
}

/**
 * Generates the R2 key for a step-scoped manifest used for incremental persistence.
 */
export function getStepManifestKey(
  requestId: string,
  stepName: string,
  suffix: string
): string {
  const safeStep = stepName.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  const safeSuffix = suffix.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  return `archives/${requestId}/state/manifests/${safeStep}-${safeSuffix}.json`;
}
