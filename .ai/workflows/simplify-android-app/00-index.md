---
schema: sdlc/v1
type: index
slug: simplify-android-app
title: "Simplify the Trails Android app (triage-driven cleanup)"
status: active
current-stage: verify
stage-number: 6
created-at: "2026-06-14T18:14:48Z"
updated-at: "2026-07-05T21:48:10Z"
selected-slice: "streaming-restore"
branch-strategy: dedicated
branch: "feat/simplify-android-app"
base-branch: "main"
review-scope: slug-wide
pr-url: ""
pr-number: 0
open-questions: []
resolved-questions:
  - "[plan batched-tag-reads] efficiency-4 RESOLVED -> client-only chunked parallel reads (collectionGroup rejected: ArticleTags has no userId field + no firestore.indexes.json). NOT deploy-gated; firebase/ untouched."
  - "[plan streaming-restore] efficiency-5 RESOLVED -> suspend onPage callback (both call sites already fold->chunk; clean cancellation/backpressure, constant memory)."
  - "[plan list-rendering] efficiency-12 RESOLVED -> drop palette entirely (only consumers were the dead gradient overlay + shadow tint; allowHardware concern dissolves)."
tags: [refactor, android, cleanup, simplify]
stack:
  detected-at: "2026-06-14T18:14:48Z"
  platforms: [android]
  languages: [kotlin]
  ui: [compose]
  build: [gradle]
  package-managers: [gradle]
  testing: [junit, mockk, kotlinx-coroutines-test, compose-ui-test, work-testing, hilt-testing]
  observability: [timber]
  integrations: [hilt, room, firebase, coil, paging]
  available-skills:
    - {name: testing-setup, hint: "Android test infra / harnesses for unit + UI + screenshot tests"}
    - {name: perfetto-trace-analysis, hint: "Trace-based latency/jank/memory root-cause (recomposition findings)"}
    - {name: lazylogcat, hint: "Non-interactive logcat capture/filter for sync/worker debugging"}
    - {name: navigation-3, hint: "Nav3 patterns (app already uses AppBackStack + scene strategies)"}
    - {name: adaptive, hint: "Multi-form-factor UI (AdaptiveArticleGrid already present)"}
  available-mcp:
    - {name: firebase, hint: "Firestore project trails-e428e — sync/backup findings"}
  user-confirmed: true
  confirmed-at: "2026-06-14T20:01:16Z"
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app streaming-restore"
workflow-files:
  - 00-index.md
  - 01-intake.md
  - po-answers.md
  - 02-shape.md
  - 02-shape.01-slice-map.html.fragment
  - 03-slice.md
  - 03-slice.01-slice-dag.html.fragment
  - 03-slice-test-net.md
  - 03-slice-fts-search-fix.md
  - 03-slice-streaming-restore.md
  - 03-slice-batched-tag-reads.md
  - 03-slice-app-scope.md
  - 03-slice-firestore-dedup.md
  - 03-slice-firestore-io.md
  - 03-slice-article-repository.md
  - 03-slice-detail-viewmodel.md
  - 03-slice-list-viewmodel.md
  - 03-slice-list-rendering.md
  - 03-slice-sync-worker.md
  - 03-slice-cross-cutting-url.md
  - 03-slice-architecture-docs.md
  - 04-plan.md
  - 04-plan-test-net.md
  - 04-plan-fts-search-fix.md
  - 04-plan-streaming-restore.md
  - 04-plan-batched-tag-reads.md
  - 04-plan-app-scope.md
  - 04-plan-firestore-dedup.md
  - 04-plan-firestore-io.md
  - 04-plan-article-repository.md
  - 04-plan-detail-viewmodel.md
  - 04-plan-list-viewmodel.md
  - 04-plan-list-rendering.md
  - 04-plan-sync-worker.md
  - 04-plan-cross-cutting-url.md
  - 04-plan-architecture-docs.md
  - 05-implement.md
  - 05-implement-test-net.md
  - 05-implement-test-net.01-net-coverage.html.fragment
  - 05-implement-fts-search-fix.md
  - 05-implement-streaming-restore.md
  - 06-verify.md
  - 06-verify-test-net.md
  - 06-verify-fts-search-fix.md
progress:
  intake: complete
  shape: complete
  slice: complete
  plan: complete
  implement: in-progress
  verify: in-progress
  review: not-started
  handoff: not-started
  ship: not-started
  retro: not-started
---
