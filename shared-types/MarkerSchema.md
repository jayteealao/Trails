# Canonical schema: `users/{uid}/articleMarkers/{key}`

Per-user article-access markers. A marker at `users/{uid}/articleMarkers/{key}`
lets that user read the shared article `articles/{key}`. The marker is
**server-owned**: the server decides which shared article a user's article links
to, writes the marker for it, and records the link on the user's article in the
server-owned `canonicalId` field (see [Server-owned link fields](#server-owned-link-fields)).
The app never writes markers.

Enforced by `shared-types/check-drift.ts`, which runs in CI.

## Path

```
users/{uid}/articleMarkers/{key}
```

`{key}` is the shared article id the marker covers (the `canonicalId` of the
user's article); it also mirrors the marker doc's `key` field.

## Firestore field names

These are the literal Firestore document field names. **Renaming any of these
requires updating every producer and the rules/tests in the same commit.**

| Field       | Type                  | Required | Notes |
| ----------- | --------------------- | -------- | ----- |
| `key`       | string                | required | The shared article id this marker covers (mirrors the doc id). |
| `itemId`    | string                | required | The doc id of the user's own article at `users/{uid}/articles/{itemId}` that links to the shared article. |
| `createdAt` | timestamp             | required | Server timestamp; markers are merge-written, so this carries last-write (not first-seen) semantics — acceptable for access markers. |
| `source`    | string                | required | Provenance of the write: `trigger` for the marker the user-article trigger writes when it links a new user article; `backfill` for server writes; `merge` for a marker the duplicate merge adds for the surviving shared article; `rederive` for a marker the link re-derive writes for an existing user article. `sync` and `self-heal` are legacy sources, written by older app builds. |

## Server-owned link fields

Fields that link a user's article to a shared article. Only the server writes
them (Admin SDK); the rules refuse client writes to `canonicalId`.

| Field         | Lives on                          | Notes |
| ------------- | --------------------------------- | ----- |
| `canonicalId` | `users/{uid}/articles/{itemId}`   | The shared article id (`articles/{canonicalId}`) the server linked this user article to. The app reads it live from Firestore when it opens an article and falls back to its own `itemId` while the field is absent. It is never an app model or local-database field, and the app's backup never writes it. |
| `mergedInto`  | `articles/{id}`                   | Set on a shared article that was merged into another as a duplicate; names the surviving shared article. A reader that finds it follows it once. |

## Grace period for older app builds

Older app builds still try to write markers. For a fixed grace period after the
rules release, the rules accept an app-written marker only when its key equals
the user article's server-written `canonicalId`; after it, every client marker
write is refused. The end of the grace period is a timestamp literal in
`firebase/firestore.rules`, stamped by the deploy script at the first rules
deploy. This document does not hold the date.

## Producers

- **Warg backfill** — the Admin-SDK `@warg/backfill-scripts` package writes
  markers with `source: "backfill"`, using the shared `ARTICLE_MARKERS_COLLECTION`
  constant and `markerBody`.
  [`warg/cloud-functions/backfill-scripts/src/keys.ts`](../warg/cloud-functions/backfill-scripts/src/keys.ts)
- **Duplicate merge** — the same package's merge pass writes the marker for the surviving shared article with `source: "merge"`, through the same `markerBody` in `keys.ts`.
- **Link re-derive** — the same package's re-derive pass writes markers with `source: "rederive"` through the same `markerBody` in `keys.ts`, and creates a missing shared article (with its marker) through the save trigger's link function in `link.ts`.
- **Warg user-article trigger** — writes the marker keyed by `canonicalId` with
  `source: "trigger"` in the same transaction that writes `canonicalId`.
  [`warg/cloud-functions/user-triggers/src/link.ts`](../warg/cloud-functions/user-triggers/src/link.ts)
- **Trails (Android)** — not a producer. The app writes no marker and no
  `canonicalId`; its backup also leaves the server's `resolvedId` alone.

## Consumer

- The `articles` read rule checks
  `exists(/databases/$(database)/documents/users/$(uid)/articleMarkers/$(id))`,
  so a user reads a shared article only through a marker the server wrote.
- **Trails (Android)** — `ArchiveService` reads `canonicalId` from
  `users/{uid}/articles/{itemId}` and then reads `articles/{canonicalId}`
  (or `articles/{itemId}` while the field is absent).
  [`android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt`](../android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt)

## Adding or changing a field

1. Update the tables above.
2. Update `markerBody` and the `ARTICLE_MARKERS_COLLECTION` constant in
   `warg/cloud-functions/backfill-scripts/src/keys.ts`, and every other server
   producer listed under Producers.
3. Update `firebase/firestore.rules` and `firebase/test/firestore-rules.test.ts`.
4. For a link field, update the app reader in `ArchiveService.kt`; never add it
   to the app's `Article` model.
5. Run `node --experimental-strip-types shared-types/check-drift.ts` locally.
