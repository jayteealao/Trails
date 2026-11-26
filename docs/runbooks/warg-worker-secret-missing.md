# Runbook: warg-worker-secret-missing

## When this fires

CI logs matching any of the following patterns trigger this runbook:

- `(?i)wrangler.*(secret|unauthorized|missing binding)`
- `(?i)INTERNAL_API_KEY`

## Steps

1. Identify the worker and secret from the deploy.sh header (e.g. hyperrenderer needs INTERNAL_API_KEY, HYPERBROWSER_API_KEY).
2. Set it: `pnpm --dir warg exec cf workers secrets update <NAME> --worker <worker> --type secret_text --text "$VALUE"`.
3. Re-run: cd warg && pnpm deploy:all (or pnpm run deploy -- <flags>; plain `pnpm deploy` is a pnpm built-in and does not run deploy.sh).
4. The first deploy of a new worker: cf refuses a worker whose declared secrets are not set, and a worker that does not exist yet has no secrets to set. Deploy it once by hand with its secrets from a file, from `warg/workers/<worker>`: `../../node_modules/.bin/cf deploy --secrets-file <file>`. Delete the file afterwards. Then run `pnpm run deploy` from `warg` as usual. `--allow-missing-secrets <worker>` skips only the preflight listing of deploy.sh; it does not make the first deploy pass on its own.

## Notes

_Operational runbook for the Warg backend deploy. Update as the process evolves._
