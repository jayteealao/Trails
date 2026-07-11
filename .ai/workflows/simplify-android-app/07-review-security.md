---
schema: sdlc/v1
type: review-command
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
review-command: security
status: complete
updated-at: "2026-07-10T23:42:20Z"
metric-findings-total: 1
metric-findings-blocker: 0
metric-findings-high: 0
metric-findings-pre-existing: 1
metric-findings-resolved: 0
result: issues-found
tags: []
refs:
  review-master: 07-review.md
---

# Review: security

## Findings

| ID | Sev | Conf | Status | Pre | Surfaced | File:Line | Issue |
|----|-----|------|--------|-----|----------|-----------|-------|
| SE-1 | MED | High | fixed | true | 2026-07-06 | `firebase/firestore.rules:51-65` | Firestore marker fallback `get(articles/{itemId})` widens proof surface — FIXED: SECURITY NOTE comment added |
| SE-2 | LOW | Med | open | true | 2026-07-06 | `FirestoreBackupService.kt:517` | `batchRestoreArticleTags` returns `emptyMap()` silently on unauthenticated; callers receive empty tags with no error signal |

## Detailed Findings

### SE-1: Firestore Marker Rule Fallback Widens Proof Surface [MED] — FIXED

**Location:** `firebase/firestore.rules:51-65`

**Evidence:**
```
// SECURITY NOTE (review SE-1): The `get(articles/{itemId})` fallback's safety
// depends on the top-level `articles` collection being non-enumerable by clients.
// If that collection ever becomes client-readable/listable, any authenticated user
// who learns a top-level article ID could write a marker for that ID in their own
// namespace — enabling phantom markers. The current `allow list: false` on the
// top-level article read rules MUST re-evaluate this fallback's threat model.
```

**Issue:** The `get(/databases/$(database)/documents/articles/$(request.resource.data.itemId))` fallback in the `articleMarkers` create/update rule allowed any authenticated user who knows a top-level article ID to write a marker in their own namespace (not another user's), enabling phantom markers if the top-level `articles` collection were enumerable.

**Fix:** A SECURITY NOTE comment was added to `firebase/firestore.rules` (lines 51-65) documenting that the fallback's safety depends on the top-level `articles` collection being non-enumerable (`allow list: false` enforces this today). Future rule authors relaxing those read rules must re-evaluate this threat model before doing so.

**Severity:** MED | **Confidence:** High | **Pre-existing:** true
**Status:** fixed | **Surfaced:** 2026-07-06 | **Last seen:** 2026-07-10 | **Fixed:** 2026-07-06T02:04:08Z

---

### SE-2: batchRestoreArticleTags Silent Empty on Unauthenticated [LOW]

**Location:** `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreBackupService.kt:517`

**Evidence:**
```kotlin
suspend fun batchRestoreArticleTags(
    articleIds: List<String>
): Map<String, List<ArticleTags>> {
    if (articleIds.isEmpty()) return emptyMap()
    val user = getCurrentUser() ?: return emptyMap()   // ← line 517: silent empty
    // ...
}
```

**Issue:** When the user is not authenticated, `batchRestoreArticleTags` returns `emptyMap()` silently with no log or error signal. Callers in `applyRemoteArticles` proceed to write articles with zero tags — data is silently incomplete. A KDoc comment was added this cycle (`Returns an empty map when [articleIds] is empty or the user is unauthenticated`) that documents the behaviour, but the silent-empty path itself is unchanged. The defect is unlikely to trigger in practice: `applyRemoteArticles` is only called from paginated restore which upstream-guards on authentication. However, the silent contract could mislead future callers that do not have an upstream auth guard.

**Fix:** Return a distinct failure signal — either `Result<Map<…>>` returning `Result.failure(…)` when unauthenticated, or throw (callers should catch). Minimum acceptable: add `Timber.w("batchRestoreArticleTags called unauthenticated")` so the path is detectable in logs if it fires.

**Severity:** LOW | **Confidence:** Med | **Pre-existing:** true
**Status:** open | **Surfaced:** 2026-07-06 | **Last seen:** 2026-07-10

---

## Summary
- Open findings: 1 (pre-existing: 1)
- Open blockers: 0 (pre-existing excluded from verdict)
- Findings fixed this cycle: 0 (SE-1 was fixed in prior session 2026-07-06)
- Status: Issues Found
