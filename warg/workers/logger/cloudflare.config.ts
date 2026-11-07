import { bindings, defineConfig, exports } from "cf/config";
import { COMPATIBILITY_DATE } from "../compatibility-date.mjs";

/**
 * Secret-like files were detected but not read or migrated: .dev.vars.example. Only `secrets.required` entries are migrated.
 * @see https://developers.cloudflare.com/workers/configuration/secrets/
 */

export default defineConfig({
	worker: {
		name: "logger",
		compatibilityDate: COMPATIBILITY_DATE,
		entrypoint: "src/index.ts",
		workersDev: false,
		observability: {
			enabled: true,
		},
		env: {
			// Required secrets, set with `wrangler secret put`; scripts/deploy.sh checks the same names.
			INTERNAL_API_KEY: bindings.secret(),
			INDEX_DB: bindings.d1({
				name: "warg-requests-index",
				id: "ff077e87-293b-4434-ad9e-ab669c9cbabb",
			}),
			LOGGER_DO: bindings.durableObject({
				worker: "logger",
				exportName: "LoggerDO",
			}),
		},
		// LoggerDO was created by the wrangler migration `v1` (`new_sqlite_classes`),
		// so its lifecycle declaration keeps the SQLite storage engine.
		// See https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
		exports: {
			LoggerDO: exports.durableObject({ storage: "sqlite" }),
		},
	},
});
