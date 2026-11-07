import { bindings, defineConfig } from "cf/config";
import { COMPATIBILITY_DATE } from "../compatibility-date.mjs";

export default defineConfig({
	worker: {
		name: "renderer",
		compatibilityDate: COMPATIBILITY_DATE,
		entrypoint: "src/index.ts",
		workersDev: false,
		// Workers tracing: the runtime emits the spans; enabled alone turns on logs only.
		observability: {
			enabled: true,
			traces: { enabled: true },
		},
		env: {
			// Required secrets, set with `wrangler secret put`; scripts/deploy.sh checks the same names.
			INTERNAL_API_KEY: bindings.secret(),
			CF_ACCOUNT_ID: bindings.secret(),
			BR_API_TOKEN: bindings.secret(),
			ARCHIVE_BUCKET: bindings.r2({
				name: "warg-archives",
			}),
		},
	},
});
