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
  - `gateway/` - Public API (POST /begin, GET /status/:id)
  - `workflow/` - Orchestration workflow
  - `renderer/` - Browser rendering
  - `singlefile/` - SingleFile HTML extraction
  - `readability/` - Readability extraction
  - `monolith/` - Monolith HTML extraction
  - `gcs/` - GCS persistence coordinator
- `packages/shared/` - Shared types and utilities
- `cloud-functions/archive-gateway/` - Google Cloud Function for GCS/Firestore

All workers are placeholders returning 501 Not Implemented.
