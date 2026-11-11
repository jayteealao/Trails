import { bindings, defineConfig } from "cf/config";
import { COMPATIBILITY_DATE } from "../compatibility-date.mjs";

export default defineConfig({
	worker: {
		name: "readability",
		compatibilityDate: COMPATIBILITY_DATE,
		compatibilityFlags: [
			"nodejs_compat",
		],
		entrypoint: "src/index.ts",
		workersDev: false,
		// Workers tracing: the runtime emits the spans; enabled alone turns on logs only.
		observability: {
			enabled: true,
			traces: { enabled: true },
		},
		env: {
			// Required secrets, set with `cf workers secrets update`; scripts/deploy.sh checks the same names.
			INTERNAL_API_KEY: bindings.secret(),
			ARCHIVE_BUCKET: bindings.r2({
				name: "warg-archives",
			}),
		},
	},
});
