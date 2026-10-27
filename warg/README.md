# Warg

URL-to-archive pipeline using Cloudflare Workers.

## Setup

```bash
pnpm install
```

## Development

### Type check all packages

```bash
pnpm -r typecheck
```

### Lint

```bash
pnpm -r lint
pnpm -r lint:fix
```

### Format

```bash
pnpm format
pnpm format:check
```

### Run tests

```bash
pnpm --filter @warg/shared test
```

### Run a worker locally

```bash
pnpm --filter @warg/gateway dev
```

## Deploying

`scripts/deploy.sh` is the only deploy path; its header lists every flag, the
secrets each worker needs, and how each target is verified.

1. Commit your work. The script refuses a tree with uncommitted or untracked
   files unless you pass `--allow-dirty`, and then every label ends in `-dirty`.
2. Sign in once, one sign-in per target: `cf auth login` (workers),
   `wrangler login` or `CLOUDFLARE_API_TOKEN` (the dashboard; wrangler does not
   reuse the cf credentials), `firebase login`, `FIREBASE_TOKEN` or
   `gcloud auth application-default login` (Cloud Functions) and
   `gcloud auth login` (the function verification, the secret and invoker
   checks and the rules step through gcloud). The script checks the wrangler,
   firebase and, for the rules, gcloud sign-ins before the first upload. Start
   Docker before a deploy that includes `monolith` (its container image is
   built locally).
3. Deploy from `warg/`:

   ```bash
   pnpm deploy:all                   # workers, functions and the dashboard (never the rules)
   pnpm run deploy -- --all --with-rules   # the same, then the Firestore and Storage rules
   pnpm run deploy                   # workers only
   pnpm run deploy -- --with-pages   # workers and the dashboard
   pnpm run deploy -- --functions-only   # the four Cloud Functions only
   pnpm run deploy -- --with-rules   # workers, then the Firestore and Storage rules
   pnpm run deploy -- --functions-only --with-rules   # the functions, then the rules
   pnpm deploy:quick                 # skip typecheck and tests (the secret check still runs)
   ```

   Plain `pnpm deploy` is pnpm's own built-in command and does not run the
   script; use `pnpm run deploy` or one of the `deploy:*` scripts.

4. Read the summary. The script prints one line per target on every exit:
   `deployed` (the platform shows this run's version id, update time or commit
   hash), `failed`, `unverified` (the command succeeded but the platform did not
   change) or `skipped` (not reached). The run stops at the first failure and
   exits with that command's code; 2 means a usage error or a refused dirty
   tree, 3 a failed verification or a missing secret.

First deploy of a new worker: the secret check cannot list secrets of a worker
that does not exist yet, so pass the flag for that worker only, then set its
secrets and deploy again without it:

```bash
pnpm run deploy -- --allow-missing-secrets <worker>
```

Cloud Function bundles: each function deploys as one esbuild bundle. The
firebase.json predeploy runs `pnpm run build:deploy` in the function folder,
which writes `dist-deploy/` with the commit label baked in; `pnpm -r test`
runs the function test suites. Each function folder needs its `.env` (copy
`.env.example`).

Function secrets and deploy configuration: before any deploy that includes the
functions, the script checks that every Secret Manager secret the functions
bind has an enabled latest version, and that `dashboard-api/.env` sets
`DASHBOARD_USER_ID` and `backfill-archiver/.env` sets `BACKFILL_USER_ID`. A
miss stops the run with exit 3 naming each missing name (never a value) and
the `gcloud secrets create` command that adds it, so firebase-tools never
prompts mid-deploy. The function deploy runs with `--non-interactive`.

Invoker check: after each function codebase verifies, the script reads the
Cloud Run IAM policy of its trigger and scheduled functions
(`onUserArticleSave`, `backfillArchiver`, `articleStatusDerive`) and fails with
exit 3 when one grants `allUsers` or `allAuthenticatedUsers`; a deploy update
leaves IAM as it was, so a public binding never goes unnoticed. The HTTP
functions stay public; their per-caller keys guard them.

Rules: `--with-rules` deploys `../firebase/` after the functions; `--all`
never includes it. Ship the app release that writes no marker before the first
rules deploy, and run the link re-derive (below) as part of it: the order and
the reasons are in `../firebase/README.md` (Ship order). The step reads the grace end from the released Firestore rules and
keeps it (the first stamped deploy sets it to 30 days later and warns), stamps
it into an LF build copy, deploys that copy non-interactively and compares the
SHA-256 of each released ruleset, read through the Firebase Rules API, with the
build copy; a mismatch stops the run with exit 3. Rules deploy only this way
(`../firebase/README.md`).

Checking the deploy script: `pnpm deploy:check` runs shellcheck and a stub
harness that drives the script end to end without credentials (CI runs it too).

The `deploy` scripts of the function packages and of `pages/dashboard` only
print a pointer to `scripts/deploy.sh` and exit 1. `pages/dashboard-v2` is not
deployed by the script and keeps its own `deploy` script.

Two configs per worker: `cloudflare.config.ts` is what `cf deploy` reads, and
`wrangler.jsonc` still serves `wrangler dev` and `wrangler types`. Change a
binding in both; `node scripts/check-worker-configs.mjs` (run in CI) fails when
they disagree.

Each worker's `node_modules/wrangler` is a link that the root `postinstall`
(`scripts/link-worker-bundler.mjs`) creates, because `cf deploy` looks for the
bundler only inside the worker folder. After an install with
`--ignore-scripts`, run `node scripts/link-worker-bundler.mjs` before
deploying. Remove the script and the `postinstall` entry once cf finds the
bundler through the normal Node module lookup, or the workspace stops using the
hoisted linker.

### Rotating the function keys (two steps)

Each caller of the HTTP Cloud Functions has its own key, so a leaked key opens
one function only. Callers send it in the `X-Internal-API-Key` header.

| Secret | Stored in | Sent by | Checked by |
|---|---|---|---|
| `ARCHIVE_GATEWAY_KEY` | Secret Manager and the `gcs` worker | storage worker (`workers/gcs`) | archive-gateway |
| `DASHBOARD_API_KEY` | Secret Manager and both dashboards' Pages secrets | dashboard | dashboard-api |
| `BACKFILL_STATUS_KEY` | Secret Manager and both dashboards' Pages secrets | dashboard | backfillStatus |
| `GATEWAY_LOG_KEY` | Secret Manager | archive-gateway (event logs) | gateway worker `/internal/log` |

`INTERNAL_API_KEY` in Secret Manager is the old shared function key. The
`KEY_ROTATION_DUAL_ACCEPT` line in the `.env` of archive-gateway,
backfill-archiver and dashboard-api decides whether those functions also bind
and accept it: `true` accepts it next to each caller's own key, `false` refuses
it. Any other value counts as off, and `deploy.sh` refuses to deploy a
function whose `.env` does not say `true` or `false`. The Cloudflare workers
keep their own `INTERNAL_API_KEY` for worker-to-worker calls; this rotation
does not touch it.

Run the steps in order, from `warg/`. No secret value goes into a file, a
commit or a log: pipe generated values straight into the command.

1. **Create the secrets.** For `ARCHIVE_GATEWAY_KEY`, `DASHBOARD_API_KEY` and
   `BACKFILL_STATUS_KEY`:

   ```bash
   printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create <NAME> --data-file=- --project trails-e428e
   ```

   `GATEWAY_LOG_KEY` takes the gateway worker's current internal key, not a
   new value.
2. **Set the matching caller secrets** to the same values:

   ```bash
   pnpm exec wrangler secret put ARCHIVE_GATEWAY_KEY --config workers/gcs/wrangler.jsonc
   pnpm exec wrangler pages secret put DASHBOARD_API_KEY --project-name warg-dashboard
   pnpm exec wrangler pages secret put BACKFILL_STATUS_KEY --project-name warg-dashboard
   pnpm exec wrangler pages secret put DASHBOARD_API_KEY --project-name warg-dashboard-v2
   pnpm exec wrangler pages secret put BACKFILL_STATUS_KEY --project-name warg-dashboard-v2
   ```

3. **Deploy one.** Set `KEY_ROTATION_DUAL_ACCEPT=true` in the three `.env`
   files, then deploy the functions first:

   ```bash
   pnpm run deploy -- --functions-only
   ```

   Check that a request with the old key still succeeds at each function. Then
   deploy the callers:

   ```bash
   pnpm run deploy -- --with-pages
   pnpm --dir pages/dashboard-v2 run deploy
   ```

4. **Check every caller on its new key:** a test article upload through the
   storage worker, the dashboard article list and the dashboard backfill
   status. A request with another caller's key must get 401.
5. **Grep before deploy two.** No caller of a function may still send
   `INTERNAL_API_KEY`:

   ```bash
   git grep -n -E "cloudfunctions.net|CLOUD_FN_BASE_URL|DASHBOARD_API_URL|BACKFILL_STATUS_URL"
   ```

6. **Deploy two.** Set `KEY_ROTATION_DUAL_ACCEPT=false` in the three `.env`
   files, then run `pnpm run deploy -- --functions-only`. A request with the
   old key must now get 401 at each function.
7. **Destroy the old versions.** List them, destroy each enabled one, and list
   again; every version must show `DESTROYED`:

   ```bash
   gcloud secrets versions list INTERNAL_API_KEY --project trails-e428e
   gcloud secrets versions destroy <version> --secret INTERNAL_API_KEY --project trails-e428e
   ```

Step 6 must run before step 7. Deploy two unbinds `INTERNAL_API_KEY` from the
functions; a function deploy fails while a bound secret has no enabled
version.

## Merging duplicate shared articles

Older shares of one link with different tracking parameters (`utm_*`, `fbclid`,
a `#fragment` and so on) left several shared articles (`articles/{id}`) for the
same page. The duplicate merge in `@warg/backfill-scripts` groups every shared
article by its normalized URL and, in each group:

- keeps the oldest shared article (its `created_at`, else the document's create
  time) as the winner;
- copies to the winner each finished archive it lacks, from the oldest other
  copy that has one (the stored `gs://` path is reused; no Storage object moves);
- points every user article that linked to another copy at the winner
  (`canonicalId`) and gives the user a marker for the winner;
- leaves every other copy in place as a stub with `mergedInto: <winner>`. It
  deletes nothing;
- writes `normalizedUrl` on every shared article, single ones included.

Prerequisites: an Application Default Credentials sign-in with access to the
project (`gcloud auth application-default login`), then a build:

```sh
pnpm --filter @warg/backfill-scripts build
cd cloud-functions/backfill-scripts
```

1. **Dry run** (the default; writes nothing):

   ```sh
   node dist/merge-pass-a.js
   ```

   It prints the counts and the path of a JSON report, by default
   `tmp/merge-pass-a-<UTC time>.json` in the package folder (ignored by git;
   `--report <path>` overrides it). Read the report before going on: the counts,
   each group's winner and the copies merged into it, the archives copied, the
   user articles moved (users appear only as short hashed labels) and the
   anomalies (shared articles with no URL, groups with no possible winner,
   winners missing metadata that a copy holds).
2. **Real run**, in a quiet window right after the reviewed dry run:

   ```sh
   node dist/merge-pass-a.js --apply
   ```

   Against production the script waits 5 seconds before it writes (Ctrl-C to
   abort; `--yes` skips the wait). It writes archives and `normalizedUrl`
   first, then the winner markers, then the user links, and the stub marks
   last, so a stopped run leaves every reader working and no user is linked to
   a winner before holding its marker. A write that still fails after its
   retries stops the run before the next of these steps; run it again.
3. **Check**: run the dry run again. It should plan zero changes. Re-running the
   real run is always safe, and it finishes a run that stopped part way.

Run the merge before the link re-derive pass, which works on the merged data.

## Re-deriving article links (after the merge)

Older user articles were linked to a shared article, and given the marker that
lets the user read it, by the app (Pocket-import aliases included). The link
re-derive in `@warg/backfill-scripts` makes every such link a server choice:

- for every user article that is not deleted, it derives the shared article
  from the article's URL with the same rule as the save trigger (normalize the
  URL, take the oldest shared article for it, follow `mergedInto` once), writes
  `canonicalId` (and `resolvedId`) when they differ, and writes a server marker
  for it (`source: "rederive"`) unless a matching server marker is there;
- when no shared article has that URL, it creates one through the save
  trigger's own link function (status `pending`, no archive yet);
- it clears a `canonicalId` it cannot derive (no URL, or an id that cannot name
  a shared article) and lists the article as an anomaly. When such an article's
  own id already names a shared article or a marker (an id conflict, often a
  URL that changed after the save), it keeps that marker and lists the anomaly
  for you to decide;
- it removes every marker that none of the user's own article URLs derives,
  whatever its `source` says;
- it skips deleted user articles (`deletedAt`, or the older `deleted_at`): they
  get no write, and the shared article their URL derives keeps its marker.

Run it only after the duplicate merge has finished. Before it plans anything it
checks that every shared article carries its `normalizedUrl`, that no URL has
two unmerged shared articles and that every stub points at a live one; when a
check fails, `--apply` refuses (exit code 2) and the dry run lists the failures.

Prerequisites: an Application Default Credentials sign-in with access to the
project (`gcloud auth application-default login`), then a build:

```sh
pnpm --filter @warg/backfill-scripts build
cd cloud-functions/backfill-scripts
```

1. **Dry run** (the default; writes nothing):

   ```sh
   node dist/rederive-pass-b.js
   ```

   It prints the counts and the path of a JSON report, by default
   `tmp/rederive-pass-b-<UTC time>.json` in the package folder (ignored by git;
   `--report <path>` overrides it). Users appear only as short hashed labels.
   Read the report before going on:
   - `linkChanges` rows with `archiveLoss: true`: the article's old link had a
     finished archive and the shared article its URL derives has none;
   - `creates`: new shared articles; each starts with no archive (`archiveLoss`
     marks the ones whose old link had one);
   - `markerRemovals`, with each marker's `source` (the older app's `sync` and
     `self-heal` markers among them) and `archiveLoss: true` when the marker
     opened a shared article with a finished archive (the `archiveLoss` count
     includes these);
   - `anomalies`: articles with no URL or no valid id, id conflicts, shared
     articles with no URL, and deleted articles whose link differs from the
     derived one.
2. **Real run**, in a quiet window right after the reviewed dry run:

   ```sh
   node dist/rederive-pass-b.js --apply
   ```

   Against production the script waits 5 seconds before it writes (Ctrl-C to
   abort; `--yes` skips the wait). It creates the new shared articles first,
   then writes the links and markers, and removes markers last, so a user never
   loses a correct marker before the new one exists. Each write checks that the
   document has not changed since the scan read it.
3. **Check**: run the dry run again. It should plan zero changes. Re-running the
   real run is always safe and finishes a run that stopped part way. When the
   real run reports conflicts (a document changed while it ran; exit code 1),
   run `--apply` again, then the dry run.

## Backfill passes, the change scan and the second-account check

The scheduled backfill (`backfillArchiver`, every 10 minutes) makes one full
pass over the backfill user's articles, page by page, and stops at the end of
the collection instead of starting again at page one. After the pass it reads
only the articles the app changed since the last run (by their `timeUpdated`),
starting 10 minutes before the pass began so a change made during the pass is
still seen. A run with nothing changed reads the tracker document and one
query. Shared articles whose archive start failed are retried from a short list
in the tracker, with the same `request_id`, not by scanning again. The backfill
groups articles by the link the server wrote (`canonicalId`) and makes no
per-URL lookup; an article the server has not linked yet is left for the save
trigger or the link re-derive.

The save trigger (`onUserArticleSave`) is deployed with retry on: when its link
or its archive start fails, it throws and the event is delivered again, for up
to one hour after the save. After that it marks the shared article `failed` and
writes the error on the user article. The backfill does not retry those, nor an
archive the trigger started that later failed or got stuck, because the trigger
does not change the article's `timeUpdated`; a new full pass (below) does.

To start one new full pass, set `BACKFILL_PASS_LABEL` to a new value in
`cloud-functions/backfill-archiver/.env` (the default is `1`) and deploy the
functions through the deploy script. Do this once after the link re-derive
pass, so the backfill revisits the articles it re-linked, and whenever failed
or stuck archives that the save trigger started should be retried.

The dashboard article list pages on the server: each page reads its own 50
articles and their shared articles, Next sends the cursor of the page before,
and the total comes from a `count()` query. A list with a status filter or a
search (the inbox counts among them) still reads up to 2,000 articles and their
shared articles and filters them in memory, so only the unfiltered list reads
one page. Signed archive links are reused until 5 minutes before they expire.

`GET /articles` (dashboard-api) takes `cursor`, an opaque value copied from the
previous page's `nextCursor` (`null` on the last page and on a filtered or
searched list). A malformed cursor answers 400 `{"error":"Invalid cursor"}`. A
`page` without a cursor skips the earlier pages with an offset, which Firestore
bills per skipped document; a page past 10,000 skipped documents answers 400.

**Second-account check.** After deploy two (step 6 of
[Rotating the function keys](#rotating-the-function-keys-two-steps)), with the
new app release on the phone:

1. Share a fresh link from the phone. Its user article gets a `canonicalId` and
   the user gets a marker under `articleMarkers/<canonicalId>`.
2. Share the same link again with `?utm_source=x` added. The new user article
   has the same `canonicalId`, and only one shared article holds that
   `normalizedUrl`.
3. When the archive is done, open the article on the phone: the archive view
   shows it.
4. From `warg/`, with the project's web API key in the environment (never in a
   file or an argument), run the second-account check against the shared id
   from step 1:

   ```bash
   FIREBASE_WEB_API_KEY=<web key> node scripts/second-account-check.mjs \
     --project trails-e428e --shared-id <canonicalId> --signed-url-base <dashboard-api URL>
   ```

   It creates and then deletes its own anonymous account, so the project must
   have the Anonymous sign-in provider enabled (Firebase Console,
   Authentication, Sign-in method); without it the script prints
   a `FAIL anonymous-sign-up (<status>)` line and exits 1. Otherwise it prints three PASS lines
   (marker write refused, shared read refused, signed link refused) and exits 1
   on any FAIL. Its self-test is
   `node --test scripts/__tests__/second-account-check.test.mjs`.
5. Send a request with the old shared key to archive-gateway, as step 6 of the
   key rotation describes. It must get 401.

## Structure

- `workers/` - Cloudflare Workers
  - `gateway/` - Public API (POST /begin, GET /status/:id) + cron sweeps
  - `workflow/` - Orchestration workflow + browser/sandbox quota DO
  - `renderer/` - Browser rendering
  - `singlefile/` - SingleFile HTML extraction
  - `readability/` - Readability extraction
  - `monolith/` - Monolith HTML extraction (sandbox container, stopped per job — see its README)
  - `logger/` - Event-sourced request traces (hour-bucketed Durable Objects — see its README)
  - `gcs/` - GCS persistence coordinator
- `packages/shared/` - Shared types and utilities
- `cloud-functions/archive-gateway/` - Google Cloud Function for GCS/Firestore
- `docs/` - Decision records

Cost note: Durable Object duration (GB-s) is the dominant billing meter for
this pipeline; see `docs/adr-do-cost.md` for the container and logger
lifecycle decisions that keep it under the free tier.
