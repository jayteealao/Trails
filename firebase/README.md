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
| `test/` | Standalone `@firebase/rules-unit-testing` suite run against the Firestore and Storage emulators (emulator-only config in `test/emulators.json`; the suite loads `firestore.rules` and `storage.rules` itself); runs in CI (`firebase-rules.yml`). `cd test && npm install && npm test`. |

## Deploying

The rules deploy only through the Warg deploy script, from `warg/`:

```bash
pnpm run deploy -- --functions-only --with-rules   # the functions, then the rules
pnpm run deploy -- --rules-only                    # the rules and nothing else
pnpm deploy:all                                    # workers, functions, rules and the dashboard
```

The rules step reads the grace end from the released Firestore rules and keeps
it; on the first stamped deploy (the released rules hold no stamped grace end)
it sets the end to 30 days after the deploy and prints a warning saying so. It
writes a build copy of this folder with LF line endings and the placeholder
replaced by the grace end, deploys it with
`firebase deploy --only firestore:rules,storage --non-interactive`, and then
reads each released ruleset (Firestore and every storage bucket) through the
Firebase Rules API and compares its SHA-256 with the build copy. A mismatch,
including a deploy that exits 0 and changes nothing, stops the run with exit 3.
It needs `gcloud auth login` as well as the firebase sign-in.

Never deploy these rules by hand, from the Firebase Console or from CI: the
released Firestore rules carry the grace end, and a deploy of the unstamped
file would lose it (the next scripted deploy would then start a new 30-day
period).

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

Markers are written by the server: the user-article trigger writes the marker
and a server-owned `canonicalId` on `users/{uid}/articles/{itemId}` naming the
shared article, and the backfill scripts (`@warg/backfill-scripts`) do the same
for existing articles. The rules refuse client writes to `canonicalId`. During
a grace period after the rules release, an app-written marker is still
accepted, but only when its key equals the `canonicalId` of the user article its
`itemId` names; after the grace end every client marker write is refused. The
grace end is a timestamp in `firestore.rules` that the deploy script stamps into
the deployed copy; the committed file holds a placeholder that means "no grace",
so an unstamped file refuses every client marker write.

Older app builds stop backing up when these rules deploy. They write the
article and its markers in one batch, so a refused marker fails the article
write too; this already happens during the grace period for any article whose
`resolvedId` differs from its `itemId`, and for every article after the grace
end. Updating the app is the only fix; the rules keep no path for older builds.
See [`shared-types/MarkerSchema.md`](../shared-types/MarkerSchema.md#grace-period-for-older-app-builds).

### Two-push deploy sequence (load-bearing — the tightening is fail-safe only in this order)

This is how the read-flip shipped, when CI still deployed the rules on
every push to `main`. Rules now deploy only through `warg/scripts/deploy.sh`
(see Deploying); CI runs the tests and deploys nothing, so "push" below reads
"deploy with the script" today.

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
reverting and deploying again with the script (from `warg/`):

```bash
git revert <commit>                                  # restores the previous rules file
pnpm run deploy -- --rules-only                      # the rules only: no worker or function redeploy
```

`--rules-only` skips every worker and function and their secret checks; the
firebase and gcloud sign-in checks and the released-ruleset hash check still run.
Add `--skip-checks` to skip the workspace typecheck and tests in an emergency.

The deploy reuses the grace end of the released rules, so a rollback never
moves it.

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

Both routes find the shared article through the server-written `canonicalId`
and fall back to the `itemId` while it is absent. Two windows follow from that:

- An article saved a moment ago has no server marker until the user-article
  trigger has run, and `/app/signed-url` answers 404 for it until then. Opening
  it again a few seconds later works.
- An existing article whose `canonicalId` the link re-derive has not written yet
  resolves to `articles/{itemId}`; where its shared article has another id, the
  dashboard shows it without shared-article data and the signed URL answers 404.
  Deploy the `dashboardApi` read change only after a re-derive dry run reports no
  link to add, change or clear (see
  [`warg/cloud-functions/backfill-scripts/README.md`](../warg/cloud-functions/backfill-scripts/README.md#link-re-derive)).

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
> using `warg/scripts/deploy.sh --with-rules` rather than editing in the Console.
