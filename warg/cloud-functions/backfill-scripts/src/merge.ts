/**
 * Pure planner for the duplicate shared-article merge. No Firestore import:
 * the runner (`merge-pass-a.ts`) reads the documents into these views, and
 * this module decides every change. The oldest shared article of a normalized
 * URL wins; the others become stubs that point at it with `mergedInto`.
 */
import { normalizeUrl } from '@warg/url-normalizer';

/** One `archives.<key>` entry of a shared article. */
export interface ArchiveView {
  readonly status?: string;
  readonly gcs_path?: string;
  readonly [field: string]: unknown;
}

/** The fields of `articles/{id}` the planner reads. */
export interface SharedDocView {
  readonly id: string;
  readonly url?: string;
  readonly normalizedUrl?: string;
  readonly mergedInto?: string;
  /** `created_at` in millis, else the document's create time. */
  readonly createdMillis: number;
  readonly archives: Readonly<Record<string, ArchiveView>>;
  readonly hasMetadata: boolean;
}

/** The fields of `users/{uid}/articles/{itemId}` the planner reads. */
export interface UserArticleView {
  readonly uid: string;
  /** Hashed user label; the only user name a report may carry. */
  readonly uidLabel: string;
  readonly itemId: string;
  readonly canonicalId?: string;
  readonly resolvedId?: string;
}

export interface ArchiveCopy {
  readonly key: string;
  readonly fromId: string;
  readonly entry: ArchiveView;
}

export interface StubWrite {
  readonly id: string;
  readonly mergedInto: string;
}

export interface GroupPlan {
  readonly normalizedUrl: string;
  readonly winnerId: string;
  /** Every member that is not the winner, oldest first. */
  readonly loserIds: readonly string[];
  readonly archiveCopies: readonly ArchiveCopy[];
  /** New losers and stubs whose `mergedInto` does not name the winner yet. */
  readonly stubWrites: readonly StubWrite[];
  /** Losers that hold `metadata` while the winner has none. */
  readonly metadataGaps: readonly string[];
}

export type Anomaly =
  | { readonly kind: 'no-url'; readonly id: string }
  | { readonly kind: 'all-stubs'; readonly normalizedUrl: string; readonly ids: readonly string[] }
  | { readonly kind: 'metadata-gap'; readonly winnerId: string; readonly loserIds: readonly string[] };

export interface NormalizedUrlWrite {
  readonly id: string;
  readonly normalizedUrl: string;
}

export interface SharedPlan {
  /** One plan per group of two or more shared articles that has a winner. */
  readonly groups: readonly GroupPlan[];
  /** Every loser (stubs included) to the winner of its group. */
  readonly loserToWinner: ReadonlyMap<string, string>;
  readonly normalizedUrlWrites: readonly NormalizedUrlWrite[];
  readonly anomalies: readonly Anomaly[];
}

export interface LinkMove {
  readonly uid: string;
  readonly uidLabel: string;
  readonly itemId: string;
  readonly from: string;
  readonly to: string;
}

export interface MarkerNeed {
  readonly uid: string;
  readonly uidLabel: string;
  readonly itemId: string;
  /** The winner id the user needs a marker for. */
  readonly key: string;
}

function nonBlank(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** The dedupe key of a shared article, or null when it has no usable url. */
export function normalizedKeyFor(doc: SharedDocView): string | null {
  return nonBlank(doc.url) ? normalizeUrl(doc.url) : null;
}

/** Group shared articles by normalized URL; docs with no url are left out. */
export function groupByNormalizedUrl(
  docs: readonly SharedDocView[],
): Map<string, SharedDocView[]> {
  const groups = new Map<string, SharedDocView[]>();
  for (const doc of docs) {
    const key = normalizedKeyFor(doc);
    if (key === null) continue;
    const members = groups.get(key);
    if (members) members.push(doc);
    else groups.set(key, [doc]);
  }
  return groups;
}

/** Oldest first; the lower document id breaks a tie, so re-runs agree. */
function byAge(a: SharedDocView, b: SharedDocView): number {
  if (a.createdMillis !== b.createdMillis) return a.createdMillis - b.createdMillis;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The oldest member that is not a stub, or null when every member is one. */
export function pickWinner(members: readonly SharedDocView[]): SharedDocView | null {
  const live = members.filter((doc) => !nonBlank(doc.mergedInto)).sort(byAge);
  return live[0] ?? null;
}

/** A finished archive the signed-link path can serve. */
export function isSuccessfulArchive(entry: ArchiveView | undefined): entry is ArchiveView {
  return entry?.status === 'success' && nonBlank(entry.gcs_path);
}

/** Plan one group; null when every member is a stub. */
export function planGroup(
  normalizedUrl: string,
  members: readonly SharedDocView[],
): GroupPlan | null {
  const winner = pickWinner(members);
  if (!winner) return null;

  const losers = members.filter((doc) => doc.id !== winner.id).sort(byAge);

  const archiveCopies: ArchiveCopy[] = [];
  const covered = new Set(
    Object.keys(winner.archives).filter((key) => isSuccessfulArchive(winner.archives[key])),
  );
  for (const loser of losers) {
    for (const key of Object.keys(loser.archives).sort()) {
      const entry = loser.archives[key];
      if (covered.has(key) || !isSuccessfulArchive(entry)) continue;
      archiveCopies.push({ key, fromId: loser.id, entry });
      covered.add(key);
    }
  }

  return {
    normalizedUrl,
    winnerId: winner.id,
    loserIds: losers.map((doc) => doc.id),
    archiveCopies,
    stubWrites: losers
      .filter((doc) => doc.mergedInto !== winner.id)
      .map((doc) => ({ id: doc.id, mergedInto: winner.id })),
    metadataGaps: winner.hasMetadata
      ? []
      : losers.filter((doc) => doc.hasMetadata).map((doc) => doc.id),
  };
}

/** Plan every shared-article change: groups, stubs and `normalizedUrl`. */
export function planSharedArticles(docs: readonly SharedDocView[]): SharedPlan {
  const anomalies: Anomaly[] = [];
  const normalizedUrlWrites: NormalizedUrlWrite[] = [];

  for (const doc of docs) {
    const key = normalizedKeyFor(doc);
    if (key === null) anomalies.push({ kind: 'no-url', id: doc.id });
    else if (doc.normalizedUrl !== key) normalizedUrlWrites.push({ id: doc.id, normalizedUrl: key });
  }

  const groups: GroupPlan[] = [];
  const loserToWinner = new Map<string, string>();
  const grouped = [...groupByNormalizedUrl(docs)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [normalizedUrl, members] of grouped) {
    if (members.length < 2) continue;
    const plan = planGroup(normalizedUrl, members);
    if (!plan) {
      anomalies.push({ kind: 'all-stubs', normalizedUrl, ids: members.map((doc) => doc.id).sort() });
      continue;
    }
    groups.push(plan);
    for (const loserId of plan.loserIds) loserToWinner.set(loserId, plan.winnerId);
    if (plan.metadataGaps.length > 0) {
      anomalies.push({ kind: 'metadata-gap', winnerId: plan.winnerId, loserIds: plan.metadataGaps });
    }
  }

  return { groups, loserToWinner, normalizedUrlWrites, anomalies };
}

/** The shared id a user article links to: `canonicalId`, else `resolvedId`, else its own id. */
export function linkTargetOf(article: UserArticleView): string {
  if (nonBlank(article.canonicalId)) return article.canonicalId;
  if (nonBlank(article.resolvedId)) return article.resolvedId;
  return article.itemId;
}

/** One move per user article that links to a loser and does not yet name the winner. */
export function planLinkMoves(
  articles: readonly UserArticleView[],
  loserToWinner: ReadonlyMap<string, string>,
): LinkMove[] {
  const moves: LinkMove[] = [];
  for (const article of articles) {
    const from = linkTargetOf(article);
    const to = loserToWinner.get(from);
    if (to === undefined || article.canonicalId === to) continue;
    moves.push({ uid: article.uid, uidLabel: article.uidLabel, itemId: article.itemId, from, to });
  }
  return moves;
}

/**
 * The winner markers a user needs: one for each article that moves, and one
 * for each article whose `canonicalId` already names a winner (so a run that
 * stopped between the link write and the marker write is finished by the
 * next run). Deduplicated per user and winner; existing markers are filtered
 * out by the caller.
 */
export function markerNeedsFor(
  articles: readonly UserArticleView[],
  moves: readonly LinkMove[],
  winnerIds: ReadonlySet<string>,
): MarkerNeed[] {
  const needs = new Map<string, MarkerNeed>();
  const add = (need: MarkerNeed): void => {
    const id = `${need.uid}/${need.key}`;
    if (!needs.has(id)) needs.set(id, need);
  };
  for (const move of moves) {
    add({ uid: move.uid, uidLabel: move.uidLabel, itemId: move.itemId, key: move.to });
  }
  for (const article of articles) {
    if (nonBlank(article.canonicalId) && winnerIds.has(article.canonicalId)) {
      add({ uid: article.uid, uidLabel: article.uidLabel, itemId: article.itemId, key: article.canonicalId });
    }
  }
  return [...needs.values()];
}
