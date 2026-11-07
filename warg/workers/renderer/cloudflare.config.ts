import { bindings, defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "renderer",
		compatibilityDate: "2025-01-01",
		entrypoint: "src/index.ts",
		workersDev: false,
		observability: {
			enabled: true,
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
