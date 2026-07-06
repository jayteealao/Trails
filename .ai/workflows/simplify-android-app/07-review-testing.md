---
schema: sdlc/v1
type: review-command
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
review-command: testing
status: complete
updated-at: "2026-07-06T02:00:00Z"
metric-findings-total: 2
metric-findings-blocker: 0
metric-findings-high: 0
metric-findings-resolved: 0
result: issues-found
tags: []
refs:
  review-master: 07-review.md
---

# Review: testing

## Findings

| ID | Sev | Conf | Status | Surfaced | File:Line | Issue |
|----|-----|------|--------|----------|-----------|-------|
| TE-1 | LOW | High | open | 2026-07-06 | `FirestoreSyncManagerTest.kt` | Missing bulk-DAO test for CR-1 fix path (getTagsForArticles not yet added) |
| TE-2 | NIT | Med | open | 2026-07-06 | `ArticleDao.kt:291-302` | deleteAllTagsForArticle atomicity window documented but untested |

## Detailed Findings

### TE-1: Bulk DAO Tag Fetch Test Missing [LOW]

**Location:** `android/app/src/test/java/com/jayteealao/trails/services/firestore/FirestoreSyncManagerTest.kt`

**Issue:** The fix for CR-1 (adding `getTagsForArticles(itemIds)` bulk DAO method) will require a new test asserting that only one DAO call is made per chunk, not N calls. This test does not yet exist because the method itself is not yet added. This is a forward-looking gap tied to CR-1 fix.

**Severity:** LOW | **Confidence:** High
**Status:** open | **Surfaced:** 2026-07-06

---

### TE-2: deleteAllTagsForArticle Atomicity Window Untested [NIT]

**Location:** `android/app/src/main/java/com/jayteealao/trails/data/local/database/ArticleDao.kt:291-302`

**Issue:** The KDoc on `deleteAllTagsForArticle` documents a transient window where an article has no tags between delete and insert (not wrapped in `@Transaction`). This is accepted as safe for the background-only sync path, but no test verifies the documented constraint or the "delete then insert" ordering. Low risk in practice.

**Severity:** NIT | **Confidence:** Med
**Status:** open | **Surfaced:** 2026-07-06

---

## Summary
- Open findings: 2 (LOW: 1, NIT: 1)
- Open blockers: 0
- Status: Issues Found (LOW/NIT only — ship not blocked)

## Overall Assessment

Test coverage is strong for this branch. 143/143 tests pass. New behaviors all have corresponding tests:
- `AppScopeIsolationTest` — supervised scope isolation
- `FirestoreBackupServiceTest` — backup service correctness
- `FirestoreSyncManagerTest` — sync manager behavior including reconcile
- `FirestoreSyncManagerReconcileTest` — reconcile sweep
- `SyncWorkerTest` — pagination loop and join-based wait
- `DefaultArticleRepositoryTest` — repository interface
- `ArticleDetailViewModelTest` — ViewModel state
- `ArticleListViewModelTest` — list ViewModel
- `UrlNormalizerTest` — URL normalization including Article extension
- `FtsSearchTest` — FTS query sanitization bug fix
