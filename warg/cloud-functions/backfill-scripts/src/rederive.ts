/**
 * Pure planner for the link re-derive. No Firestore import: the runner
 * (`rederive-pass-b.ts`) reads the documents into these views, and this module
 * decides every change.
 *
 * Every non-deleted user article's link is derived again from its URL with the
 * save trigger's own rule (normalize the URL, pick the shared article with
 * `chooseSharedCandidate`, follow `mergedInto` once, else create
 * `articles/{itemId}` when the id is valid). Nothing the client wrote is
 * trusted: not `canonicalId`, not `resolvedId`, not a marker's `source`.
 */
import { normalizeUrl } from '@warg/url-normalizer';
import {
  chooseSharedCandidate,
  isValidSharedId,
  TRIGGER_MARKER_SOURCE,
} from '@warg/user-triggers/dist/shared/link.js';

import { linkTargetOf } from './merge.js';

/** Provenance recorded on the markers the re-derive writes. */
export const REDERIVE_MARKER_SOURCE = 'rederive';

/**
 * Marker sources only server code writes. `'merge'` is the duplicate merge's
 * source (`MERGE_MARKER_SOURCE`); a unit test pins the two together, so this
 * module stays free of runner imports.
 */
export const SERVER_MARKER_SOURCES: ReadonlySet<string> = new Set([
  TRIGGER_MARKER_SOURCE,
  'merge',
  REDERIVE_MARKER_SOURCE,
]);

/** The fields of `articles/{id}` the planner reads. */
export interface SharedView {
  readonly id: string;
  readonly url?: string;
  readonly normalizedUrl?: string;
  readonly mergedInto?: string;
  /** The raw document data, for `chooseSharedCandidate` (`created_at`, `mergedInto`). */
  readonly data: Record<string, unknown>;
  readonly hasSuccessArchive: boolean;
}

/** The fields of `users/{uid}/articles/{itemId}` the planner reads. */
export interface ArticleView {
  readonly uid: string;
  /** Hashed user label; the only user name a report may carry. */
  readonly uidLabel: string;
  readonly itemId: string;
  readonly url?: string;
  readonly canonicalId?: string;
  readonly resolvedId?: string;
  readonly deleted: boolean;
}

/** The fields of `users/{uid}/articleMarkers/{key}` the planner reads. */
export interface MarkerView {
  readonly key: string;
  readonly source?: string;
  readonly itemId?: string;
}

export interface UserInput {
  readonly uid: string;
  readonly uidLabel: string;
  readonly articles: readonly ArticleView[];
  readonly markers: readonly MarkerView[];
}

export type Derived =
  | { readonly kind: 'link'; readonly id: string; readonly normalizedUrl: string }
  | { readonly kind: 'create'; readonly id: string; readonly normalizedUrl: string }
  | {
      readonly kind: 'none';
      readonly reason: 'no-url' | 'invalid-id' | 'id-conflict';
      readonly normalizedUrl: string | null;
    };

/** A `canonicalId` write on a user article (phase 2). */
export interface LinkChange {
  readonly uid: string;
  readonly uidLabel: string;
  readonly itemId: string;
  readonly normalizedUrl: string | null;
  /** The shared id the article linked to before (`linkTargetOf`). */
  readonly from: string;
  /** The derived shared id; null for a clear. */
  readonly to: string | null;
  readonly kind: 'add' | 'change' | 'clear';
  /** The old target has a finished archive and the new one has none. */
  readonly archiveLoss: boolean;
}

/** A new shared article, made through the save trigger's link function (phase 1). */
export interface CreatePlan {
  readonly uid: string;
  readonly uidLabel: string;
  readonly itemId: string;
  readonly url: string;
  readonly normalizedUrl: string;
  readonly from: string;
  readonly archiveLoss: boolean;
  /** The article holds a `canonicalId` the link function would stop on; delete it first. */
  readonly clearFirst: boolean;
}

export interface MarkerWrite {
  readonly uid: string;
  readonly uidLabel: string;
  readonly key: string;
  /** The smallest id of the user's articles linked to `key`. */
  readonly itemId: string;
  /** The stored source of a changed marker; null for an add. */
  readonly fromSource: string | null;
}

export interface MarkerRemoval {
  readonly uid: string;
  readonly uidLabel: string;
  readonly key: string;
  readonly source: string | null;
  readonly itemId: string | null;
  /** The removed marker opened a shared article with a finished archive. */
  readonly archiveLoss: boolean;
}

export type Anomaly =
  | { readonly kind: 'no-url'; readonly uidLabel: string; readonly itemId: string }
  | {
      readonly kind: 'invalid-id' | 'id-conflict';
      readonly uidLabel: string;
      readonly itemId: string;
      readonly normalizedUrl: string | null;
    }
  | { readonly kind: 'shared-no-url'; readonly id: string }
  | {
      readonly kind: 'deleted-link-differs';
      readonly uidLabel: string;
      readonly itemId: string;
      readonly canonicalId: string;
      readonly derived: string | null;
    };

export interface UserPlan {
  readonly creates: CreatePlan[];
  readonly linkChanges: LinkChange[];
  readonly markerAdds: MarkerWrite[];
  readonly markerChanges: MarkerWrite[];
  readonly markerRemovals: MarkerRemoval[];
  readonly anomalies: Anomaly[];
  articles: number;
  skippedDeleted: number;
}

export type Plan = UserPlan;

export interface SharedIndex {
  readonly byNormalized: Map<string, SharedView[]>;
  readonly byId: Map<string, SharedView>;
}

function nonBlank(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A user article is deleted when `deletedAt` (or the legacy `deleted_at`) is present and non-null. */
export function isDeleted(data: Record<string, unknown>): boolean {
  return (data['deletedAt'] ?? null) !== null || (data['deleted_at'] ?? null) !== null;
}

/**
 * The duplicate merge must have finished: every shared article with a URL
 * carries its `normalizedUrl`, no normalized URL has two non-stub articles,
 * and every stub names an existing non-stub article.
 */
export function checkPreconditions(shared: readonly SharedView[]): string[] {
  const failures: string[] = [];
  const byId = new Map(shared.map((doc) => [doc.id, doc]));
  const live = new Map<string, string[]>();

  for (const doc of shared) {
    if (nonBlank(doc.url)) {
      const key = normalizeUrl(doc.url);
      if (doc.normalizedUrl !== key) {
        failures.push(`articles/${doc.id} has no current normalizedUrl`);
      }
      if (!nonBlank(doc.mergedInto)) {
        const ids = live.get(key);
        if (ids) ids.push(doc.id);
        else live.set(key, [doc.id]);
      }
    }
    if (nonBlank(doc.mergedInto)) {
      const target = byId.get(doc.mergedInto);
      if (!target || nonBlank(target.mergedInto)) {
        failures.push(`articles/${doc.id} is merged into ${doc.mergedInto}, which is missing or a stub`);
      }
    }
  }
  for (const [key, ids] of [...live].sort(([a], [b]) => compareIds(a, b))) {
    if (ids.length > 1) {
      failures.push(`${key} has ${ids.length} unmerged shared articles: ${ids.sort().join(', ')}`);
    }
  }
  return failures;
}

/** Index shared articles by their stored `normalizedUrl` (the field the trigger queries) and by id. */
export function buildIndex(shared: readonly SharedView[]): SharedIndex {
  const index: SharedIndex = { byNormalized: new Map(), byId: new Map() };
  for (const doc of shared) addToIndex(index, doc);
  return index;
}

/** Add a shared article; the planner adds each planned create, so later articles link to it. */
export function addToIndex(index: SharedIndex, doc: SharedView): void {
  index.byId.set(doc.id, doc);
  if (!nonBlank(doc.normalizedUrl)) return;
  const members = index.byNormalized.get(doc.normalizedUrl);
  if (members) members.push(doc);
  else index.byNormalized.set(doc.normalizedUrl, [doc]);
}

/** The link the save trigger would choose for this URL and item id. */
export function deriveFor(index: SharedIndex, url: string | undefined, itemId: string): Derived {
  if (!nonBlank(url)) return { kind: 'none', reason: 'no-url', normalizedUrl: null };
  const normalizedUrl = normalizeUrl(url);

  const candidates = index.byNormalized.get(normalizedUrl) ?? [];
  const choice = chooseSharedCandidate(candidates.map((doc) => ({ id: doc.id, data: doc.data })));
  if (choice && 'id' in choice) return { kind: 'link', id: choice.id, normalizedUrl };
  if (choice) {
    const target = index.byId.get(choice.followMergedInto);
    if (target && !nonBlank(target.mergedInto)) return { kind: 'link', id: target.id, normalizedUrl };
  }

  if (!isValidSharedId(itemId)) return { kind: 'none', reason: 'invalid-id', normalizedUrl };
  // The trigger links an existing articles/{itemId} only when its URL normalizes
  // the same; after the merge such a doc is already a candidate above.
  if (index.byId.has(itemId)) return { kind: 'none', reason: 'id-conflict', normalizedUrl };
  return { kind: 'create', id: itemId, normalizedUrl };
}

function archiveLossBetween(index: SharedIndex, from: string, to: string | null): boolean {
  if (to !== null && from === to) return false;
  if (!index.byId.get(from)?.hasSuccessArchive) return false;
  return to === null || !index.byId.get(to)?.hasSuccessArchive;
}

function emptyPlan(): UserPlan {
  return {
    creates: [],
    linkChanges: [],
    markerAdds: [],
    markerChanges: [],
    markerRemovals: [],
    anomalies: [],
    articles: 0,
    skippedDeleted: 0,
  };
}

/**
 * Plan one user's changes. Each planned create is added to `index`, so a later
 * article with the same normalized URL (of this or a later user) links to it.
 */
export function planUser(index: SharedIndex, user: UserInput): UserPlan {
  const plan = emptyPlan();
  const { uid, uidLabel } = user;
  const sorted = [...user.articles].sort((a, b) => compareIds(a.itemId, b.itemId));
  const live = sorted.filter((article) => !article.deleted);
  const deleted = sorted.filter((article) => article.deleted);

  const keep = new Set<string>();
  const linkedBy = new Map<string, string[]>();
  const createdKeys = new Set<string>();

  for (const article of live) {
    plan.articles += 1;
    const derived = deriveFor(index, article.url, article.itemId);
    const from = linkTargetOf(article);
    const current = article.canonicalId;

    if (derived.kind === 'none') {
      plan.anomalies.push(
        derived.reason === 'no-url'
          ? { kind: 'no-url', uidLabel, itemId: article.itemId }
          : { kind: derived.reason, uidLabel, itemId: article.itemId, normalizedUrl: derived.normalizedUrl },
      );
      // A marker keyed by this item id is kept only while no shared article
      // sits at that id, where it opens nothing. An id conflict means a shared
      // article with another URL holds the id; the client chose the item id, so
      // nothing proves that article is the user's own, and its marker is
      // removed (flagged archiveLoss when it has a finished archive). The
      // anomaly row lists it for the person reviewing the dry run.
      if (derived.reason !== 'no-url' && !index.byId.has(article.itemId)) {
        keep.add(article.itemId);
      }
      if (nonBlank(current)) {
        plan.linkChanges.push({
          uid,
          uidLabel,
          itemId: article.itemId,
          normalizedUrl: derived.normalizedUrl,
          from,
          to: null,
          kind: 'clear',
          archiveLoss: archiveLossBetween(index, from, null),
        });
      }
      continue;
    }

    keep.add(derived.id);
    const linked = linkedBy.get(derived.id);
    if (linked) linked.push(article.itemId);
    else linkedBy.set(derived.id, [article.itemId]);

    if (derived.kind === 'create') {
      plan.creates.push({
        uid,
        uidLabel,
        itemId: article.itemId,
        url: article.url!,
        normalizedUrl: derived.normalizedUrl,
        from,
        archiveLoss: archiveLossBetween(index, from, derived.id),
        clearFirst: nonBlank(current),
      });
      createdKeys.add(derived.id);
      addToIndex(index, {
        id: derived.id,
        url: article.url,
        normalizedUrl: derived.normalizedUrl,
        data: {},
        hasSuccessArchive: false,
      });
      continue;
    }

    if (current === derived.id) continue;
    plan.linkChanges.push({
      uid,
      uidLabel,
      itemId: article.itemId,
      normalizedUrl: derived.normalizedUrl,
      from,
      to: derived.id,
      kind: nonBlank(current) ? 'change' : 'add',
      archiveLoss: archiveLossBetween(index, from, derived.id),
    });
  }

  // Deleted articles get no write; their derived keys still keep their markers.
  for (const article of deleted) {
    plan.skippedDeleted += 1;
    const derived = deriveFor(index, article.url, article.itemId);
    const derivedId = derived.kind === 'none' ? null : derived.id;
    if (derivedId !== null) keep.add(derivedId);
    if (nonBlank(article.canonicalId) && article.canonicalId !== derivedId) {
      plan.anomalies.push({
        kind: 'deleted-link-differs',
        uidLabel,
        itemId: article.itemId,
        canonicalId: article.canonicalId,
        derived: derivedId,
      });
    }
  }

  const markers = new Map(user.markers.map((marker) => [marker.key, marker]));
  for (const [key, itemIds] of [...linkedBy].sort(([a], [b]) => compareIds(a, b))) {
    // The link function writes the marker of a created shared article itself.
    if (createdKeys.has(key)) continue;
    const itemId = [...itemIds].sort(compareIds)[0]!;
    const existing = markers.get(key);
    if (!existing) {
      plan.markerAdds.push({ uid, uidLabel, key, itemId, fromSource: null });
      continue;
    }
    const serverOwned = nonBlank(existing.source) && SERVER_MARKER_SOURCES.has(existing.source);
    const ownedByLinked = nonBlank(existing.itemId) && itemIds.includes(existing.itemId);
    if (!serverOwned || !ownedByLinked) {
      plan.markerChanges.push({ uid, uidLabel, key, itemId, fromSource: existing.source ?? null });
    }
  }

  for (const marker of [...user.markers].sort((a, b) => compareIds(a.key, b.key))) {
    if (keep.has(marker.key)) continue;
    plan.markerRemovals.push({
      uid,
      uidLabel,
      key: marker.key,
      source: marker.source ?? null,
      itemId: marker.itemId ?? null,
      archiveLoss: index.byId.get(marker.key)?.hasSuccessArchive === true,
    });
  }

  return plan;
}

/** Plan every user, in sorted uid order, so the plan is the same on every run. */
export function planAll(shared: readonly SharedView[], users: readonly UserInput[]): Plan {
  const index = buildIndex(shared);
  const plan = emptyPlan();
  for (const doc of shared) {
    if (!nonBlank(doc.url)) plan.anomalies.push({ kind: 'shared-no-url', id: doc.id });
  }
  for (const user of [...users].sort((a, b) => compareIds(a.uid, b.uid))) {
    const userPlan = planUser(index, user);
    plan.creates.push(...userPlan.creates);
    plan.linkChanges.push(...userPlan.linkChanges);
    plan.markerAdds.push(...userPlan.markerAdds);
    plan.markerChanges.push(...userPlan.markerChanges);
    plan.markerRemovals.push(...userPlan.markerRemovals);
    plan.anomalies.push(...userPlan.anomalies);
    plan.articles += userPlan.articles;
    plan.skippedDeleted += userPlan.skippedDeleted;
  }
  return plan;
}
