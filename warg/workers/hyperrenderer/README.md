# hyperrenderer

Fallback renderer. When the primary renderer fails in a way another browser may
not (a blocked page, a dead host, a proxy error page, a browser crash), the workflow asks this
worker to render it through Hyperbrowser. Internal worker
(`X-Internal-API-Key` required).

## Configuration

`HYPERBROWSER_STEALTH` sets the stealth mode of the Hyperbrowser session:

| Value | Session |
|---|---|
| `none` (default) | no stealth flag; the renderer does not mask its identity |
| `auto` | `useStealth` |
| `ultra` | `useUltraStealth` (plan-gated by Hyperbrowser) |

A missing or unknown value means `none`. To opt in, set the same value in
both deployed configs, `workers/hyperrenderer/wrangler.jsonc` and
`workers/hyperrenderer/cloudflare.config.ts` (`scripts/check-worker-configs.mjs`
fails when they differ), and in `.dev.vars` for local runs (see
`.dev.vars.example`). Then redeploy the hyperrenderer.

## Logs

Every fallback render that this worker answers, with a result or an error,
is logged with the stealth setting it used: `renderFallbackStealth` in the
request diagnostics, next to `renderFallbackUsed` and `renderFallbackReason`.
A fallback that gets no answer (a network failure or a timeout) logs
`renderFallbackUsed` and `renderFallbackReason` without a stealth setting, and
so does one answered by a hyperrenderer deployed before the setting was
reported. To judge what turning stealth off costs, count fallbacks by
`renderFallbackUsed` and their outcome; a count by `renderFallbackStealth` is a
lower bound.
