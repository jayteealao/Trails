---
schema: sdlc/v1
type: review-command
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
review-command: reliability
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

# Review: reliability

## Findings

| ID | Sev | Conf | Status | Surfaced | File:Line | Issue |
|----|-----|------|--------|----------|-----------|-------|
| RE-1 | MED | Med | open | 2026-07-06 | `FirestoreSyncManager.kt:476-479` | performFullSync outer catch does not re-throw CancellationException |
| RE-2 | LOW | Med | open | 2026-07-06 | `FirestoreSyncManager.kt:538-542` | reconcileNeverBackedUpArticles early-exits on first chunk failure |

## Detailed Findings

### RE-1: CancellationException Not Re-thrown in performFullSync [MED]

**Location:** `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt:476-479`

**Evidence:**
```kotlin
} catch (e: Exception) {
    Timber.e(e, "Full sync failed: ${e.message}")
    _lastError.value = e.message ?: "Full sync failed"
    _syncStatus.value = SyncStatus.Error(e.message ?: "Unknown error", e)
}
```

**Issue:** Kotlin coroutine structured concurrency requires that `CancellationException` be re-thrown so the coroutine cancellation propagates correctly. Catching `Exception` (rather than a non-cancellation base class) without first checking for `CancellationException` can suppress cancellation. In a `SupervisorJob` scope this is less critical, but it violates Kotlin coroutines best practice and may cause subtle bugs if the scope transitions.

**Fix:** Add `if (e is CancellationException) throw e` as the first statement in the `catch (e: Exception)` block.

**Severity:** MED | **Confidence:** Med
**Status:** open | **Surfaced:** 2026-07-06

---

### RE-2: reconcileNeverBackedUpArticles Stops on First Chunk Failure [LOW]

**Location:** `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt:538-542`

**Evidence:**
```kotlin
onFailure = { e ->
    Timber.w(e, "reconcile: backup failed for chunk at offset $offset, stopping sweep")
    return
}
```

**Issue:** A transient network error for one chunk silently stops the reconcile sweep. Subsequent never-backed-up articles are not processed until the next periodic sync cycle. This could leave articles stranded for up to 15 minutes after a transient failure.

**Fix:** Log the failure, increment offset by `RECONCILE_CHUNK_SIZE`, and continue rather than returning early. Track total failures and log them at the end.

**Severity:** LOW | **Confidence:** Med
**Status:** open | **Surfaced:** 2026-07-06

---

## Summary
- Open findings: 2 (MED: 1, LOW: 1)
- Open blockers: 0
- Status: Issues Found (no blockers; MED is fixable in-place)

## Positive reliability improvements
- `SyncWorker` delay-poll replaced with `syncJob.join()` + `withTimeout(30_000L)` — deterministic
- `restoreAllArticlesPaginated` re-throws `CancellationException` correctly
- `reconcileNeverBackedUpArticles` provides a safety net for offline-save stranding
- Paginated processing throughout prevents OOM
