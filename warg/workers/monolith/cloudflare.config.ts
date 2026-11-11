import { bindings, defineConfig, defineContainer, exports } from "cf/config";
import { COMPATIBILITY_DATE } from "../compatibility-date.mjs";

// The container application keeps the name wrangler derived for it
// (`<worker name>-<class_name>`, lower-cased), so the deploy updates the live
// application instead of creating a second one.
// Lifecycle: containers are stopped per job (stop() in a finally block in
// src/index.ts) with a 5m sleepAfter backstop set on the Sandbox subclass there.
const sandbox = defineContainer({
	name: "monolith-sandbox",
	image: { dockerfile: "./Dockerfile" },
	// standard-1 (4 GiB): better-resourced containers provision more reliably
	// and avoid OOM when monolith base64-inlines heavy pages.
	instanceType: "standard-1",
	maxInstances: 5,
});

export default defineConfig({
	worker: {
		name: "monolith",
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
			// Required secrets, set with `cf workers secrets update`; scripts/deploy.sh checks the same names.
			INTERNAL_API_KEY: bindings.secret(),
			R2_ACCOUNT_ID: bindings.secret(),
			R2_ACCESS_KEY_ID: bindings.secret(),
			R2_SECRET_ACCESS_KEY: bindings.secret(),
			R2_BUCKET_NAME: bindings.text("warg-archives"),
			ARCHIVE_BUCKET: bindings.r2({
				name: "warg-archives",
			}),
			Sandbox: bindings.durableObject({
				worker: "monolith",
				exportName: "Sandbox",
			}),
		},
		// Sandbox was created by the wrangler migration `v1` (`new_sqlite_classes`),
		// so its lifecycle declaration keeps the SQLite storage engine.
		// See https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
		exports: {
			Sandbox: exports.durableObject({ storage: "sqlite", container: sandbox }),
		},
	},
	containers: [sandbox],
});
