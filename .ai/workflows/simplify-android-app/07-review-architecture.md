---
schema: sdlc/v1
type: review-command
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
review-command: architecture
status: complete
updated-at: "2026-07-06T02:00:00Z"
metric-findings-total: 1
metric-findings-blocker: 0
metric-findings-high: 0
metric-findings-resolved: 0
result: issues-found
fragment: none
tags: []
refs:
  review-master: 07-review.md
---

# Review: architecture

## Findings

| ID | Sev | Conf | Status | Surfaced | File:Line | Issue |
|----|-----|------|--------|----------|-----------|-------|
| AR-1 | NIT | Low | open | 2026-07-06 | `FirestoreSyncManager.kt:1-59` | SyncManager still holds direct firestore/auth refs despite BackupService being the intended facade |

## Summary

Architecture is improved across the board:

- **@ApplicationScope** correctly centralizes coroutine lifetime; no consumer can accidentally cancel the shared scope.
- **withAuthenticatedUser** helper centralizes the auth guard into `FirestoreBackupService`; all public methods that require auth use it.
- **addArticleToBatch** is the single write path for article + large-text branch + tags — eliminates prior duplication between backup and sync paths.
- **getUserMetaSnapshot** reduces `isFirstSync + lastSyncTimestamp` from two Firestore reads to one.
- **Architecture docs** written for `app-scope-di.md`, `batched-tag-reads.md`, `firestore-sync-backup.md` — all three major system areas documented.
- **Hilt DI graph** is consistent: no manual `Firebase.getInstance()` calls remain in `ArticleRepositoryImpl` (now injected).

One NIT: `FirestoreSyncManager` still injects `firestore: FirebaseFirestore` and `auth: FirebaseAuth` directly alongside `firestoreBackupService`. In the target architecture, the Firestore facade is `FirestoreBackupService`, and these direct handles are a layering leak. However, they are used only for `auth.currentUser` checks and are not otherwise used for Firestore operations — acceptable for the current scope.
