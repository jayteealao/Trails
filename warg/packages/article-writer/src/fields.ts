import type { FieldValue, Timestamp } from 'firebase-admin/firestore';

// The field names the cloud functions write on the shared article and the user
// article. They match the "Articles document fields" table of
// shared-types/WargMetadata.md, which the tests of this package check. A dotted
// name is a field of a map.

/** The fields of the shared article's `pocket` map. */
export const POCKET_FIELDS = ['favorite', 'resolved_id', 'status', 'time_added', 'time_read'] as const;

/** The fields of the shared article's `stats` map. */
export const STATS_FIELDS = ['last_accessed', 'total_saves', 'total_views', 'last_saved_at'] as const;

/** Every field the server writes on `articles/{id}`. */
export const SHARED_ARTICLE_FIELDS = [
  'item_id',
  'url',
  'normalizedUrl',
  'domain',
  'created_at',
  'updated_at',
  'status',
  'archives',
  'pocket',
  ...POCKET_FIELDS.map((f) => `pocket.${f}` as const),
  'stats',
  ...STATS_FIELDS.map((f) => `stats.${f}` as const),
  'warg_request_id',
  'processing_started_at',
  'error',
  'failed_at',
] as const;

/** Every field the server writes on `users/{uid}/articles/{id}`. */
export const USER_ARTICLE_FIELDS = ['canonicalId', 'resolvedId', 'archival_triggered', 'error', 'error_at'] as const;

export type PocketField = (typeof POCKET_FIELDS)[number];
export type StatsField = (typeof STATS_FIELDS)[number];
export type SharedArticleField = (typeof SHARED_ARTICLE_FIELDS)[number];
export type UserArticleField = (typeof USER_ARTICLE_FIELDS)[number];

/** A value stored as one field: a Firestore sentinel or timestamp is not a map to look into. */
type Leaf = Timestamp | FieldValue | readonly unknown[];

/**
 * The field names a patch writes, a map's fields as dotted names:
 * `{ stats: { total_saves: 1 } }` writes `stats` and `stats.total_saves`.
 */
export type FlattenKeys<T> = {
  [K in keyof T & string]-?: NonNullable<T[K]> extends Leaf
    ? K
    : NonNullable<T[K]> extends object
      ? [keyof NonNullable<T[K]>] extends [never]
        ? K
        : K | `${K}.${FlattenKeys<NonNullable<T[K]>>}`
      : K;
}[keyof T & string];

/** `true` when every field name of patch `T` is one of `Allowed`, else the names that are not. */
export type OnlyFields<T, Allowed extends string> = [Exclude<FlattenKeys<T>, Allowed>] extends [never]
  ? true
  : Exclude<FlattenKeys<T>, Allowed>;

/** Fails the compile unless `T` is `true`; used as `type _Check = Expect<OnlyFields<Patch, Field>>`. */
export type Expect<T extends true> = T;
