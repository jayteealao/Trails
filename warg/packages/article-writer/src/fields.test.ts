import { readFileSync } from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, test } from 'vitest';
import {
  METADATA_FIELDS,
  SHARED_ARTICLE_FIELDS,
  USER_ARTICLE_FIELDS,
  buildArchiveFinalizePatch,
  buildArchiveUploadJournalPatch,
  buildBootstrapBackfillPatch,
  buildBootstrapSharedArticlePatch,
  buildCountSharedArticleSavePatch,
  buildCreateSharedArticlePatch,
  buildSharedArticleArchiveStartedPatch,
  buildSharedArticleFailedPatch,
  buildSharedArticleProcessingPatch,
  buildUserArticleArchivalTriggeredPatch,
  buildUserArticleErrorPatch,
  buildUserArticleLinkPatch,
  buildUserArticleResolvedLinkPatch,
} from './index.js';

// The field names of the writer are the ones the shared metadata doc lists.

const SHARED_DOC = 'articles/{id}';
const USER_DOC = 'users/{uid}/articles/{id}';

/** Field names per document from the "## Articles document fields" table of WargMetadata.md. */
function documentedFields(): Map<string, Set<string>> {
  const md = readFileSync(new URL('../../../../shared-types/WargMetadata.md', import.meta.url), 'utf8');
  const lines = md.split(/\r?\n/);
  const start = lines.indexOf('## Articles document fields');
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  const byDoc = new Map<string, Set<string>>();
  for (const line of end < 0 ? rest : rest.slice(0, end)) {
    const match = line.match(/^\|\s*`([A-Za-z_][A-Za-z0-9_.]*)`\s*\|\s*`([^`]+)`\s*\|/);
    if (!match) continue;
    const field = match[1]!;
    const doc = match[2]!;
    if (!byDoc.has(doc)) byDoc.set(doc, new Set());
    byDoc.get(doc)!.add(field);
  }
  return byDoc;
}

/** Field names of the "## Firestore field names (snake_case)" table of WargMetadata.md. */
function metadataContractFields(): string[] {
  const md = readFileSync(new URL('../../../../shared-types/WargMetadata.md', import.meta.url), 'utf8');
  const lines = md.split(/\r?\n/);
  const start = lines.indexOf('## Firestore field names (snake_case)');
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).flatMap((line) => {
    const match = line.match(/^\|\s*`([a-z_]+)`\s*\|/);
    return match ? [match[1]!] : [];
  });
}

/** The field names a patch writes; a plain map's fields are dotted, a Timestamp or sentinel is one field. */
function flattenKeys(patch: object, prefix = ''): string[] {
  return Object.entries(patch).flatMap(([key, value]) => {
    const name = prefix + key;
    const isMap = value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
    return isMap ? [name, ...flattenKeys(value, `${name}.`)] : [name];
  });
}

const now = Timestamp.fromMillis(1000);
const pocket = { favorite: '1', resolved_id: 'r', status: '0', time_added: 1, time_read: 2 };
const article = { itemId: 'item1234', url: 'https://example.com/a', domain: 'example.com', pocket };

const sharedPatches: Record<string, object> = {
  create: buildCreateSharedArticlePatch({ ...article, normalizedUrl: 'https://example.com/a' }, now),
  countSave: buildCountSharedArticleSavePatch(now),
  archiveStarted: buildSharedArticleArchiveStartedPatch('req-00001', now),
  failed: buildSharedArticleFailedPatch('boom', now),
  bootstrap: buildBootstrapSharedArticlePatch(article, now),
  backfill: buildBootstrapBackfillPatch({}, article, now),
  processing: buildSharedArticleProcessingPatch({ ...article, requestId: 'req-00001' }, now),
  uploadJournal: buildArchiveUploadJournalPatch(
    {
      ...article,
      archives: {
        singlefile: {
          status: 'uploading',
          gcs_path: 'gs://b/archives/item1234/singlefile/output.html.gz',
          gcs_bucket: 'b',
          started_at: '1970-01-01T00:00:01.000Z',
        },
        pdf: { status: 'success', gcs_path: 'gs://b/p', created_at: '1970-01-01T00:00:01.000Z' },
      },
      isNew: true,
    },
    now
  ),
  finalize: buildArchiveFinalizePatch(
    {
      archives: {
        rendered: {
          status: 'success',
          gcs_path: 'gs://b/r',
          gcs_bucket: 'b',
          compressed_size: 4,
          compression_ratio: 0.4,
          created_at: '1970-01-01T00:00:01.000Z',
        },
      },
      metadata: {
        title: 't',
        excerpt: 'e',
        byline: 'b',
        word_count: 1,
        published_time: null,
        site_name: null,
        lead_image: null,
      },
      images: [{ src: 'https://example.com/i.png' }],
    },
    now
  ),
};

const userPatches: Record<string, object> = {
  link: buildUserArticleLinkPatch('shared01'),
  error: buildUserArticleErrorPatch('boom', now),
  archivalTriggered: buildUserArticleArchivalTriggeredPatch(),
  resolvedLink: buildUserArticleResolvedLinkPatch({ resolvedId: 'shared01', archivalTriggered: true }),
};

describe('the field lists match WargMetadata.md', () => {
  const documented = documentedFields();

  test('the shared article fields', () => {
    expect([...(documented.get(SHARED_DOC) ?? [])].sort()).toEqual([...SHARED_ARTICLE_FIELDS].sort());
  });

  test('the user article fields', () => {
    expect([...(documented.get(USER_DOC) ?? [])].sort()).toEqual([...USER_ARTICLE_FIELDS].sort());
  });

  test('the metadata fields are the metadata contract', () => {
    expect(metadataContractFields().sort()).toEqual([...METADATA_FIELDS].sort());
  });

  test('no other document is listed', () => {
    expect([...documented.keys()].sort()).toEqual([SHARED_DOC, USER_DOC].sort());
  });
});

describe('every patch writes only documented field names', () => {
  const documented = documentedFields();

  test.each(Object.entries(sharedPatches))('shared article: %s', (_kind, patch) => {
    for (const key of flattenKeys(patch)) expect(documented.get(SHARED_DOC)).toContain(key);
  });

  test.each(Object.entries(userPatches))('user article: %s', (_kind, patch) => {
    for (const key of flattenKeys(patch)) expect(documented.get(USER_DOC)).toContain(key);
  });

  test('the full backfill patch has every base field', () => {
    expect(flattenKeys(sharedPatches['backfill']!)).toEqual(
      expect.arrayContaining(['updated_at', 'item_id', 'url', 'domain', 'created_at', 'pocket', 'stats'])
    );
  });
});
