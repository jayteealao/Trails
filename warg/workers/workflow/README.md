# workflow

Cloudflare Workflows orchestrator for the URL-to-archive pipeline. Internal
worker (`X-Internal-API-Key` required on all HTTP routes).

Steps in order: `render → derive → manifest → persist → done`

Each quota-gated step (render, monolith, singlefile) calls into
`BrowserQuotaDO` to acquire a container lease before starting work.

## Quota-acquire config

Quota acquisition is a bounded retry loop in `src/quota-acquire.ts`:

| Setting | Value | Notes |
|---|---|---|
| `MAX_QUOTA_ATTEMPTS` | 20 | maximum acquire attempts before giving up |
| `QUOTA_SLEEP_DURATION` | `'30 seconds'` | `step.sleep` between denied attempts |
| Worst-case wait | 10 minutes | 20 × 30s, matching the orphan cron-sweep window |
| Inner step retries | 2 | transient DO errors only; quota denial is a return value, not an exception |

Each `step.sleep` suspends the workflow and bills zero CPU. A quota grant
failure after all attempts throws a plain `Error` — the request must be
manually resubmitted; there is no automatic retry at the workflow level.

## Tests

```bash
pnpm --filter @warg/workflow test
```
