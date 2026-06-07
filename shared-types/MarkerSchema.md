# Canonical schema: `users/{uid}/articleMarkers/{key}`

Per-user article-existence markers. One marker doc is written for every saved
article key (its `itemId`, plus `resolvedId` when present and distinct). The
tightened top-level `articles` read rule — a later, separately deployed change —
gates a read on the existence of a matching marker, so every stack that creates
markers must agree on the path and field names.

Enforced by `shared-types/check-drift.ts`, which runs in CI.

## Path

```
users/{uid}/articleMarkers/{key}
```

`{key}` is the article key the marker covers (`itemId` or `resolvedId`); it
also mirrors the marker doc's `key` field.

## Firestore field names

These are the literal Firestore document field names. **Renaming any of these
requires updating every producer and the rules/tests in the same commit.**

| Field       | Type                  | Producer(s) | Notes |
| ----------- | --------------------- | ----------- | ----- |
| `key`       | string                | required    | The article key this marker covers (mirrors the doc id). |
| `createdAt` | timestamp             | required    | Server timestamp; markers are merge-written, so this carries last-write (not first-seen) semantics — acceptable for existence markers. |
| `source`    | string                | required    | Provenance: `sync` \| `self-heal` \| `backfill`. |

## Producers

- **Trails (Android)** — `FirestoreBackupService` writes a marker for every
  article key on backup (`source: "sync"`) and on read-denial self-heal
  (`source: "self-heal"`), via the `ARTICLE_MARKERS_COLLECTION` constant.
  [`android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreBackupService.kt`](../android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreBackupService.kt)
- **Warg backfill (planned)** — a one-off Admin SDK backfill writes the same
  docs with `source: "backfill"` for historical articles.

## Consumer

The tightened `articles` read rule — a later, separately deployed change — will check
`exists(/databases/$(database)/documents/users/$(uid)/articleMarkers/$(itemId))`.
A single `exists()` covers whichever key a reader passes, because a marker is
written for every key.

## Adding or changing a field

1. Update the table above.
2. Update `markerBody(...)` and the `ARTICLE_MARKERS_COLLECTION` constant in
   `FirestoreBackupService.kt`.
3. Update the Warg backfill writer when it is added.
4. Update `firebase/firestore.rules` and `firebase/test/firestore-rules.test.ts`.
5. Run `node --experimental-strip-types shared-types/check-drift.ts` locally.
