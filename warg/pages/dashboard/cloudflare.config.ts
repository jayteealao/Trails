import { bindings, defineConfig } from "cf/config";

// The dashboard Worker, deployed by scripts/deploy.sh with `cf deploy`.
// wrangler.config.ts names the static assets directory (public/);
// wrangler.jsonc serves `wrangler dev` and `wrangler types`. Change a binding
// in both cloudflare.config.ts and wrangler.jsonc.
//
// Secrets are not declared here, as for the other Warg workers: deploy.sh
// required_secrets_for() lists them and its preflight stops a deploy that
// lacks one.

export default defineConfig({
	worker: {
		name: "warg-dashboard",
		compatibilityDate: "2024-01-01",
		entrypoint: "src/index.ts",
		observability: {
			enabled: true,
		},
		// Every request runs the Worker first, so the sign-in middleware guards
		// the static pages too; an unknown path gets index.html, as on Pages.
		assets: {
			notFoundHandling: "single-page-application",
			runWorkerFirst: true,
		},
		env: {
			BACKFILL_STATUS_URL: bindings.text("https://us-central1-trails-e428e.cloudfunctions.net/backfillStatus"),
			DASHBOARD_API_URL: bindings.text("https://us-central1-trails-e428e.cloudfunctions.net/dashboardApi"),
			LOGGER: bindings.worker({
				worker: "logger",
			}),
			GATEWAY: bindings.worker({
				worker: "gateway",
			}),
			ASSETS: bindings.assets(),
		},
	},
});
