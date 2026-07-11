---
schema: sdlc/v1
type: announce
slug: simplify-android-app
created-at: "2026-07-11T01:45:00Z"
audiences: [eng, product, users]
channels: [github-release]
docs-generated: []
refs:
  index: 00-index.md
  ship-run: 09-ship-run-20260711T0112Z.md
  handoff: 08-handoff.md
---

# Announcements: Trails v1.10.24

## Engineering

**Subject:** [Shipped] Trails v1.10.24 — sync/backup overhaul, archive read-back fix, FTS search fix

**What shipped.** v1.10.24 merges two workstreams: a 15-slice Android cleanup (sync/backup path, DI scoping, list rendering, sync worker) and the fix for the Firestore two-lock deadlock that kept freshly-saved articles from showing archives. Signed APK + AAB are on the [v1.10.24 release](https://github.com/jayteealao/Trails/releases/tag/v1.10.24); the Firestore rules change deployed to `trails-e428e` on merge.

**Technical details.**
- *Archive read-back:* the marker-create rule was relaxed (enumeration stays blocked), listeners got bounded self-heal recovery (thread-safe via AtomicInteger), the per-user marker is now written inline at save time, and a reconciliation sweep (with stall guard) catches stragglers.
- *Sync/backup:* restore now streams pages straight to Room (constant memory instead of whole-library accumulation); tag reads are chunked/batched (sub-N+1 read counts); backup batches are chunked by queued write count; sync/backup duplication collapsed to single sources; `ArticleRepository.add` is transactional.
- *DI:* ad-hoc coroutine scopes replaced with one shared supervised app scope, injected for testability.
- *List rendering:* dead gradient/palette pipeline removed, snippet parse cached.
- *FTS:* `searchWithScore` now routes the sanitized query to the DAO (search was silently broken for special characters).
- Architecture docs: `docs/architecture/firestore-sync-backup.md`, `app-scope-di.md`, `batched-tag-reads.md`.

**Migration / breaking changes.** None. Room migrations are auto-applied; Firestore schema untouched (rules-only change).

**Rollout.** Immediate, both surfaces live: rules released 01:30Z, GitHub Release published 01:38Z. No Warg deploy this release.

**Rollback.** Delete/mark the release pre-release and re-tag v1.10.23 (prior artifacts remain downloadable); rules can be reverted by redeploying the prior `firestore.rules` from main~1 (`firebase deploy --only firestore:rules`). ~15 min.

**Known limitations.** On-device validation (memory profile of a large restore, live sync observation, archives-panel visual check) is still owed — it was accepted as a release risk because JVM/emulator coverage is strong (143 unit tests + rules-emulator tests). Run the device smokes when a device session is available.

**Links.** [PR #29](https://github.com/jayteealao/Trails/pull/29) · [Release](https://github.com/jayteealao/Trails/releases/tag/v1.10.24) · [Release workflow run](https://github.com/jayteealao/Trails/actions/runs/29134719220)

## Product

**Subject:** Saved articles now show their archives immediately — plus faster, leaner sync

**What's new.** The most-reported annoyance — saving an article and finding its archives panel empty — is fixed at the root. Alongside it, this release makes sync noticeably cheaper and more reliable for large libraries, and fixes full-text search ranking.

**Why this matters.** Archives are the product's core promise: save it, and a permanent copy exists. A race between two background writes meant new saves often couldn't *display* those archives until much later. That race is gone, with a self-healing fallback if anything still slips through.

**Impact.** Every user who saves articles benefits on first open of a new save. Users with large libraries get faster restores that no longer hold the whole library in memory, and fewer backend reads per sync (lower Firestore cost).

**Timeline.** Live now — backend rules are deployed and v1.10.24 is available for download.

**What's next.** On-device verification passes for the sync and rendering changes; dependency refreshes (OkHttp/Okio hardening) queued for a future release.

## Users

**Your saved articles now show their archives right away**

Previously, a freshly-saved article could show an empty archives panel until a background sync caught up — sometimes much later. That's fixed: archives appear as soon as they're ready, and the app now recovers automatically if anything gets stuck.

Also in this update: search results rank properly again, syncing large libraries is faster and uses less memory, and the article list scrolls a little smoother.

Update: download v1.10.24 from the [releases page](https://github.com/jayteealao/Trails/releases/tag/v1.10.24). Your library and settings carry over automatically.

Found something off? Report it on the [issues page](https://github.com/jayteealao/Trails/issues).

---

*Generated from workflow `simplify-android-app` artifacts. Edit as needed before sending.*
