import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { normalizeUrl } from '@warg/url-normalizer';

/**
 * The server-side link from a user's article to the shared article.
 *
 * One transaction per user article reads the user article, finds the shared
 * article by normalized URL (or creates it with create(), which never
 * overwrites), and writes the user's marker and canonicalId. A second run for
 * the same user article finds canonicalId and writes nothing.
 *
 * This module has no load-time side effect and makes no network call, so other
 * server code can reuse it.
 */

/** Every shared-article id the server creates and sends as request_id matches this. */
export const SHARED_ID_PATTERN = /^[a-zA-Z0-9_-]{8,40}$/;

export const ARTICLE_MARKERS_COLLECTION = 'articleMarkers';
export const TRIGGER_MARKER_SOURCE = 'trigger';

/** Candidate shared articles read per normalized URL; duplicates beyond this are rare and merged by the merge pass. */
const CANDIDATE_LIMIT = 10;

export function isValidSharedId(id: string): boolean {
  return SHARED_ID_PATTERN.test(id);
}

/** The marker body; the field list matches shared-types/MarkerSchema.md. */
export function markerBody(key: string, itemId: string, source: string): Record<string, unknown> {
  return {
    key,
    itemId,
    createdAt: FieldValue.serverTimestamp(),
    source,
  };
}

/**
 * Extract domain from URL (hostname without www.)
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export interface CandidateDoc {
  id: string;
  data: Record<string, unknown>;
}

function createdMillis(data: Record<string, unknown>): number {
  const value = data['created_at'];
  if (value && typeof (value as Timestamp).toMillis === 'function') {
    return (value as Timestamp).toMillis();
  }
  return Number.POSITIVE_INFINITY;
}

function mergedTarget(data: Record<string, unknown>): string | undefined {
  const value = data['mergedInto'];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Picks the shared article among docs with one normalized URL: the oldest one
 * that is not a merged stub (a missing created_at sorts last, ties go to the
 * smaller id). When every doc is a stub, returns the first stub's target to
 * follow. Returns null for no docs.
 */
export function chooseSharedCandidate(
  docs: CandidateDoc[]
): { id: string } | { followMergedInto: string } | null {
  if (docs.length === 0) return null;
  const sorted = [...docs].sort((a, b) => {
    const diff = createdMillis(a.data) - createdMillis(b.data);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const live = sorted.find((d) => mergedTarget(d.data) === undefined);
  if (live) return { id: live.id };
  return { followMergedInto: mergedTarget(sorted[0]!.data)! };
}

/** Runs fn, and once more when it fails with ALREADY_EXISTS (gRPC code 6), which the SDK does not retry. */
export async function withAlreadyExistsRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 6) {
      return fn();
    }
    throw error;
  }
}

/** An articles/{itemId} doc exists for a different URL; the server links nothing and overwrites nothing. */
export class SharedIdConflictError extends Error {
  constructor(id: string) {
    super(`Shared article ${id} exists for a different URL`);
    this.name = 'SharedIdConflictError';
  }
}

/** The id the server would create does not match SHARED_ID_PATTERN. */
export class InvalidSharedIdError extends Error {
  constructor() {
    super('Invalid article id');
    this.name = 'InvalidSharedIdError';
  }
}

/** No shared article matches and the caller asked not to create one. */
export class NoSharedArticleError extends Error {
  constructor() {
    super('No shared article for this URL');
    this.name = 'NoSharedArticleError';
  }
}

export interface LinkInput {
  userId: string;
  itemId: string;
  url: string;
  pocket?: Record<string, unknown>;
}

export interface LinkOptions {
  markerSource?: string;
  createIfMissing?: boolean;
}

export interface LinkOutcome {
  canonicalId: string;
  normalizedUrl: string;
  created: boolean;
  alreadyLinked: boolean;
  needsArchive: boolean;
}

/** True when this user article owns a shared article whose archive has not started. */
function archiveNotStarted(sharedId: string, itemId: string, data: Record<string, unknown> | undefined): boolean {
  return sharedId === itemId && data?.['status'] === 'pending' && !data?.['warg_request_id'];
}

/**
 * Links users/{userId}/articles/{itemId} to its shared article in one
 * transaction: every read comes before every write, as Firestore transactions
 * require.
 */
export async function linkUserArticle(
  db: Firestore,
  input: LinkInput,
  options: LinkOptions = {}
): Promise<LinkOutcome> {
  const { userId, itemId, url } = input;
  const userRef = db.collection('users').doc(userId).collection('articles').doc(itemId);
  const articles = db.collection('articles');
  const markerSource = options.markerSource ?? TRIGGER_MARKER_SOURCE;

  return withAlreadyExistsRetry(() =>
    db.runTransaction(async (tx) => {
      // 1. Stop when this user article is already linked (a retried event).
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new Error(`User article ${itemId} does not exist`);
      }
      const normalizedUrl = normalizeUrl(url);
      const existingId = userSnap.get('canonicalId');
      if (typeof existingId === 'string' && existingId.trim() !== '') {
        const sharedSnap = await tx.get(articles.doc(existingId));
        return {
          canonicalId: existingId,
          normalizedUrl,
          created: false,
          alreadyLinked: true,
          needsArchive: archiveNotStarted(existingId, itemId, sharedSnap.data()),
        };
      }

      // 2-3. Find the shared article by normalized URL, never a merged stub.
      const query = await tx.get(articles.where('normalizedUrl', '==', normalizedUrl).limit(CANDIDATE_LIMIT));
      let sharedId: string | undefined;
      const choice = chooseSharedCandidate(query.docs.map((d) => ({ id: d.id, data: d.data() })));
      if (choice && 'id' in choice) {
        sharedId = choice.id;
      } else if (choice) {
        const target = await tx.get(articles.doc(choice.followMergedInto));
        if (target.exists && mergedTarget(target.data() ?? {}) === undefined) {
          sharedId = target.id;
        }
      }

      // 4. No match: link an existing articles/{itemId} with the same URL, or create it.
      let created = false;
      if (sharedId === undefined) {
        if (!isValidSharedId(itemId)) {
          throw new InvalidSharedIdError();
        }
        const ownRef = articles.doc(itemId);
        const ownSnap = await tx.get(ownRef);
        if (ownSnap.exists) {
          const ownUrl = ownSnap.get('url');
          if (typeof ownUrl !== 'string' || normalizeUrl(ownUrl) !== normalizedUrl) {
            throw new SharedIdConflictError(itemId);
          }
          sharedId = itemId;
        } else if (options.createIfMissing === false) {
          throw new NoSharedArticleError();
        } else {
          tx.create(ownRef, {
            item_id: itemId,
            url,
            normalizedUrl,
            domain: extractDomain(url),
            created_at: Timestamp.now(),
            status: 'pending',
            archives: {},
            pocket: input.pocket ?? {},
            stats: {
              last_accessed: '',
              total_saves: 1,
              total_views: 0,
            },
          });
          sharedId = itemId;
          created = true;
        }
      }

      // 5. A save of an existing shared article counts once.
      if (!created) {
        tx.update(articles.doc(sharedId), {
          'stats.total_saves': FieldValue.increment(1),
          'stats.last_saved_at': Timestamp.now(),
        });
      }

      // 6-7. The marker and the server-owned link, in the same transaction.
      tx.set(
        db.collection('users').doc(userId).collection(ARTICLE_MARKERS_COLLECTION).doc(sharedId),
        markerBody(sharedId, itemId, markerSource)
      );
      tx.update(userRef, { canonicalId: sharedId, resolvedId: sharedId });

      return {
        canonicalId: sharedId,
        normalizedUrl,
        created,
        alreadyLinked: false,
        needsArchive: created,
      };
    })
  );
}
