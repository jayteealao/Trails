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
pnpm -r --if-present run test               # every package's unit tests (what CI runs); the gateway and workflow also run workerd tests
pnpm --filter @warg/gateway test:runtime    # only the gateway runtime tests (workerd)
pnpm --filter @warg/workflow test:runtime   # only the workflow runtime tests (workerd)
```

The dashboard also has browser checks (Playwright, Chromium) of the sign-in,
the archive content policy, the archive preview, the infra view and the inbox.
They start the dashboard Worker under a local `cf dev`
(`pages/dashboard/cloudflare.config.ts`) with test credentials, a stand-in
logger worker (`pages/dashboard/e2e/stub-logger`, also under `cf dev`) and
per-spec stubs, so they need no live service and no Cloudflare account. The
test credentials go in a gitignored `.dev.vars.e2e` (or `.dev.vars.e2e-logger`,
`.dev.vars.e2e-settle`) that the Playwright config writes before each run;
your own `.dev.vars` is not read. Install the browser once, then run them:

```bash
pnpm --filter warg-dashboard exec playwright install chromium
pnpm --filter warg-dashboard test:e2e
```

They use the local ports 18797 (stand-in logger), 18798 (stubs) and 18799
(dashboard); set `E2E_LOGGER_PORT`, `E2E_STUB_PORT` or `E2E_PAGES_PORT` when
one is taken. CI runs them in a job of their own, apart from the unit tests.

`test:e2e:logger` and `test:e2e:settle` run the dashboard against the real
logger (and, for the settle check, the workflow worker in mock mode). Those two
workers start under `wrangler dev`, not `cf dev`: each run gets its own fresh
D1 and R2 folder through `--persist-to`, which `cf dev` (cf 1.0.0-beta.17) has
no option for.

### Run a worker locally

```bash
pnpm --filter @warg/gateway dev
pnpm --filter warg-dashboard dev    # the dashboard Worker on http://127.0.0.1:8788
```

The `dev` scripts run `cf dev`, which reads the worker's `cloudflare.config.ts`
(cf hands it to wrangler's dev server) and its `.dev.vars`. It accepts only
`--mode`, `--host`, `--port` and `--local`; a mode `<m>` reads `.dev.vars.<m>`
in place of `.dev.vars`. Monolith's `dev` stays on `wrangler dev`: cf dev
rejects its container-backed Durable Object.

The dashboard is the Worker `warg-dashboard` in `pages/dashboard/`: static
files in `public/` (served by its assets binding), the Pages-style handlers in
`functions/` (unchanged `onRequest(context)` functions), and `src/`, the
Worker entry and the router that runs them. Every request runs the Worker
first, so the sign-in middleware (`functions/_middleware.ts`) guards each page
and API route. A new function file must be added to the table in
`src/routes.ts`; `src/__tests__/router.test.ts` fails until it is. Put local
dev values in `pages/dashboard/.dev.vars` (copy `.dev.vars.example`).

## Deploying

`scripts/deploy.sh` is the only deploy path; its header lists every flag, the
secrets each worker needs, and how each target is verified.

Deploy with Node 22.23+ or 24.22+, the range the `cf` CLI requires (CI uses
Node 22). `warg/.nvmrc` names 24.22.2; with fnm, run `fnm use` in `warg/`.

1. Commit your work. The script refuses a tree with uncommitted or untracked
   files unless you pass `--allow-dirty`, and then every label ends in `-dirty`.
2. Sign in once, one sign-in per target: `cf auth login` (the workers and the
   dashboard Worker), `firebase login`, `FIREBASE_TOKEN` or
   `gcloud auth application-default login` (Cloud Functions) and
   `gcloud auth login` (the function verification, the secret and invoker
   checks and the rules step through gcloud). The script checks the firebase
   and, for the rules, gcloud sign-ins before the first upload. Start
   Docker before a deploy that includes `monolith` (its container image is
   built locally).
3. Set the dashboard Worker's secrets. Every dashboard page and API call asks
   for `DASHBOARD_AUTH` through the browser's sign-in prompt (HTTP Basic);
   without it every page answers 500 `Dashboard auth is not configured.`. The
   API routes also send `INTERNAL_API_KEY` (logger and gateway),
   `DASHBOARD_API_KEY` (dashboard-api), `BACKFILL_STATUS_KEY`
   (backfillStatus), and `CF_API_TOKEN` and `CF_ACCOUNT_ID` (the infra view).
   `--with-dashboard` stops with exit 3 before anything deploys while one is
   missing. A secret can only be set on a Worker that exists, so the very first
   dashboard deploy passes `--allow-missing-secrets warg-dashboard` (the Worker
   then answers 500 to everyone until `DASHBOARD_AUTH` is set). Set each one
   without putting the value in your shell history:

   ```bash
   read -rs VALUE && pnpm exec cf workers secrets update DASHBOARD_AUTH --worker warg-dashboard --type secret_text --text "$VALUE"; unset VALUE
   ```

   `DASHBOARD_AUTH` is `user:password`; use a generated password, for example
   the output of `openssl rand -base64 24`.
4. Deploy from `warg/`:

   ```bash
   pnpm deploy:all                   # workers, functions and the dashboard (never the rules; prints a rules: not deployed row)
   pnpm run deploy -- --all --with-rules   # the same, then the Firestore and Storage rules
   pnpm run deploy                   # workers only
   pnpm run deploy -- --with-dashboard   # workers, then the dashboard Worker (pnpm deploy:dashboard)
   pnpm run deploy -- --functions-only   # the four Cloud Functions only
   pnpm run deploy -- --with-rules   # workers, then the Firestore and Storage rules
   pnpm run deploy -- --functions-only --with-rules   # the functions, then the rules
   pnpm deploy:quick                 # skip typecheck and tests (the secret check still runs)
   pnpm run deploy -- --with-dashboard --dry-run   # list the targets, the dashboard Worker included; deploys nothing
   ```

   When `firebase deploy` asks for the `--force` option (a new retry policy, for
   example), read its message, then add `--force-functions`. That flag also
   deletes each function that the codebase no longer holds, without asking.

   Plain `pnpm deploy` is pnpm's own built-in command and does not run the
   script; use `pnpm run deploy` or one of the `deploy:*` scripts.

   The dashboard inbox reads its completed-today count from dashboard-api
   (`GET /stats/completed-today`), and the inbox answers 500 when that call
   fails. Deploy dashboard-api with or before the dashboard (`--all`, or
   `--with-functions --with-dashboard`; the script deploys the dashboard last,
   after the workers it binds and the functions). A `--with-dashboard` run
   alone, or a run that holds dashboard-api
   back at the link check, can ship a dashboard whose dashboard-api lacks the
   route; deploy the functions next.

4. Read the summary. The script prints one line per target on every exit:
   `deployed` (the platform shows this run's version id, update time or commit
   hash), `failed`, `unverified` (the command succeeded but the platform did not
   change) or `skipped` (not reached). The run stops at the first failure and
   exits with that command's code; 2 means a usage error or a refused dirty
   tree, 3 a failed verification or a missing secret.

   `--with-pages` (and `pnpm deploy:pages`) is the old name of
   `--with-dashboard` from when the dashboard was a Pages project; it does the
   same.

First deploy of a new worker: each worker declares its required secrets in
`cloudflare.config.ts` and `wrangler.jsonc`, and cf refuses to deploy a worker
whose declared secret is not set. A worker that does not exist yet has no
secrets, so the script cannot deploy it the first time. The
`--allow-missing-secrets <worker>` flag skips only the script's own secret
listing for that worker; it does not get past cf. Deploy the new worker once by
hand from its folder, with its secret values in a local file that is never
committed, then deploy through the script as usual:

```bash
cd workers/<worker>
../../node_modules/.bin/cf deploy --secrets-file <file>
cd ../..
pnpm run deploy
```

Cloud Function bundles: each function deploys as one esbuild bundle. The
firebase.json predeploy runs `pnpm run build:deploy` in the function folder,
which writes `dist-deploy/` with the commit label baked in; `pnpm -r test`
runs the function test suites. Each function folder needs its `.env` (copy
`.env.example`).

Built workspace packages: the workers import `@warg/shared` from its
TypeScript source, but the cloud functions and the dashboard functions import
its `@warg/shared/archive-ids` subpath (and `@warg/article-writer`,
`@warg/url-normalizer`) from built `dist/` output. `pnpm install` builds them
through each package's `prepare` script, `build:deploy` rebuilds each one a
function bundles, and the dashboard deploy rebuilds `@warg/shared`. After editing
one of these packages, run its `build` script (for example
`pnpm --filter @warg/shared run build`) before running a function's tests
locally.

Function secrets and deploy configuration: before any deploy that includes the
functions, the script checks that every Secret Manager secret the functions
bind has an enabled latest version, and that `dashboard-api/.env` sets
`DASHBOARD_USER_ID` and `backfill-archiver/.env` sets `BACKFILL_USER_ID` and `BACKFILL_PASS_LABEL`. A
miss stops the run with exit 3 naming each missing name (never a value) and
the `gcloud secrets create` command that adds it, so firebase-tools never
prompts mid-deploy. The function deploy runs with `--non-interactive`.

Invoker check: after each function codebase verifies, the script reads the
Cloud Run IAM policy of its trigger and scheduled functions
(`onUserArticleSave`, `backfillArchiver`, `articleStatusDerive`) and fails with
exit 3 when one grants `allUsers` or `allAuthenticatedUsers`; a deploy update
leaves IAM as it was, so a public binding never goes unnoticed. The HTTP
functions stay public; their per-caller keys guard them.

Link check: the dashboard reads follow the server-written link
(`canonicalId`), so before any deploy that includes the functions the script
reads the newest link re-derive report
(`cloud-functions/backfill-scripts/tmp/rederive-pass-b-*.json`, or the file
`--rederive-report <path>` names). Unless it is a production dry run that
plans no link to add, change or clear, reports no write error and finds the
duplicate merge finished, `dashboard-api` is held back: its summary row reads
`skipped` with the reason, a warning says so, and the other functions still
deploy. Deploy the functions again after a clean dry run to ship it.
The same report also gates the rules deploy (below).
`--skip-rederive-check` skips both checks, each with a warning; never put it in
a package.json script.

Rules: `--with-rules` deploys `../firebase/` after the functions; `--all`
never includes it. Ship the app release that writes no marker before the first
rules deploy, and run the link re-derive (below) as part of it: the order and
the reasons are in `../firebase/README.md` (Ship order). The step reads the
grace end from the released Firestore rules and keeps it (the first stamped deploy sets it to 30 days later and warns), stamps
it into an LF build copy, deploys that copy non-interactively and compares the
SHA-256 of each released ruleset, read through the Firebase Rules API, with the
build copy; a mismatch stops the run with exit 3. Before any deploy, every run
that includes the rules (`--with-rules` or `--rules-only`) reads the link
re-derive report of the Link check and stops with exit 3 unless it is a
production dry run that plans no marker removal and no error. Rules deploy only
this way (`../firebase/README.md`).

Checking the deploy script: `pnpm deploy:check` runs shellcheck and a stub
harness that drives the script end to end without credentials (CI runs it too).

The `deploy` scripts of the function packages and of `pages/dashboard` only
print a pointer to `scripts/deploy.sh` and exit 1.

**Retiring the old dashboard Pages projects.** The dashboard now deploys as
the Worker `warg-dashboard`; the Pages project `warg-dashboard` (served on
`warg-dashboard.pages.dev`) keeps serving its last deployment until it is
deleted, and so does the project of the old React dashboard if it still
exists, with no sign-in and its own copies of `DASHBOARD_API_KEY` and
`BACKFILL_STATUS_KEY`. Once the Worker serves the dashboard, delete each from
`warg/` and list again to check that none is left:

```bash
pnpm exec cf pages list
pnpm exec cf pages delete <project name>
pnpm exec cf pages list
```

Then rotate `DASHBOARD_API_KEY` and `BACKFILL_STATUS_KEY` with the two steps of
[Rotating the function keys](#rotating-the-function-keys-two-steps), so the
copies the old project held stop working.

The compatibility date of all nine workers lives in
`workers/compatibility-date.mjs`. Each `cloudflare.config.ts` imports it and
each `wrangler.jsonc` repeats it as a literal, because JSONC cannot import; the
same check fails when a file differs from it or quotes its own date. The
renderer may not go below 2026-03-24, the first date with `quickAction()` on
the browser binding. Raise the date on purpose: read the compatibility flags
the new date turns on, then run each worker's tests and `wrangler dev`.

Two configs per worker: `cloudflare.config.ts` is what `cf deploy` and
`cf dev` read, and `wrangler.jsonc` still serves `wrangler types`, the logger's
Workers-pool unit tests, and the `wrangler dev` runs that cf dev cannot do yet
(monolith, and the logger and workflow servers of the browser checks). The
dashboard Worker adds `wrangler.config.ts`, which tells `cf deploy` that its
static files are `public/`. Change a binding in both; `node
scripts/check-worker-configs.mjs` (run in CI, over `workers/*` and
`pages/dashboard`) fails when they disagree.

Each worker's `node_modules/wrangler` (the dashboard's too) is a link that the root `postinstall`
(`scripts/link-worker-bundler.mjs`) creates, because `cf deploy` and `cf dev`
look for wrangler only inside the worker folder; the browser checks' stand-in
logger gets one too. After an install with
`--ignore-scripts`, run `node scripts/link-worker-bundler.mjs` before
deploying. Remove the script and the `postinstall` entry once cf finds the
bundler through the normal Node module lookup, or the workspace stops using the
hoisted linker.

Archive health email: once a day at 08:00 UTC the gateway checks each archive
kind and, when one is below 80% success in the last 24 hours (with at least 5
requests) or had at least one request in the last 24 hours and no success for
48 hours, sends one email through its `HEALTH_EMAIL` binding. A kind with no
request in the last 24 hours does not alert. A request of the last hour is not counted
yet, since it may still be running. Before the first deploy that carries it, set
`HEALTH_ALERT_FROM` and `HEALTH_ALERT_TO` on the `gateway` worker with
`pnpm exec cf workers secrets update <NAME> --worker gateway --type secret_text --text "$VALUE"`
(read the value with `read -rs VALUE` first); the deploy refuses the gateway without them. The
recipient must be a verified destination address in Email Routing, and the
sender must be on a domain of the account with email sending enabled. The
deploy checks only that the two secrets exist, so after the first deploy that
carries the binding, and after any change of either address, send the test
email below and confirm it arrived; the deploy summary prints a reminder when
the gateway deployed. To send a real test email when any kind had a request in
the last 24 hours, run:

```bash
curl -sS -X POST "$GATEWAY_URL/internal/health-check" \
  -H "X-Internal-API-Key: $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"thresholds":{"staleAfterHours":0}}'
```

The answer is the run summary: `alertKinds` lists the kinds it alerted on and
`emailed` says whether the email went out. A `401` means a wrong internal key,
a `400` an out-of-range threshold. The route exists only for this test and for
re-measuring after an alert; it needs the internal key, and its thresholds apply
to that one call, while the daily cron always uses 80%, 5 requests and 48
hours. The optional thresholds are `minRatio` (0 to
1), `minRequests` (integer, 1 to 1000) and `staleAfterHours` (integer, 0 to 48).

### When the health email arrives

The email names each kind that needs attention, its success count and its last
success. Look in this order:

1. The dashboard overview: the stage counts and the error codes of recent
   requests. `R2_CREDENTIAL_INVALID` means a dead credential, `ACCESS_BLOCKED`
   means sites refuse the fetch. `BROWSER_TOKEN_INVALID` appears only on
   requests from before the renderer moved to its browser binding, which needs
   no token.
2. The gateway logs, from `workers/gateway`:
   `pnpm exec wrangler tail gateway --search "kind health"` while you re-measure
   (step 3). The `[gateway] kind health:` line holds the numbers of each kind.
3. Re-measure with the default thresholds. This sends the email again when a
   kind still needs attention:

   ```bash
   curl -sS -X POST "$GATEWAY_URL/internal/health-check" \
     -H "X-Internal-API-Key: $INTERNAL_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{}'
   ```

An email with the subject `Warg archive health: the daily check failed` means
the check itself could not run (for example the logger did not answer); its
text holds the error.

### Reading one archive's trace

The six Workers an archive passes through (gateway, workflow, renderer,
hyperrenderer, singlefile and readability) emit Cloudflare Workers traces: both
config files of each set `observability.traces.enabled`, and
`scripts/check-worker-configs.mjs` fails when the two files differ or when one
of the six drops it. Logger, monolith and gcs are not traced; a call into them
shows as a fetch span of the Worker that calls them. Every Worker of an archive
calls the logger for each event, so tracing it would multiply the spans of each
archive without adding a hop. To follow a failure inside one of the three,
read its Workers Logs, or add `traces: { enabled: true }` to both of its config
files and its name to `TRACED_WORKERS`. Every request is sampled
(the platform default). Traces are kept for seven days, and from 2026-12-01
they count toward Cloudflare Observability usage.

Each archive makes several spans: the gateway request, the workflow start and
each step, every service-binding call to a render Worker, each fetch those
Workers make, and each call to the logger, more when a step retries. The
gateway's crons and `GET /status` polling are traced too. Before 2026-12-01,
read the Observability usage in the dashboard after a week of traffic. To trace
fewer requests, set `head_sampling_rate` under `observability.traces` in
`wrangler.jsonc` and `headSamplingRate` in `cloudflare.config.ts` to the same
value below 1 in both files of each traced Worker; the check fails when the two
differ.

Fetch spans record the full URL of each request and each outbound fetch,
query string included (`url.full`, `url.query`). A render Worker that fetches a
saved page therefore stores that page's URL in the trace for seven days, so a
token or personal data in a saved URL's query string is readable by anyone with
Observability access to the account. Keep that access to the people who may
read the logs.

The runtime emits the spans; no code creates them. Cloudflare documents spans
for fetch calls, R2, D1 and Durable Object binding calls, RPC calls and the
fetch and scheduled handlers, and documents linking a span across Workers for
RPC calls only. Warg's hops are a service-binding fetch (gateway to workflow,
workflow to each render Worker) and an asynchronous Workflow instance, so one
archive may appear as more than one trace. No span is known to carry the
`request_id`: the code adds no span attribute, and the request id travels in
request bodies, not URLs. Two things do carry it: the Workflow instance id is
the `request_id` (characters other than letters, digits, `_` and `-` become
`_`), and `GET /status/<requestId>` lists the logger's events with their times.

To read one archive:

1. Submit one URL and note the `requestId` of the response:

   ```bash
   curl -sS -X POST "$GATEWAY_URL/begin" \
     -H "X-API-Key: $PUBLIC_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://example.com/"}'
   ```

2. Poll `GET /status/<requestId>` (same header) until it is done or failed.
3. Open Workers → Observability → Traces in the Cloudflare dashboard for the
   last 15 minutes and filter by `$metadata.service` (gateway, workflow,
   renderer). From a shell in `warg/`, the same 15 minutes of traces (the query
   needs the dataset; without it the API answers 400):

   ```bash
   pnpm exec cf o11y telemetry query --query-id one-archive --view traces \
     --preview --limit 20 --parameters-datasets cloudflare-workers \
     --timeframe-from $(( ($(date +%s) - 900) * 1000 )) \
     --timeframe-to $(( $(date +%s) * 1000 ))
   ```

   Each trace in the output names its Workers in `$metadata.service`.
4. Note each trace id and which Workers' spans it holds. Join the traces of one
   archive by the Workflow instance id and by the event times of
   `GET /status/<requestId>`. If a span attribute or log field turns out to hold
   the `request_id`, name it here.

### Retiring the renderer's Browser Rendering token (two steps)

The renderer reaches Browser Rendering through its `BROWSER` binding and no
longer reads `BR_API_TOKEN` or `CF_ACCOUNT_ID`. The deploy does not remove the
two secrets from the live worker, so remove them by hand, in this order:

1. Deploy, then keep both secrets until archives through the binding have run
   clean in production. Until then, a `wrangler rollback` of the renderer to a
   version that still calls the REST API works with no further step.
2. From `warg/`, delete both secrets and revoke the API token behind
   `BR_API_TOKEN` in the Cloudflare dashboard (My Profile → API Tokens):

   ```bash
   pnpm exec cf workers secrets delete BR_API_TOKEN --worker renderer
   pnpm exec cf workers secrets delete CF_ACCOUNT_ID --worker renderer
   ```

   A rollback to a REST version after this step needs both secrets set again
   (`read -rs VALUE && pnpm exec cf workers secrets update <NAME> --worker renderer --type secret_text --text "$VALUE"`)
   and a token that is not revoked.

### Retiring the monolith Worker's R2 keys (two steps)

The monolith container reaches R2 through the Worker's R2 handler and the
`ARCHIVE_BUCKET` binding, and the Worker no longer reads `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID` or `R2_SECRET_ACCESS_KEY`. The deploy does not remove the
three secrets from the live worker, so remove them by hand, in this order.
Until they are gone, every deploy that includes monolith ends with
`WARNING: monolith still holds secret(s) it no longer reads: …`.

1. Deploy, then keep all three secrets until one real archive shows
   `archives.monolith` with status `success` and `derived/monolith.html` is in
   R2 (read the `[monolith] r2 handler` lines in the monolith Worker logs).
   Until then, a `wrangler rollback` of monolith to a version that still signs
   R2 URLs works with no further step.
2. From `warg/`, delete the three secrets and revoke the R2 API token behind
   them in the Cloudflare dashboard (R2 → Manage R2 API Tokens):

   ```bash
   pnpm exec cf workers secrets delete R2_ACCESS_KEY_ID --worker monolith
   pnpm exec cf workers secrets delete R2_SECRET_ACCESS_KEY --worker monolith
   pnpm exec cf workers secrets delete R2_ACCOUNT_ID --worker monolith
   ```

   A rollback to a signing version after this step needs the three secrets set
   again (`read -rs VALUE && pnpm exec cf workers secrets update <NAME> --worker monolith --type secret_text --text "$VALUE"`)
   and an R2 API token that is not revoked.

### Rotating the function keys (two steps)

Each caller of the HTTP Cloud Functions has its own key, so a leaked key opens
one function only. Callers send it in the `X-Internal-API-Key` header.

| Secret | Stored in | Sent by | Checked by |
|---|---|---|---|
| `ARCHIVE_GATEWAY_KEY` | Secret Manager and the `gcs` worker | storage worker (`workers/gcs`) | archive-gateway |
| `DASHBOARD_API_KEY` | Secret Manager and the dashboard Worker's secrets | dashboard | dashboard-api |
| `BACKFILL_STATUS_KEY` | Secret Manager and the dashboard Worker's secrets | dashboard | backfillStatus |
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
   pnpm exec cf workers secrets update ARCHIVE_GATEWAY_KEY --worker gcs --type secret_text --text "$(gcloud secrets versions access latest --secret ARCHIVE_GATEWAY_KEY --project trails-e428e)"
   pnpm exec cf workers secrets update DASHBOARD_API_KEY --worker warg-dashboard --type secret_text --text "$(gcloud secrets versions access latest --secret DASHBOARD_API_KEY --project trails-e428e)"
   pnpm exec cf workers secrets update BACKFILL_STATUS_KEY --worker warg-dashboard --type secret_text --text "$(gcloud secrets versions access latest --secret BACKFILL_STATUS_KEY --project trails-e428e)"
   ```

3. **Deploy one.** Set `KEY_ROTATION_DUAL_ACCEPT=true` in the three `.env`
   files, then deploy the functions first:

   ```bash
   pnpm run deploy -- --functions-only
   ```

   Check that a request with the old key still succeeds at each function. Then
   deploy the callers:

   ```bash
   pnpm run deploy -- --with-dashboard
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

### The dashboard sign-in

| Secret | Stored in | Sent by | Checked by |
|---|---|---|---|
| `DASHBOARD_AUTH` (`user:password`) | the dashboard Worker's secrets | the operator's browser (HTTP Basic) | the dashboard's sign-in middleware (`pages/dashboard/functions/_middleware.ts`), which the Worker runs before every page and API route |

Every dashboard page and API call needs it. A request without the right
credential gets 401 `Sign-in required.` with a Basic challenge, so the browser
shows its sign-in prompt; a dashboard with no secret set answers 500
`Dashboard auth is not configured.`; a signed-in write that another site
starts gets 403 `Cross-site request refused.`.

To rotate it, set a new generated value; setting a secret creates a new
version of the Worker, so it takes effect at once and the browser asks for the
new credential at the next request:

```bash
read -rs VALUE && pnpm exec cf workers secrets update DASHBOARD_AUTH --worker warg-dashboard --type secret_text --text "$VALUE"; unset VALUE
```

The middleware does not limit failed sign-ins. Keep the password long and
random (`openssl rand -base64 24`), and, if the dashboard is reachable from the
open internet, add a Cloudflare rate-limiting rule on its hostname for
responses with status 401.

## Merging duplicate shared articles

Older shares of one link with different tracking parameters (`utm_*`, `fbclid`,
a `#section` anchor and so on) left several shared articles (`articles/{id}`) for
the same page. The normalizer drops plain anchors but keeps route fragments (text
after `#` that starts with `/` or `!`, as in `#/watch?v=…` and `#!…`), because on
hash-routed sites they name the page. The duplicate merge in `@warg/backfill-scripts` groups every shared
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
  own id already names a shared article with another URL (an id conflict, often
  a URL that changed after the save), it removes the marker under that id: the
  app chose the id, so nothing proves that shared article is the user's. The
  removal is flagged `archiveLoss` when that shared article has a finished
  archive, and the anomaly is listed for you to decide;
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
bills per skipped document; a page past 10,000 skipped documents answers 400
`{"error":"Page out of range; follow nextCursor instead"}`. The dashboard sends
the cursor with the page number when they step to the next page.

`GET /stats/completed-today` (dashboard-api, `X-Internal-API-Key` like every
other route; a missing or wrong key answers 401) answers
`{"completedToday": <n>, "since": "<UTC midnight, ISO>", "truncated": <bool>}`:
the dashboard user's articles that became complete since the start of the
current UTC day. An article becomes complete when the last of its four core
archives (rendered, readability, markdown, singlefile) succeeds, so a core
archive that is run again today counts its article again. The count reads the
same 2,000 most recently added articles as a filtered list; `truncated` is true
when the user has more, and an older article completed today is then missing
from the count. One count is reused for a minute. The inbox shows this value
as `counts.completedToday` under "Completed today"; before, the dashboard
counted a rolling 24 hours over its 25 most recent completed articles, so the
number can differ from the old one, most around UTC midnight.

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

## Gateway API

The `gateway` worker is the only public entry. Every error answer has the same
shape, `{ "error": "<message>", "code": "<code>", "id": "<id>" }`, and the same
id in the `X-Request-Id` header; the gateway logs each refusal with that id, so
an id a caller quotes matches a log line. The codes are `GATEWAY_ERROR_CODES`
in `workers/gateway/src/errors.ts`.

| Route | Key | Answers |
|---|---|---|
| `POST /begin` | `X-Internal-API-Key` (the operator) or `X-API-Key` (public); the internal key wins when both are sent | `201 { requestId }` |
| `GET /status/:id` | `X-API-Key` | the status, the events and the artifact pointers |
| `GET /status/:id/stream` | `X-API-Key` | the events as server-sent events, held open at most 60 s (`PUBLIC_STATUS_STREAM_MAX_MS`); send `Last-Event-ID` to resume |
| `POST /internal/log`, `/internal/sweep-orphan-queued`, `/internal/health-check` | `X-Internal-API-Key` | operator and worker calls |

`POST /begin` takes a JSON object: `url` (required), an optional `request_id`
(letters, digits, `_` and `-`, at most 40), and the archive options
(`includeScreenshot`, `includePdf` and the others of
`workers/gateway/src/archive-options.ts`). An option of the wrong type is
refused; an unknown key is dropped and its name logged. Only the internal key
may send `dryRun` and `steps`. A `request_id` may be started again only by the
caller that first started it, or by the internal key.

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_JSON` | the body is not JSON |
| 400 | `INVALID_OPTIONS` | the body is not an object, or an option has the wrong type |
| 400 | `INVALID_REQUEST_ID` | the `request_id`, or the id in a `/status/` path, is not a request id |
| 400 | `REQUEST_ID_REQUIRED` | `/status/` with no id |
| 400 | `INVALID_INPUT_URL` | the `url` cannot be archived |
| 401 | `UNAUTHORIZED` | the key is missing or wrong |
| 403 | `OPTION_NOT_ALLOWED` | the public key sent `dryRun` or `steps` |
| 404 | `REQUEST_NOT_FOUND` / `NOT_FOUND` | no such request / no such route |
| 409 | `REQUEST_ID_CONFLICT` | the `request_id` belongs to another caller (a caller should not retry it) |
| 413 | `INVALID_OPTIONS` | the body is over 64 KiB (`MAX_BEGIN_BODY_BYTES`) |
| 502 | `WORKFLOW_TRIGGER_FAILED` | the archive could not start; only the internal key sees the workflow's own `workflowError` |
| 5xx | `STATUS_LOOKUP_FAILED` / `INTERNAL_ERROR` | a status read or the gateway failed; a 500 carries the fixed message `Internal error` |

Changes (2026-11): the error shape and its codes, the `/status/:id/stream`
route, the 403, 409 and 413 refusals, the dropping of unknown option keys, and
the 400 for a `/status/` path that is not a request id are new. Before, a
wrong-typed option was stored as sent, a 500 carried the exception text, and
any `/status/` path reached the logger. The gateway has no version marker; the
callers in this repository (the backfill scheduler, the save trigger and the
dashboard) handle every answer above.

## Structure

- `workers/` - Cloudflare Workers
  - `gateway/` - Public API (POST /begin, GET /status/:id) + cron sweeps + the daily archive health email
  - `workflow/` - Orchestration workflow + browser/sandbox quota DO
  - `renderer/` - Browser rendering
  - `hyperrenderer/` - Fallback renderer (Hyperbrowser) for pages the renderer cannot reach, with stealth off by default (`HYPERBROWSER_STEALTH=none`; see `workers/hyperrenderer/README.md`)
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
