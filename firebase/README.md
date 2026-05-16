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

## Deploying

From this directory:

```bash
firebase deploy --only firestore:rules,storage
```

## Why this is here, not under android/ or warg/

The rules govern documents that both stacks touch. A change to a `WargMetadata`
field requires (a) a rules update here, (b) a Warg producer change in
`../warg/`, and (c) a Trails consumer change in `../android/`. Keeping the
rules at this level lets all three ship in one PR.

> Note: `firestore.rules` was historically gitignored in the Trails repo
> (drift between repo and Firebase Console). With the monorepo migration,
> this file is now the source of truth — keep it in sync with the Console
> using `firebase deploy` rather than editing in the Console.
