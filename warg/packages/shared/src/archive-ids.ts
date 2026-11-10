/**
 * Article ids, URL domains and storage paths: the one copy that the workers,
 * the cloud functions and the dashboard functions all import.
 *
 * Ids follow two rules. Every id the server creates for a shared article is
 * 8 to 40 safe characters (SAFE_ID_RE). Readers of request ids also accept
 * shorter legacy Pocket ids such as "54149" or "0", so they allow 1 to 40
 * (LEGACY_SAFE_ID_RE). Both keep the charset to [a-zA-Z0-9_-] so an id is
 * safe as a storage path segment.
 *
 * Domains come in two forms. extractDomain drops a leading "www." (the domain
 * the triggers and the dashboard store); extractHostname keeps the hostname as
 * is (the domain the upload function and the request log store).
 *
 * This file imports only types, so it builds on its own for the cloud
 * functions and the dashboard functions.
 */
import type { ArtifactKind } from './types.js';

/** Every shared-article id the server creates matches this: 8 to 40 safe characters. */
export const SAFE_ID_RE = /^[a-zA-Z0-9_-]{8,40}$/;

/** Request ids readers accept: 1 to 40 safe characters, for short legacy Pocket ids. */
export const LEGACY_SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,40}$/;

/** The hostname of a URL without a leading "www.", or 'unknown' when the URL does not parse. */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/** The hostname of a URL as is, or 'unknown' when the URL does not parse. */
export function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/** The storage folder and file name of each artifact kind. */
export const GCS_ARTIFACT_PATHS: Record<ArtifactKind, { folder: string; filename: string }> = {
  'singlefile.html': { folder: 'singlefile', filename: 'output.html.gz' },
  'monolith.html': { folder: 'monolith', filename: 'output.html.gz' },
  'readability.json': { folder: 'readability', filename: 'output.json' },
  'readability.md': { folder: 'readability', filename: 'output.md.gz' },
  'ai-markdown.md': { folder: 'ai-markdown', filename: 'output.md.gz' },
  'page.pdf': { folder: 'pdf', filename: 'output.pdf' },
  'screenshot.png': { folder: 'screenshot', filename: 'output.png' },
  'rendered.html': { folder: 'rendered', filename: 'output.html.gz' },
  'rendered.md': { folder: 'rendered', filename: 'output.md.gz' },
  'manifest.json': { folder: 'manifest', filename: 'manifest.json' },
};

/** The storage path of one artifact of a request. Throws for a kind the map does not know. */
export function getGcsPath(requestId: string, kind: ArtifactKind): { folder: string; filename: string; path: string } {
  const mapping = GCS_ARTIFACT_PATHS[kind];
  if (!mapping) {
    throw new Error(`Unknown artifact kind: ${kind}`);
  }
  return {
    folder: mapping.folder,
    filename: mapping.filename,
    path: `archives/${requestId}/${mapping.folder}/${mapping.filename}`,
  };
}
