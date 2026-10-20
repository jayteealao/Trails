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
   `gcloud auth login` (the function verification through gcloud). The script
   checks the wrangler and firebase sign-ins before the first upload. Start
   Docker before a deploy that includes `monolith` (its container image is
   built locally).
3. Deploy from `warg/`:

   ```bash
   pnpm deploy:all                   # workers, functions and the dashboard
   pnpm run deploy                   # workers only
   pnpm run deploy -- --with-pages   # workers and the dashboard
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
