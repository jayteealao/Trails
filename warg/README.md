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
