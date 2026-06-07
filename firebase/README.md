# Firebase config (cross-stack)

This directory holds the Firebase project configuration shared by **both**
sides of the monorepo:

- `../android/` — the Trails Android client (reads Firestore)
- `../warg/` — the Warg Cloudflare Workers pipeline (writes Firestore)

Project ID: `trails-e428e` (also referenced from `warg/scripts/deploy.sh`).

## Files

| File | Purpose |
| --- | --- |
| `.firebaserc` | Default project alias |
| `firebase.json` | Hosting/Firestore/Storage config |
| `firestore.rules` | Security rules for the Firestore documents Trails reads and Warg writes |
| `storage.rules` | Security rules for the GCS bucket Warg uses for archive artifacts |
| `test/` | Standalone `@firebase/rules-unit-testing` suite run against the Firestore emulator; gates deploy in CI (`firebase-rules.yml`). `cd test && npm install && npm test`. |

## Deploying

From this directory:

```bash
firebase deploy --only firestore:rules,storage
```

## Article markers & sequenced read tightening

The top-level `articles` read rule is intentionally still `isAuthenticated()`.
Tightening it to a marker-gated, get-only read is a **later, separately
deployed** change: it can only land once every saved article has a per-user
existence marker at `users/{uid}/articleMarkers/{key}` (see
[`../shared-types/MarkerSchema.md`](../shared-types/MarkerSchema.md)).

Markers are written by the Android client on every sync/backup and on
read-denial self-heal; historical articles are covered by a one-off backfill.
Because rules auto-deploy on push to `main`, the read-tightening commit must be
the **last** to merge so reads keep working until coverage is in place.

## Why this is here, not under android/ or warg/

The rules govern documents that both stacks touch. A change to a `WargMetadata`
field requires (a) a rules update here, (b) a Warg producer change in
`../warg/`, and (c) a Trails consumer change in `../android/`. Keeping the
rules at this level lets all three ship in one PR.

> Note: `firestore.rules` was historically gitignored in the Trails repo
> (drift between repo and Firebase Console). With the monorepo migration,
> this file is now the source of truth — keep it in sync with the Console
> using `firebase deploy` rather than editing in the Console.
