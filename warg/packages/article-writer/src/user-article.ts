import { FieldValue, Timestamp, type DocumentReference, type Transaction, type WriteResult } from 'firebase-admin/firestore';
import type { Expect, OnlyFields, UserArticleField } from './fields.js';

// The write kinds of the user article `users/{uid}/articles/{id}` that the
// server makes. Each kind has a pure builder that returns its typed patch and a
// write function that makes the one Firestore call, with the method and merge
// flag that kind has always used.

// --- linkUserArticleInTransaction: the server-owned link to the shared article, tx.update ---

export interface UserArticleLinkPatch {
  canonicalId: string;
  resolvedId: string;
}

export function buildUserArticleLinkPatch(sharedId: string): UserArticleLinkPatch {
  return { canonicalId: sharedId, resolvedId: sharedId };
}

export function linkUserArticleInTransaction(
  tx: Transaction,
  ref: DocumentReference,
  sharedId: string
): Transaction {
  return tx.update(ref, buildUserArticleLinkPatch(sharedId));
}

// --- recordUserArticleError: why the save could not be processed, ref.update ---

export interface UserArticleErrorPatch {
  error: string;
  error_at: Timestamp;
}

export function buildUserArticleErrorPatch(error: string, now: Timestamp = Timestamp.now()): UserArticleErrorPatch {
  return { error, error_at: now };
}

export function recordUserArticleError(
  ref: DocumentReference,
  error: string,
  now: Timestamp = Timestamp.now()
): Promise<WriteResult> {
  return ref.update(buildUserArticleErrorPatch(error, now));
}

// --- markUserArticleArchivalTriggered: the archive of its shared article started, ref.update ---

export interface UserArticleArchivalTriggeredPatch {
  archival_triggered: true;
}

export function buildUserArticleArchivalTriggeredPatch(): UserArticleArchivalTriggeredPatch {
  return { archival_triggered: true };
}

export function markUserArticleArchivalTriggered(ref: DocumentReference): Promise<WriteResult> {
  return ref.update(buildUserArticleArchivalTriggeredPatch());
}

// --- setUserArticleResolvedLink: the dashboard links the user article, ref.set merge ---

export interface UserArticleResolvedLinkPatch {
  resolvedId: string;
  archival_triggered?: true;
}

/** `archivalTriggered` adds `archival_triggered: true`; false leaves the field out. */
export function buildUserArticleResolvedLinkPatch(input: {
  resolvedId: string;
  archivalTriggered: boolean;
}): UserArticleResolvedLinkPatch {
  const patch: UserArticleResolvedLinkPatch = { resolvedId: input.resolvedId };
  if (input.archivalTriggered) patch.archival_triggered = true;
  return patch;
}

export function setUserArticleResolvedLink(
  ref: DocumentReference,
  input: { resolvedId: string; archivalTriggered: boolean }
): Promise<WriteResult> {
  return ref.set(buildUserArticleResolvedLinkPatch(input), { merge: true });
}

// --- clearUserArticleCanonicalId: drop the link the scan read, ref.update with a precondition ---

export interface UserArticleCanonicalIdClearPatch {
  /** Always FieldValue.delete(). */
  canonicalId: FieldValue;
}

export function buildUserArticleCanonicalIdClearPatch(): UserArticleCanonicalIdClearPatch {
  return { canonicalId: FieldValue.delete() };
}

/** Fails with FAILED_PRECONDITION when the user article changed after `lastUpdateTime`. */
export function clearUserArticleCanonicalId(ref: DocumentReference, lastUpdateTime: Timestamp): Promise<WriteResult> {
  return ref.update(buildUserArticleCanonicalIdClearPatch(), { lastUpdateTime });
}

// --- enqueueUserArticle: the dashboard queues a URL as a new user article, ref.create ---

export interface EnqueueUserArticlePatch {
  url: string;
  favorite: string;
  status: string;
  timeAdded: Timestamp;
  timeRead: number;
  resolvedId: string;
  archival_triggered: false;
  queued_at: Timestamp;
  queued_by: 'dashboard';
}

/** The fields as the caller validated and coerced them; `resolvedId` is the new item id. */
export interface EnqueuedUserArticle {
  url: string;
  favorite: string;
  status: string;
  timeRead: number;
  resolvedId: string;
}

export function buildEnqueueUserArticlePatch(
  input: EnqueuedUserArticle,
  now: Timestamp = Timestamp.now()
): EnqueueUserArticlePatch {
  return {
    url: input.url,
    favorite: input.favorite,
    status: input.status,
    timeAdded: now,
    timeRead: input.timeRead,
    resolvedId: input.resolvedId,
    archival_triggered: false,
    queued_at: now,
    queued_by: 'dashboard',
  };
}

/** Creates the user article; fails with ALREADY_EXISTS when it exists. Its creation starts the save trigger. */
export function enqueueUserArticle(
  ref: DocumentReference,
  input: EnqueuedUserArticle,
  now: Timestamp = Timestamp.now()
): Promise<WriteResult> {
  return ref.create(buildEnqueueUserArticlePatch(input, now));
}

// Every patch of the user article writes only the names of USER_ARTICLE_FIELDS.
type _UserPatchesUseListedFields = [
  Expect<OnlyFields<UserArticleCanonicalIdClearPatch, UserArticleField>>,
  Expect<OnlyFields<EnqueueUserArticlePatch, UserArticleField>>,
  Expect<OnlyFields<UserArticleLinkPatch, UserArticleField>>,
  Expect<OnlyFields<UserArticleErrorPatch, UserArticleField>>,
  Expect<OnlyFields<UserArticleArchivalTriggeredPatch, UserArticleField>>,
  Expect<OnlyFields<UserArticleResolvedLinkPatch, UserArticleField>>,
];
