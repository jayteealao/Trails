// The compatibility date of every Warg Worker.
//
// Each workers/<w>/cloudflare.config.ts imports this value. Each
// workers/<w>/wrangler.jsonc repeats it as a literal, because JSONC cannot
// import; scripts/check-worker-configs.mjs fails when any Worker differs.
//
// Raise it on purpose: read the compatibility flags the new date turns on
// (https://developers.cloudflare.com/workers/configuration/compatibility-flags/),
// then run each Worker's tests and `wrangler dev` before deploying.
export const COMPATIBILITY_DATE = '2026-03-24';
