import { bindings, defineConfig } from "cf/config";
import { COMPATIBILITY_DATE } from "../compatibility-date.mjs";

export default defineConfig({
	worker: {
		name: "gcs",
		compatibilityDate: COMPATIBILITY_DATE,
		compatibilityFlags: [
			"nodejs_compat",
		],
		entrypoint: "src/index.ts",
		workersDev: false,
		observability: {
			enabled: true,
		},
		env: {
			// Required secrets, set with `wrangler secret put`; scripts/deploy.sh checks the same names.
			INTERNAL_API_KEY: bindings.secret(),
			ARCHIVE_GATEWAY_KEY: bindings.secret(),
			CLOUD_FN_BASE_URL: bindings.secret(),
			ARCHIVE_BUCKET: bindings.r2({
				name: "warg-archives",
			}),
		},
	},
});
