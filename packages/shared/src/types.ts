/**
 * Artifact kinds produced by the pipeline.
 */
export type ArtifactKind =
  | 'rendered.html'
  | 'rendered.md'
  | 'screenshot.png'
  | 'page.pdf'
  | 'singlefile.html'
  | 'readability.json'
  | 'readability.md'
  | 'monolith.html'
  | 'manifest.json';

/**
 * Metadata for a single artifact.
 */
export interface ArtifactMeta {
  kind: ArtifactKind;
  r2Key: string;
  bytes: number;
  sha256: string;
  contentType: string;
}

/**
 * Manifest describing all artifacts for a request.
 */
export interface ArchiveManifest {
  requestId: string;
  url: string;
  createdAt: string;
  completedAt: string;
  artifacts: ArtifactMeta[];
}

/**
 * Options for starting an archive request.
 */
export interface ArchiveOptions {
  url: string;
  includeScreenshot?: boolean;
  includePdf?: boolean;
}

/**
 * Readability extraction result from @mozilla/readability.
 */
export interface ReadabilityResult {
  title: string | null;
  byline: string | null;
  dir: string | null;
  lang: string | null;
  content: string | null;
  textContent: string | null;
  length: number;
  excerpt: string | null;
  siteName: string | null;
  publishedTime: string | null;
}
