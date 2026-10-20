# Runbook: warg-worker-secret-missing

## When this fires

CI logs matching any of the following patterns trigger this runbook:

- `(?i)wrangler.*(secret|unauthorized|missing binding)`
- `(?i)INTERNAL_API_KEY`

## Steps

1. Identify the worker and secret from the deploy.sh header (e.g. renderer needs INTERNAL_API_KEY, CF_ACCOUNT_ID, BR_API_TOKEN).
2. Set it: pnpm --dir warg exec wrangler secret put <NAME> --config workers/<worker>/wrangler.jsonc.
3. Re-run: cd warg && pnpm deploy:all (or pnpm run deploy -- <flags>; plain `pnpm deploy` is a pnpm built-in and does not run deploy.sh).
4. The first deploy of a new worker has no secrets to list yet: pass `--allow-missing-secrets <worker>` for that one run (`pnpm run deploy -- --allow-missing-secrets <worker>`), then set its secrets and deploy again without the flag.

## Notes

_Operational runbook for the Warg backend deploy. Update as the process evolves._
