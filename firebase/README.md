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

The top-level `articles` read rule is **marker-gated**: an authenticated user may
`get articles/{itemId}` only if they hold a per-user existence marker at
`users/{uid}/articleMarkers/{itemId}` (i.e. they saved that article).
Enumeration (`list`) is disabled and client `write` stays backend-only (see
[`../shared-types/MarkerSchema.md`](../shared-types/MarkerSchema.md)):

```
match /articles/{itemId} {
  allow get:   if isAuthenticated()
               && exists(/databases/$(database)/documents/users/$(request.auth.uid)/articleMarkers/$(itemId));
  allow list:  if false;
  allow write: if false;  // Backend service account only
}
```

Markers are written by the Android client on every sync/backup and on
read-denial self-heal; historical articles are covered by a one-off backfill
(`@warg/backfill-scripts`). Because rules auto-deploy on push to `main`, this
tightening **must be the last change to merge**, and only after every saved
article for the active user has a marker — otherwise reads break.

### Two-push deploy sequence (load-bearing — the tightening is fail-safe only in this order)

The marker infrastructure (the `articleMarkers` / owner-scoped `debug_logs`
rules, the Android marker writes + self-heal, and the emulator harness) is
**additive and deploy-safe**: it leaves the `articles` read permissive. The
read-flip is the only breaking change, so it is split off as its own push:

1. **Push 1 — additive infrastructure.** Merge everything *except* the read-flip
   commit. `firebase-rules.yml` runs the emulator suite then deploys the
   still-permissive ruleset (`articles` read = `isAuthenticated()`). No reads
   break.
2. **Run the prod backfill + wait for the coverage gate to go green** against the
   deployed infra (runbook:
   [`../warg/cloud-functions/backfill-scripts/README.md`](../warg/cloud-functions/backfill-scripts/README.md)):
   ```bash
   marker-backfill --user <uid> --apply     # writes only-missing markers; idempotent, never deletes
   coverage-gate   --user <uid>             # must exit 0 (markers ≥ every derived article key)
   ```
   The gate is a **hard precondition**: do not proceed until it exits 0.
3. **Push 2 — the read-flip commit alone.** Merge the `firestore.rules` flip.
   `firebase-rules.yml` runs the suite (now including the tightened `articles`
   matrix) then deploys the tightened rule. Propagation: ~1 min for new requests,
   up to ~10 min for active listeners.

### Prior-ruleset snapshot (rollback reference)

Live `trails-e428e` Firestore ruleset captured **2026-06-09T16:00Z**, before any
of this branch deployed (flat `debug_logs`, no `articleMarkers` — the pre-branch
prod state). Recorded as the recovery reference:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAuthenticated() { return request.auth != null; }
    function isOwner(userId) { return isAuthenticated() && request.auth.uid == userId; }

    match /articles/{itemId} {
      allow read: if isAuthenticated();
      allow write: if false;  // Backend service account only
    }
    match /debug_logs/{sessionId} {
      allow read, write: if isAuthenticated();
      match /entries/{entryId} { allow read, write: if isAuthenticated(); }
    }
    match /users/{userId} {
      allow read, write: if isOwner(userId);
      match /articles/{articleId} {
        allow read, write: if isOwner(userId);
        match /tags/{tagId}            { allow read, write: if isOwner(userId); }
        match /images/{imageId}        { allow read, write: if isOwner(userId); }
        match /videos/{videoId}        { allow read, write: if isOwner(userId); }
        match /authors/{authorId}      { allow read, write: if isOwner(userId); }
        match /domainMetadata/{metadataId} { allow read, write: if isOwner(userId); }
      }
      match /settings/{settingId} { allow read, write: if isOwner(userId); }
    }
  }
}
```

### Rollback

Firestore rules have **no native rollback** — redeploy the prior ruleset by
reverting and re-pushing:

```bash
git revert <read-flip-commit>   # restores the post-push-1 ruleset (articles read permissive again)
git push origin main            # firebase-rules.yml redeploys it (~1 min new / ~10 min listeners)
```

`git revert` of the flip commit restores the **push-1** ruleset (additive infra
present, `articles` read permissive) — the correct fail-safe state, since markers
remain in place. The snapshot above is the deeper pre-branch baseline, kept only
as a recovery reference if a full rollback is ever needed.

## Archive content reads (GCS bucket lockdown)

Archive **content** (the rendered / readability / markdown / singlefile /
monolith / screenshot artifacts in `gs://htbase-archives-standard`, GCP project
`trails-414917`) now loads via a per-user signed-URL endpoint instead of a
public bucket binding:

- The app calls `GET /app/signed-url?itemId=…&archiveKey=…` on the `dashboardApi`
  Cloud Function with an `Authorization: Bearer <Firebase ID token>` header.
- The endpoint verifies the token (anonymous sign-ins rejected), confirms the
  caller owns `users/{uid}/articles/{itemId}`, and returns a short-lived
  (15-minute) V4 signed read URL. The app then GETs the object directly — no
  Google-account / GCS OAuth scope is involved anymore.
- The bucket no longer grants `allAuthenticatedUsers → roles/storage.objectViewer`,
  and Public Access Prevention (PAP) is enforced.

The dashboard's existing `GET /signed-url` route (internal API key) is unchanged;
both routes share one signing implementation and differ only in how the owner is
identified (hardcoded dashboard user vs. verified token uid).

### Deploy ordering (load-bearing — the migration is fail-safe only in this order)

1. Deploy the updated `dashboardApi` (adds the `/app/signed-url` route).
2. Roll out the app build that fetches via `/app/signed-url`, and confirm an
   archive still loads **while `allAuthenticatedUsers` is still present**.
3. **Only then** remove the public binding and enforce PAP:
   ```bash
   gcloud storage buckets remove-iam-policy-binding gs://htbase-archives-standard \
     --project=trails-414917 \
     --member=allAuthenticatedUsers --role=roles/storage.objectViewer
   gcloud storage buckets update gs://htbase-archives-standard \
     --project=trails-414917 --public-access-prevention
   ```
4. Re-fetch an archive on the new build → it should still load. Assert the
   binding is gone:
   ```bash
   gcloud storage buckets get-iam-policy gs://htbase-archives-standard --project=trails-414917
   ```

### Signing service-account preconditions

The `dashboardApi` service account must hold `roles/iam.serviceAccountTokenCreator`
on itself (project `trails-e428e`, for the `signBlob` call V4 signing uses) and
`roles/storage.objectViewer` on the bucket (project `trails-414917`). The
dashboard already signs URLs in production, so these are expected to be in place
— verify read-only before removing the public binding.

### Rollback

If the signed-URL path regresses, re-open the bucket (disable PAP first if it
blocks re-adding the binding):
```bash
gcloud storage buckets update gs://htbase-archives-standard \
  --project=trails-414917 --no-public-access-prevention
gcloud storage buckets add-iam-policy-binding gs://htbase-archives-standard \
  --project=trails-414917 \
  --member=allAuthenticatedUsers --role=roles/storage.objectViewer
```
Rollback is bucket-level: the old OAuth/`devstorage` client path has been removed,
so there is no app-side toggle to revert.

## Why this is here, not under android/ or warg/

The rules govern documents that both stacks touch. A change to a `WargMetadata`
field requires (a) a rules update here, (b) a Warg producer change in
`../warg/`, and (c) a Trails consumer change in `../android/`. Keeping the
rules at this level lets all three ship in one PR.

> Note: `firestore.rules` was historically gitignored in the Trails repo
> (drift between repo and Firebase Console). With the monorepo migration,
> this file is now the source of truth — keep it in sync with the Console
> using `firebase deploy` rather than editing in the Console.
