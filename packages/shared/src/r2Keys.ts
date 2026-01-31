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
