import { bindings, defineConfig, triggers } from "cf/config";
import { COMPATIBILITY_DATE } from "../compatibility-date.mjs";

/**
 * Secret-like files were detected but not read or migrated: .dev.vars.example. Only `secrets.required` entries are migrated.
 * @see https://developers.cloudflare.com/workers/configuration/secrets/
 */

export default defineConfig({
	worker: {
		name: "gateway",
		compatibilityDate: COMPATIBILITY_DATE,
		entrypoint: "src/index.ts",
		// Workers tracing: the runtime emits the spans; enabled alone turns on logs only.
		observability: {
			enabled: true,
			traces: { enabled: true },
		},
		triggers: [
			triggers.scheduled({
				schedule: "*/10 * * * *",
			}),
			triggers.scheduled({
				schedule: "0 8 * * *",
			}),
		],
		env: {
			// Required secrets, set with `wrangler secret put`; scripts/deploy.sh checks the same names.
			INTERNAL_API_KEY: bindings.secret(),
			PUBLIC_API_KEY: bindings.secret(),
			HEALTH_ALERT_FROM: bindings.secret(),
			HEALTH_ALERT_TO: bindings.secret(),
			ARCHIVE_BUCKET: bindings.r2({
				name: "warg-archives",
			}),
			LOGGER: bindings.worker({
				worker: "logger",
			}),
			WORKFLOW: bindings.worker({
				worker: "workflow",
			}),
			HEALTH_EMAIL: bindings.sendEmail({}),
		},
	},
});
