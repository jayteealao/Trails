---
schema: sdlc/v1
type: implement
slug: simplify-android-app
slice-slug: test-net
status: complete
stage-number: 5
created-at: "2026-06-18T22:04:03Z"
updated-at: "2026-06-18T22:04:03Z"
metric-files-changed: 5
metric-lines-added: 489
metric-lines-removed: 42
metric-deviations-from-plan: 3
metric-review-fixes-applied: 0
commit-sha: "e2538b7"
tags: [test-infra, characterization, android]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
  slice-def: 03-slice-test-net.md
  plan: 04-plan-test-net.md
  siblings: []
  verify: 06-verify-test-net.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app test-net"
---

# Implement: Regression net — revive test infra + Firestore characterization

## Summary of Changes
Stood up a green, test-only safety net before any refactor lands. Revived the two
disabled test-infra files (E1) and pinned the current behaviour of the Firestore
sync/backup layer with characterization tests, so the dependent dedup/restore
refactors can be proven behaviour-preserving. **No production runtime code changed.**

Outcome: `:app:testDebugUnitTest` green for all three target classes (**23 tests:
1 + 15 + 7, 0 failures**) and `:app:assembleDebugAndroidTest` builds (the revived
Hilt test module compiles and its component graph is valid).

## Files Changed
- `android/app/src/test/.../data/DefaultArticleRepositoryTest.kt` — replaced the
  stale commented stub (referencing a deleted `DefaultArticleRepository`/`FakePocketDao`)
  with a MockK test of the real `ArticleRepositoryImpl.pockets()` delegating to
  `ArticleDao.getArticlesWithTags()`. 1 passing test.
- `android/app/src/androidTest/.../testdi/TestDatabaseModule.kt` — revived as an
  `@TestInstallIn` module providing an in-memory Room `AppDatabase` + `ArticleDao` +
  `LocalArchiveDao` for instrumented tests.
- `android/app/src/test/.../services/firestore/FirestoreBackupServiceTest.kt` —
  promoted the fixture's collection/doc refs to fields and added 7 characterization
  tests: per-`WRITE_BATCH_LIMIT` (20) chunking, large-text→subcollection vs inline,
  restore auth-guard, `isFirstSync`, `getLastSyncTimestamp`, and paginated-restore
  page accumulation. The 8 pre-existing marker tests are unchanged and still green.
- `android/app/src/test/.../services/firestore/FirestoreSyncManagerTest.kt` — **new.**
  7 characterization tests: auth-guard on `syncLocalChanges`/`performFullSync`, the
  per-article N+1 tag-backup batch, conflict resolution (`shouldAcceptRemoteChange`,
  via reflection), and first-sync strategy dispatch (restore + no-data scenarios).
- `android/app/build.gradle.kts` — removed the redundant `kaptAndroidTest`/`kaptTest`
  Hilt-compiler registrations (build config only — see Deviations).

## Shared Files (also touched by sibling slices)
- None. This is the first slice implemented; no `05-implement-*.md` siblings exist yet.

## Notes on Design Choices
- **Real `Article` instances** are used where `.copy()`/`.toByteArray()` semantics
  matter (large-text split, chunk counting); relaxed `Article` mocks remain only in
  the pre-existing marker tests.
- **Reflection for `shouldAcceptRemoteChange`** — it is a pure `private` function, so
  reflection pins the exact timestamp + completeness-score tie-break without forcing a
  visibility change to production code. The plan anticipated this.
- **Quirks pinned AS-IS, not fixed:** the N+1 per-article tag batch and the
  in-memory page accumulation in `restoreAllArticlesPaginated` are asserted as the
  current behaviour with inline comments marking what `firestore-dedup` /
  `streaming-restore` will later change.
- `schedulePeriodicSync()` / `cancelPeriodicSync()` are out of scope (they need an
  instrumented `Context` / WorkManager) and are documented as such in the test file.

## Deviations from Plan
1. **TestDatabaseModule replaces `DatabaseModule`, not `DataModule`.** Code inspection
   showed the plan conflated the two: `DataModule` only *binds* the repository, while
   `DatabaseModule` *provides* `AppDatabase`/`ArticleDao`/`LocalArchiveDao`. Providing
   an in-memory database therefore requires replacing `DatabaseModule`. Net effect is
   the plan's stated intent (Hilt-backed tests run on an in-memory DB; the real
   repository binding is preserved).
2. **One extra file changed: `build.gradle.kts` (the plan assumed 4 files; 5 changed).**
   This realised the plan's own Risk #1 ("reviving infra may surface why it was
   disabled… Hilt graph changes"). The main Hilt processor was migrated to KSP
   (`ksp(libs.hilt.compiler)`), which already covers the androidTest/test variants, but
   the test source sets *also* registered Hilt via `kaptAndroidTest`/`kaptTest`. With
   every test `@Module` previously commented out this latent double-processing never
   fired; reviving the first one made KSP and kapt each emit the Hilt factories →
   "duplicate class" build failure. Fix: drop the redundant kapt registrations so Hilt
   is processed uniformly via KSP. Build config only; no app runtime change.
3. **`FirestoreSyncManagerTest` scope was trimmed vs. the plan's ~10-test sketch** to
   the highest-value, least-brittle surfaces (7 tests). The deep multi-page
   orchestration variants the plan listed are partially covered by the
   `FirestoreBackupServiceTest` page-accumulation test and the `performFullSync`
   restore scenario; pinning more of the private orchestration would have required
   heavy, fragile Firestore mocking for diminishing baseline value.

## Deviations from Plan — verification approach
None beyond the above. `:app:connectedDebugAndroidTest` (device-bound) was not run;
the instrumented module's revival was validated by `assembleDebugAndroidTest`
(compile + Hilt component generation), which is the bar the slice AC sets ("the module
compiles"). No instrumented test was revived in this slice.

## Anything Deferred
- **`ArchiveServiceTest` (3 failing tests, `data/archive/ArchiveServiceTest.kt:100/116/134`)
  is RED on `main` independent of this slice** — verified by stashing all changes and
  running it against the clean baseline (identical failures). It concerns the archive
  read-path self-heal markers, not the test-net targets. Out of scope here; flagged as
  a separate follow-up. Recording it so the slug-wide review/verify does not attribute
  it to this slice.

## Known Risks / Caveats
- The characterization assertions are intentionally tied to current behaviour. The
  dependent slices (`firestore-dedup`, `firestore-io`, `streaming-restore`) MUST update
  the marked assertions when they change the pinned behaviour — that is the net working
  as designed, not a regression.
- `assembleDebugAndroidTest` proves the Hilt test graph compiles, but no instrumented
  test was executed on a device this slice; the `PocketScreenTest`/`NavigationTest`
  revival remains out of scope.

## Verification Summary
- `:app:testDebugUnitTest` (target classes) — **23 tests, 0 failures**
  - `DefaultArticleRepositoryTest` — 1
  - `FirestoreBackupServiceTest` — 15 (8 pre-existing + 7 new)
  - `FirestoreSyncManagerTest` — 7 (new)
- `:app:assembleDebugAndroidTest` — **BUILD SUCCESSFUL** (in-memory test DB module +
  Hilt component generation).

## Freshness Research
No new external research required — the plan's freshness section (MockK 1.14.5,
coroutines-test 1.10.2, Hilt 2.57.1 `@TestInstallIn`, Room 2.8.0
`inMemoryDatabaseBuilder`, GMS `Tasks` stubs) was confirmed accurate against the live
build during implementation. One correction surfaced in code, not docs: Hilt processing
is KSP-based across all source sets (see Deviation 2).

## Recommended Next Stage
- **Option A (default):** `/wf verify simplify-android-app test-net` — re-run the suite
  and apply the AC gate. The net is the prerequisite for every dependent slice, so a
  clean verify here is load-bearing.
- **Option B:** `/wf implement simplify-android-app fts-search-fix` — the net is green;
  the first risky behaviour-changing slice may now proceed (it brings its own pinning
  tests).
