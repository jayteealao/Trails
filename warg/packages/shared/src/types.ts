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
 * The archive steps a caller may request, in run order. The single runtime
 * source for the step names: the `WorkflowStep` type is derived from it.
 */
export const WORKFLOW_STEPS = ['render', 'singlefile', 'readability', 'monolith'] as const;

export type WorkflowStep = (typeof WORKFLOW_STEPS)[number];

/**
 * The archive option keys whose value is a boolean when present. `dryRun` runs the
 * workflow without its side effects.
 */
export const ARCHIVE_OPTION_BOOLEAN_KEYS = [
  'includeScreenshot',
  'includePdf',
  'includeMarkdown',
  'resumeFromCheckpoint',
  'dryRun',
] as const;

export type ArchiveOptionBooleanKey = (typeof ARCHIVE_OPTION_BOOLEAN_KEYS)[number];

/**
 * Options for starting an archive request.
 */
export type ArchiveOptions = {
  url: string;
  steps?: WorkflowStep[];
} & Partial<Record<ArchiveOptionBooleanKey, boolean>>;

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
  /** Page og:image resolved against the page URL; null when missing or invalid. */
  leadImage?: string | null;
}
