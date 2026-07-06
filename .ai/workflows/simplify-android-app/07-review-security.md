---
schema: sdlc/v1
type: review-command
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
review-command: security
status: complete
updated-at: "2026-07-06T01:44:38Z"
metric-findings-total: 2
metric-findings-blocker: 0
metric-findings-high: 0
metric-findings-resolved: 0
result: issues-found
tags: []
refs:
  review-master: 07-review.md
---

# Review: security

## Findings

| ID | Sev | Conf | Status | Surfaced | File:Line | Issue |
|----|-----|------|--------|----------|-----------|-------|
| SE-1 | MED | High | open | 2026-07-06 | `firestore.rules:58-66` | Firestore marker rule fallback `get(articles/{itemId})` allows any Warg-known article to be used as proof of ownership — unauthenticated path if top-level articles/{itemId} is client-readable |
| SE-2 | LOW | Med | open | 2026-07-06 | `FirestoreBackupService.kt:511` | `batchRestoreArticleTags` returns `emptyMap()` silently on unauthenticated — callers receive empty tags without an error signal |

## Detailed Findings

### SE-1: Firestore Marker Rule Fallback Widens Proof Surface [MED]

**Location:** `firebase/firestore.rules:58-66`

**Evidence:**
```
allow create, update: if isOwner(userId)
  && request.resource.data.itemId is string
  && (
    getAfter(…/articles/$(request.resource.data.itemId)).data != null
    || get(/databases/$(database)/documents/articles/$(request.resource.data.itemId)) != null
  );
```

**Issue:** The fallback `get(articles/{itemId})` references the top-level `articles` collection (Warg backend-written). If that collection's read rules allow unauthenticated/any-authenticated access — or if they are overly permissive — then any user who knows an article ID from the top-level collection could write a marker referencing that ID. The comment says "the top-level `articles` collection rejects all client writes" but read access is not restricted to the article owner. This is an enumeration-adjacent concern: if an attacker can guess or enumerate top-level article IDs, they can create markers for those IDs in their own namespace. Impact is limited to their own marker namespace, but it could enable phantom markers.

**Mitigation check:** Review `match /articles/{articleId}` rule's read permission. If read is restricted to authenticated users with no ownership check, the risk is that any authenticated user can probe whether any article ID exists (by attempting to write a marker). This is low-severity but worth documenting.

**Fix:** Add a comment in the rules documenting that the fallback's safety depends on `articles/{articleId}` being unreadable or unguessable by non-owners. Optionally add an existence check that the marker's `itemId` matches a verified ownership path.

**Severity:** MED | **Confidence:** High
**Status:** open | **Surfaced:** 2026-07-06 | **Last seen:** 2026-07-06

---

### SE-2: batchRestoreArticleTags Silent Empty on Unauthenticated [LOW]

**Location:** `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreBackupService.kt:511`

**Evidence:**
```kotlin
suspend fun batchRestoreArticleTags(
    articleIds: List<String>
): Map<String, List<ArticleTags>> {
    if (articleIds.isEmpty()) return emptyMap()
    val user = getCurrentUser() ?: return emptyMap()
    …
}
```

**Issue:** When the user is not authenticated, `batchRestoreArticleTags` returns an empty map silently. The caller in `applyRemoteArticles` proceeds to write articles with no tags — data will be silently incomplete. Since `applyRemoteArticles` is only called from within paginated restore which itself checks authentication, this is unlikely to trigger in practice. However, the silent-empty contract could mislead future callers.

**Fix:** Return a distinct failure signal or throw (callers should catch), or document the unauthenticated-returns-empty contract explicitly in KDoc.

**Severity:** LOW | **Confidence:** Med
**Status:** open | **Surfaced:** 2026-07-06 | **Last seen:** 2026-07-06

---

## Summary
- Open findings: 2 (resolved this run: 0)
- Open blockers: 0
- Status: Issues Found
