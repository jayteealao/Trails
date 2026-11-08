import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type Transaction,
  type WriteResult,
} from 'firebase-admin/firestore';
import type { Expect, OnlyFields, PocketField, SharedArticleField } from './fields.js';

// The write kinds of the shared article `articles/{id}`. Each kind has a pure
// builder that returns its typed patch and a write function that makes the one
// Firestore call, with the method and merge flag that kind has always used.
// Which branch writes, and whether a write is needed, stays with the caller.

/** The `pocket` map as the caller projects it; a missing part is left out, `{}` is allowed. */
export type PocketInput = Partial<Record<PocketField, unknown>>;

/** The `stats` map of a new shared article. */
export interface NewArticleStats {
  last_accessed: string;
  total_saves: number;
  total_views: number;
}

/** The stats every new shared article starts with: one save, no view. */
export function newArticleStats(): NewArticleStats {
  return { last_accessed: '', total_saves: 1, total_views: 0 };
}

// --- createSharedArticleInTransaction: the save trigger's create, tx.create ---

export interface CreateSharedArticlePatch {
  item_id: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  created_at: Timestamp;
  status: 'pending';
  archives: Record<never, never>;
  pocket: PocketInput;
  stats: NewArticleStats;
}

export interface NewSharedArticle {
  itemId: string;
  url: string;
  domain: string;
  pocket: PocketInput;
}

export function buildCreateSharedArticlePatch(
  input: NewSharedArticle & { normalizedUrl: string },
  now: Timestamp = Timestamp.now()
): CreateSharedArticlePatch {
  return {
    item_id: input.itemId,
    url: input.url,
    normalizedUrl: input.normalizedUrl,
    domain: input.domain,
    created_at: now,
    status: 'pending',
    archives: {},
    pocket: input.pocket,
    stats: newArticleStats(),
  };
}

/** Creates the shared article in the transaction; the commit fails when it already exists. */
export function createSharedArticleInTransaction(
  tx: Transaction,
  ref: DocumentReference,
  input: NewSharedArticle & { normalizedUrl: string },
  now: Timestamp = Timestamp.now()
): Transaction {
  return tx.create(ref, buildCreateSharedArticlePatch(input, now));
}

// --- countSharedArticleSaveInTransaction: one more save of an existing article, tx.update ---

export interface CountSharedArticleSavePatch {
  'stats.total_saves': FieldValue;
  'stats.last_saved_at': Timestamp;
}

export function buildCountSharedArticleSavePatch(now: Timestamp = Timestamp.now()): CountSharedArticleSavePatch {
  return {
    'stats.total_saves': FieldValue.increment(1),
    'stats.last_saved_at': now,
  };
}

export function countSharedArticleSaveInTransaction(
  tx: Transaction,
  ref: DocumentReference,
  now: Timestamp = Timestamp.now()
): Transaction {
  return tx.update(ref, buildCountSharedArticleSavePatch(now));
}

// --- markSharedArticleArchiveStarted: the trigger started the archive, ref.update ---

export interface SharedArticleArchiveStartedPatch {
  /** The gateway's request id; undefined when its reply named none. */
  warg_request_id: string | undefined;
  status: 'processing';
  processing_started_at: Timestamp;
}

export function buildSharedArticleArchiveStartedPatch(
  requestId: string | undefined,
  now: Timestamp = Timestamp.now()
): SharedArticleArchiveStartedPatch {
  return { warg_request_id: requestId, status: 'processing', processing_started_at: now };
}

export function markSharedArticleArchiveStarted(
  ref: DocumentReference,
  requestId: string | undefined,
  now: Timestamp = Timestamp.now()
): Promise<WriteResult> {
  return ref.update(buildSharedArticleArchiveStartedPatch(requestId, now));
}

// --- markSharedArticleFailed: the archive could not start, ref.update ---

export interface SharedArticleFailedPatch {
  status: 'failed';
  error: string;
  failed_at: Timestamp;
}

export function buildSharedArticleFailedPatch(
  error: string,
  now: Timestamp = Timestamp.now()
): SharedArticleFailedPatch {
  return { status: 'failed', error, failed_at: now };
}

export function markSharedArticleFailed(
  ref: DocumentReference,
  error: string,
  now: Timestamp = Timestamp.now()
): Promise<WriteResult> {
  return ref.update(buildSharedArticleFailedPatch(error, now));
}

// --- bootstrapSharedArticle: the dashboard creates a missing article, ref.set (replace) ---

export interface BootstrapSharedArticlePatch {
  item_id: string;
  url: string;
  domain: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  status: 'pending';
  archives: Record<never, never>;
  pocket: PocketInput;
  stats: NewArticleStats;
}

export function buildBootstrapSharedArticlePatch(
  input: NewSharedArticle,
  now: Timestamp = Timestamp.now()
): BootstrapSharedArticlePatch {
  return {
    item_id: input.itemId,
    url: input.url,
    domain: input.domain,
    created_at: now,
    updated_at: now,
    status: 'pending',
    archives: {},
    pocket: input.pocket,
    stats: newArticleStats(),
  };
}

/** Writes the whole shared article, replacing the doc: call it only when the doc was read as absent. */
export function bootstrapSharedArticle(
  ref: DocumentReference,
  input: NewSharedArticle,
  now: Timestamp = Timestamp.now()
): Promise<WriteResult> {
  return ref.set(buildBootstrapSharedArticlePatch(input, now));
}

// --- backfillSharedArticleBaseFields: the dashboard fills missing base fields, ref.set merge ---

export interface BootstrapBackfillPatch {
  updated_at: Timestamp;
  item_id?: string;
  url?: string;
  domain?: string;
  created_at?: Timestamp;
  pocket?: PocketInput;
  stats?: NewArticleStats;
}

/**
 * The base fields that `existing` lacks (a falsy value counts as missing), with
 * `updated_at`. A patch with only `updated_at` means nothing is missing.
 */
export function buildBootstrapBackfillPatch(
  existing: DocumentData,
  input: NewSharedArticle,
  now: Timestamp = Timestamp.now()
): BootstrapBackfillPatch {
  const patch: BootstrapBackfillPatch = { updated_at: now };
  if (!existing['item_id']) patch.item_id = input.itemId;
  if (!existing['url']) patch.url = input.url;
  if (!existing['domain']) patch.domain = input.domain;
  if (!existing['created_at']) patch.created_at = now;
  if (!existing['pocket']) patch.pocket = input.pocket;
  if (!existing['stats']) patch.stats = newArticleStats();
  return patch;
}

export function backfillSharedArticleBaseFields(
  ref: DocumentReference,
  patch: BootstrapBackfillPatch
): Promise<WriteResult> {
  return ref.set(patch, { merge: true });
}

// --- markSharedArticleProcessing: the dashboard marks the archive started, ref.set merge ---

export interface SharedArticleProcessingPatch {
  item_id: string;
  url: string;
  domain: string;
  status: 'processing';
  warg_request_id: string;
  processing_started_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProcessingSharedArticle {
  itemId: string;
  url: string;
  domain: string;
  requestId: string;
}

export function buildSharedArticleProcessingPatch(
  input: ProcessingSharedArticle,
  now: Timestamp = Timestamp.now()
): SharedArticleProcessingPatch {
  return {
    item_id: input.itemId,
    url: input.url,
    domain: input.domain,
    status: 'processing',
    warg_request_id: input.requestId,
    processing_started_at: now,
    updated_at: now,
  };
}

export function markSharedArticleProcessing(
  ref: DocumentReference,
  input: ProcessingSharedArticle,
  now: Timestamp = Timestamp.now()
): Promise<WriteResult> {
  return ref.set(buildSharedArticleProcessingPatch(input, now), { merge: true });
}

// Every patch of the shared article writes only the names of SHARED_ARTICLE_FIELDS.
type _SharedPatchesUseListedFields = [
  Expect<OnlyFields<CreateSharedArticlePatch, SharedArticleField>>,
  Expect<OnlyFields<CountSharedArticleSavePatch, SharedArticleField>>,
  Expect<OnlyFields<SharedArticleArchiveStartedPatch, SharedArticleField>>,
  Expect<OnlyFields<SharedArticleFailedPatch, SharedArticleField>>,
  Expect<OnlyFields<BootstrapSharedArticlePatch, SharedArticleField>>,
  Expect<OnlyFields<BootstrapBackfillPatch, SharedArticleField>>,
  Expect<OnlyFields<SharedArticleProcessingPatch, SharedArticleField>>,
];
