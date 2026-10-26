# Trails monorepo

Two stacks that together form the Trails read-it-later app:

| Directory | Stack | Purpose |
| --- | --- | --- |
| [`android/`](./android/) | Kotlin + Jetpack Compose, Gradle 8.13 | Android client — saves URLs from the share sheet, stores articles in Room, syncs via Firestore. **Search** returns sanitized FTS results (special characters and operators are handled correctly before reaching the database). **Restore** streams articles page-by-page with constant memory — large libraries no longer risk OOM. |
| [`warg/`](./warg/) | TypeScript + Cloudflare Workers, pnpm workspace | URL-to-archive pipeline — multi-renderer extraction (SingleFile, Readability, Monolith, Puppeteer), persists artifacts to GCS and metadata to Firestore. |
| [`firebase/`](./firebase/) | Firebase config | `firestore.rules`, `storage.rules`, project alias. Cross-stack source of truth. |
| [`shared-types/`](./shared-types/) | Markdown + Node | Canonical schemas + CI drift check between client and backend. |

## How the stacks connect

- Both write to the **same Firebase project** (`trails-e428e`).
- Trails calls Warg's `POST /begin` when the user saves a URL.
- Warg writes archive metadata + artifact pointers into `articles/{itemId}` in Firestore.
- Trails reads back via `fetchWargMetadata()` — the contract is enforced by [`shared-types/WargMetadata.md`](./shared-types/WargMetadata.md).

```
[ Android share sheet ]
        │ URL
        ▼
[ android/ Trails app ] ──POST /begin──▶ [ warg/ gateway ]
        ▲                                       │
        │ read metadata + artifacts             ▼
   [ Firebase project trails-e428e ] ◀──writes── [ warg/ workflow → renderers → GCS ]
        ▲
        │ rules apply
   [ firebase/ firestore.rules + storage.rules ]
```

## Quick start

Android:
```sh
cd android
cp local.properties.example local.properties   # then fill in signing keys
./gradlew assembleDebug
```

Warg:
```sh
cd warg
pnpm install
pnpm -r run typecheck
pnpm --filter gateway dev
```

Firebase rules:
```sh
cd firebase
firebase deploy --only firestore:rules,storage
```

## CI

`.github/workflows/` runs path-filtered builds — a PR touching only `android/` won't trigger Warg's pipeline and vice versa.

- `pr-build-check.yml` — Android debug APK on PRs touching `android/` / `firebase/` / `shared-types/`
- `release-on-tag.yml` — Android release build + GitHub Release on `v*` tags
- `manual-release.yml` — Android release build via workflow_dispatch
- `warg-ci.yml` — on PRs and main pushes touching `warg/` / `firebase/` / `shared-types/` / `.github/`: pnpm install, lint, typecheck, unit tests, the worker dry-run deploys, the worker-config, key and function-bundle checks, the deploy-script harness, the shared-types drift check, the workflow lint, and the Firestore-emulator integration suites (link triggers, merge and re-derive passes)
- `firebase-rules.yml` — Firestore and Storage rules tests on the emulators, on PRs and main pushes touching `firebase/`. It deploys nothing: the rules deploy only through `warg/scripts/deploy.sh` (`--with-rules` or `--rules-only`; see `firebase/README.md`)

## Git history

This repo merged two previously-separate repositories on 2026-05-16 using
`git subtree`. Tracing history across that boundary needs slightly
different commands than usual:

| Goal | Command |
| --- | --- |
| Files moved from old Trails root → `android/` | `git log --follow android/<path>` (rename detection works fine) |
| Files imported from old Warg repo → `warg/` | `git log <warg-side-parent> -- workers/<old-path>` |
| Full unified history graph | `git log --graph --oneline --all` |

The subtree merge commit (`5f2db83`) is the join point; everything before
it on the Warg side appears in the second parent.

## Authoring guidance

Stack-specific Claude / agent guidance lives next to the code:

- [`android/AGENT.MD`](./android/AGENT.MD) — Android conventions
- [`warg/CLAUDE.md`](./warg/CLAUDE.md) — TypeScript / Cloudflare Workers conventions
