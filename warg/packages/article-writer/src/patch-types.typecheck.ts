import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type {
  BackfillUpsertPatch,
  BootstrapBackfillPatch,
  EnqueueUserArticlePatch,
  FailurePatch,
  SharedArticleBackfillBegunPatch,
  SharedArticleBackfillFailurePatch,
  SharedArticleDerivedStatusPatch,
  SharedArticleStuckPatch,
  UserArticleCanonicalIdClearPatch,
  BootstrapSharedArticlePatch,
  CountSharedArticleSavePatch,
  CreateSharedArticlePatch,
  SharedArticleArchiveStartedPatch,
  SharedArticleFailedPatch,
  SharedArticleProcessingPatch,
  UserArticleArchivalTriggeredPatch,
  UserArticleErrorPatch,
  UserArticleLinkPatch,
  UserArticleResolvedLinkPatch,
} from './index.js';

// Compiled by `tsc --noEmit` only (never built or run). Each assignment is a
// valid patch plus one unknown field, so the compile fails if a patch type ever
// accepts a field that is not listed. An unused @ts-expect-error is itself an
// error, so removing the rejection fails the compile too.
// Each directive carries an sdlc-debt note: it is the assertion, not a suppression.

const now = Timestamp.fromMillis(0);
const stats = { last_accessed: '', total_saves: 1, total_views: 0 };

const _create: CreateSharedArticlePatch = {
  item_id: 'i', url: 'u', normalizedUrl: 'n', domain: 'd', created_at: now, status: 'pending', archives: {}, pocket: {}, stats,
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the shared article
  not_a_field: 1,
};

const _countSave: CountSharedArticleSavePatch = {
  'stats.total_saves': FieldValue.increment(1),
  'stats.last_saved_at': now,
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the shared article
  not_a_field: 1,
};

const _archiveStarted: SharedArticleArchiveStartedPatch = {
  warg_request_id: 'r', status: 'processing', processing_started_at: now,
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the shared article
  not_a_field: 1,
};

const _failed: SharedArticleFailedPatch = {
  status: 'failed', error: 'e', failed_at: now,
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the shared article
  not_a_field: 1,
};

const _bootstrap: BootstrapSharedArticlePatch = {
  item_id: 'i', url: 'u', domain: 'd', created_at: now, updated_at: now, status: 'pending', archives: {}, pocket: {}, stats,
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the shared article
  not_a_field: 1,
};

const _backfill: BootstrapBackfillPatch = {
  updated_at: now,
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the shared article
  not_a_field: 1,
};

const _processing: SharedArticleProcessingPatch = {
  item_id: 'i', url: 'u', domain: 'd', status: 'processing', warg_request_id: 'r', processing_started_at: now, updated_at: now,
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the shared article
  not_a_field: 1,
};

const _link: UserArticleLinkPatch = {
  canonicalId: 'c', resolvedId: 'c',
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the user article
  not_a_field: 1,
};

const _error: UserArticleErrorPatch = {
  error: 'e', error_at: now,
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the user article
  not_a_field: 1,
};

const _archivalTriggered: UserArticleArchivalTriggeredPatch = {
  archival_triggered: true,
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the user article
  not_a_field: 1,
};

const _resolvedLink: UserArticleResolvedLinkPatch = {
  resolvedId: 'c',
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the user article
  not_a_field: 1,
};

// A map inside a patch rejects an unknown field too.
const _pocket: CreateSharedArticlePatch['pocket'] = {
  favorite: '1',
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the pocket map
  not_a_field: 1,
};

const _derivedStatus: SharedArticleDerivedStatusPatch = {
  status: 'complete', status_updated_at: now,
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the shared article
  not_a_field: 1,
};

const _backfillUpsert: BackfillUpsertPatch = {
  item_id: 'i', url: 'u', domain: 'd', retry_count: 0, updated_at: now,
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the shared article
  not_a_field: 1,
};

const _backfillBegun: SharedArticleBackfillBegunPatch = {
  warg_request_id: 'r', processing_started_at: now, updated_at: now, error: FieldValue.delete(),
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the shared article
  not_a_field: 1,
};

const event = { status: 'failed', error: 'e', created_at: '1970-01-01T00:00:00.000Z' };
const failure: FailurePatch = { class: 'TRANSIENT_UPSTREAM', last_seen_at: now, count: FieldValue.increment(1), last_error_message: 'e' };

const _backfillFailure: SharedArticleBackfillFailurePatch = {
  archives: { gateway_begin: event }, failure, error: 'e', failed_at: now, retry_count: 1, updated_at: now,
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the shared article
  not_a_field: 1,
};

const _stuck: SharedArticleStuckPatch = {
  archives: { workflow_settlement: event }, error: 'e', failed_at: now, updated_at: now,
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the shared article
  not_a_field: 1,
};

const _canonicalIdClear: UserArticleCanonicalIdClearPatch = {
  canonicalId: FieldValue.delete(),
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the user article
  not_a_field: 1,
};

const _enqueue: EnqueueUserArticlePatch = {
  url: 'u', favorite: '', status: '', timeAdded: now, timeRead: 0, resolvedId: 'i', archival_triggered: false, queued_at: now, queued_by: 'dashboard',
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the user article
  not_a_field: 1,
};

// The failure map rejects an unknown field too.
const _failure: FailurePatch = {
  ...failure,
  // @ts-expect-error sdlc-debt: none, this rejection is the assertion — not a field of the failure map
  not_a_field: 1,
};
