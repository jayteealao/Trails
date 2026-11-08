import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type Transaction,
  type WriteResult,
} from 'firebase-admin/firestore';
import {
  GATEWAY_ARCHIVE_KEYS,
  type Expect,
  type GatewayArchiveKey,
  type OnlyFields,
  type PocketField,
  type SharedArticleField,
} from './fields.js';

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

// --- setSharedArticleDerivedStatus: the status trigger writes the derived status, ref.set merge ---

export interface SharedArticleDerivedStatusPatch {
  status: string;
  status_updated_at: Timestamp;
}

export function buildSharedArticleDerivedStatusPatch(
  status: string,
  now: Timestamp = Timestamp.now()
): SharedArticleDerivedStatusPatch {
  return { status, status_updated_at: now };
}

/** Merges exactly `status` and its time, so the fields of every other writer stay as they are. */
export function setSharedArticleDerivedStatus(
  ref: DocumentReference,
  status: string,
  now: Timestamp = Timestamp.now()
): Promise<WriteResult> {
  return ref.set(buildSharedArticleDerivedStatusPatch(status, now), { merge: true });
}

// --- upsertSharedArticleForBackfill: the backfill creates or fills the article before a start, ref.set merge ---

export interface BackfillUpsertPatch {
  item_id: string;
  url: string;
  domain: string;
  retry_count: number;
  updated_at: Timestamp;
  created_at?: Timestamp;
  archives?: Record<never, never>;
  pocket?: PocketInput;
  stats?: NewArticleStats;
}

export interface BackfillArticle {
  itemId: string;
  url: string;
  domain: string;
  pocket: PocketInput;
  retryCount: number;
}

/**
 * The base fields and the retry count; for a new article (`existing` undefined)
 * also `created_at`, empty `archives`, `pocket` and the stats seed, and for an
 * existing one only those of `created_at`, `pocket` and `stats` it lacks (a
 * falsy value counts as missing). `status` is left to the status trigger.
 */
export function buildBackfillUpsertPatch(
  existing: DocumentData | undefined,
  input: BackfillArticle,
  now: Timestamp = Timestamp.now()
): BackfillUpsertPatch {
  const patch: BackfillUpsertPatch = {
    item_id: input.itemId,
    url: input.url,
    domain: input.domain,
    retry_count: input.retryCount,
    updated_at: now,
  };
  if (existing === undefined) {
    patch.created_at = now;
    patch.archives = {};
    patch.pocket = input.pocket;
    patch.stats = newArticleStats();
    return patch;
  }
  if (!existing['created_at']) patch.created_at = now;
  if (!existing['pocket']) patch.pocket = input.pocket;
  if (!existing['stats']) patch.stats = newArticleStats();
  return patch;
}

export function upsertSharedArticleForBackfill(
  ref: DocumentReference,
  patch: BackfillUpsertPatch
): Promise<WriteResult> {
  return ref.set(patch, { merge: true });
}

// --- markSharedArticleBackfillBegun: the archive start of the backfill was accepted, ref.set merge ---

export interface SharedArticleBackfillBegunPatch {
  warg_request_id: string;
  processing_started_at: Timestamp;
  updated_at: Timestamp;
  /** Always FieldValue.delete(): the earlier failure no longer holds. */
  error: FieldValue;
}

/** The two times are separate inputs: the backfill reads its clock once for each. */
export interface BackfillBegun {
  requestId: string;
  processingStartedAt: Timestamp;
  updatedAt: Timestamp;
}

export function buildSharedArticleBackfillBegunPatch(input: BackfillBegun): SharedArticleBackfillBegunPatch {
  return {
    warg_request_id: input.requestId,
    processing_started_at: input.processingStartedAt,
    updated_at: input.updatedAt,
    error: FieldValue.delete(),
  };
}

export function markSharedArticleBackfillBegun(ref: DocumentReference, input: BackfillBegun): Promise<WriteResult> {
  return ref.set(buildSharedArticleBackfillBegunPatch(input), { merge: true });
}

// --- recordSharedArticleBackfillFailure: the archive start of the backfill failed, ref.set merge ---

/** An archive entry the backfill writes itself; `created_at` is an ISO string. */
export interface ArchiveEventEntry {
  status: string;
  error: string;
  created_at: string;
}

export interface FailurePatch {
  class: string;
  last_seen_at: Timestamp;
  /** Always FieldValue.increment(1). */
  count: FieldValue;
  last_error_message: string;
  first_seen_at?: Timestamp;
}

export interface SharedArticleBackfillFailurePatch {
  archives: { gateway_begin: ArchiveEventEntry };
  failure: FailurePatch;
  error: string;
  failed_at: Timestamp;
  retry_count: number;
  updated_at: Timestamp;
}

export interface BackfillFailure {
  failureClass: string;
  message: string;
  failedAt: Timestamp;
  retryCount: number;
  /** True for the first recorded failure: the patch then sets `failure.first_seen_at`. */
  firstSeen: boolean;
}

export function buildSharedArticleBackfillFailurePatch(input: BackfillFailure): SharedArticleBackfillFailurePatch {
  const failure: FailurePatch = {
    class: input.failureClass,
    last_seen_at: input.failedAt,
    count: FieldValue.increment(1),
    last_error_message: input.message,
  };
  if (input.firstSeen) failure.first_seen_at = input.failedAt;
  return {
    archives: {
      gateway_begin: { status: 'failed', error: input.message, created_at: input.failedAt.toDate().toISOString() },
    },
    failure,
    error: input.message,
    failed_at: input.failedAt,
    retry_count: input.retryCount,
    updated_at: input.failedAt,
  };
}

export function recordSharedArticleBackfillFailure(
  ref: DocumentReference,
  input: BackfillFailure
): Promise<WriteResult> {
  return ref.set(buildSharedArticleBackfillFailurePatch(input), { merge: true });
}

// --- settleStuckSharedArticle: a backfill batch item never finished, ref.set merge ---

/** The error of an archive the backfill gave up waiting for. */
export const STUCK_ARCHIVE_ERROR = 'Stuck: no completion after 30 minutes';

export interface SharedArticleStuckPatch {
  archives: { workflow_settlement: ArchiveEventEntry };
  error: string;
  failed_at: Timestamp;
  updated_at: Timestamp;
}

export function buildSharedArticleStuckPatch(now: Timestamp = Timestamp.now()): SharedArticleStuckPatch {
  return {
    archives: {
      workflow_settlement: { status: 'stuck', error: STUCK_ARCHIVE_ERROR, created_at: now.toDate().toISOString() },
    },
    error: STUCK_ARCHIVE_ERROR,
    failed_at: now,
    updated_at: now,
  };
}

/** Records the settlement under `archives.workflow_settlement`, so the status trigger has its signal. */
export function settleStuckSharedArticle(
  ref: DocumentReference,
  now: Timestamp = Timestamp.now()
): Promise<WriteResult> {
  return ref.set(buildSharedArticleStuckPatch(now), { merge: true });
}

// --- journalSharedArticleUploads: the archive gateway journals the uploads it signs, ref.set merge ---

/** An archive entry the archive gateway writes; the times are ISO strings. */
export interface GatewayArchiveEntry {
  status: string;
  gcs_path?: string;
  gcs_bucket?: string;
  compressed_size?: number;
  compression_ratio?: number;
  started_at?: string;
  created_at?: string;
}

/** The gateway archive entries by archive key; a key that is left out is not written. */
export type GatewayArchiveEntries = Partial<Record<GatewayArchiveKey, GatewayArchiveEntry>>;

export interface ArchiveUploadJournalPatch {
  item_id: string;
  url: string;
  domain: string;
  updated_at: Timestamp;
  archives: GatewayArchiveEntries;
  created_at?: Timestamp;
}

export interface ArchiveUploadJournal {
  itemId: string;
  url: string;
  domain: string;
  /** The entries as the gateway decided them: `uploading`, or an earlier `success` kept whole. */
  archives: GatewayArchiveEntries;
  /** True when the article was read as absent: the patch then sets `created_at`. */
  isNew: boolean;
}

export function buildArchiveUploadJournalPatch(
  input: ArchiveUploadJournal,
  now: Timestamp = Timestamp.now()
): ArchiveUploadJournalPatch {
  const patch: ArchiveUploadJournalPatch = {
    item_id: input.itemId,
    url: input.url,
    domain: input.domain,
    updated_at: now,
    archives: input.archives,
  };
  if (input.isNew) patch.created_at = now;
  return patch;
}

/** Merges the journal, so the archive entries of other kinds and every other field stay as they are. */
export function journalSharedArticleUploads(
  ref: DocumentReference,
  patch: ArchiveUploadJournalPatch
): Promise<WriteResult> {
  return ref.set(patch, { merge: true });
}

// --- finalizeSharedArticleArchives: the archive gateway records the finished uploads, ref.update ---

/** The reader metadata of the article; its fields are the metadata contract of WargMetadata.md. */
export interface ArticleMetadata {
  title: string;
  excerpt: string;
  byline: string;
  word_count: number;
  published_time: string | null;
  site_name: string | null;
  lead_image: string | null;
}

export interface ArticleImage {
  src: string;
  height?: number;
  width?: number;
}

/** Each finished entry under its dotted name, so it replaces only that entry of `archives`. */
export type ArchiveFinalizePatch = {
  [K in `archives.${GatewayArchiveKey}`]?: GatewayArchiveEntry;
} & {
  updated_at: Timestamp;
  metadata?: ArticleMetadata;
  images?: ArticleImage[];
};

export interface ArchiveFinalize {
  archives: GatewayArchiveEntries;
  metadata?: ArticleMetadata;
  images?: ArticleImage[];
}

export function buildArchiveFinalizePatch(
  input: ArchiveFinalize,
  now: Timestamp = Timestamp.now()
): ArchiveFinalizePatch {
  const patch: ArchiveFinalizePatch = { updated_at: now };
  for (const key of GATEWAY_ARCHIVE_KEYS) {
    const entry = input.archives[key];
    if (entry) patch[`archives.${key}`] = entry;
  }
  if (input.metadata) patch.metadata = input.metadata;
  if (input.images) patch.images = input.images;
  return patch;
}

/** An update, so it fails on a missing article instead of creating a partial one. */
export function finalizeSharedArticleArchives(
  ref: DocumentReference,
  patch: ArchiveFinalizePatch
): Promise<WriteResult> {
  return ref.update(patch);
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
  Expect<OnlyFields<SharedArticleDerivedStatusPatch, SharedArticleField>>,
  Expect<OnlyFields<BackfillUpsertPatch, SharedArticleField>>,
  Expect<OnlyFields<SharedArticleBackfillBegunPatch, SharedArticleField>>,
  Expect<OnlyFields<SharedArticleBackfillFailurePatch, SharedArticleField>>,
  Expect<OnlyFields<SharedArticleStuckPatch, SharedArticleField>>,
  Expect<OnlyFields<ArchiveUploadJournalPatch, SharedArticleField>>,
  Expect<OnlyFields<ArchiveFinalizePatch, SharedArticleField>>,
];
