// The secrets that the runtime tests read from `env` (`cloudflare:test`).
// The bindings come from the generated worker-configuration.d.ts.
declare namespace Cloudflare {
  interface Env {
    INTERNAL_API_KEY: string;
    PUBLIC_API_KEY: string;
    HEALTH_ALERT_FROM: string;
    HEALTH_ALERT_TO: string;
  }
}
