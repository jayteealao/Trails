import { bindings, defineConfig, exports } from "cf/config";

/**
 * Secret-like files were detected but not read or migrated: .dev.vars.example. Only `secrets.required` entries are migrated.
 * @see https://developers.cloudflare.com/workers/configuration/secrets/
 */

export default defineConfig({
	worker: {
		name: "workflow",
		compatibilityDate: "2025-01-01",
		entrypoint: "src/index.ts",
		workersDev: false,
		observability: {
			enabled: true,
		},
		env: {
			MOCK_PIPELINE: bindings.text("false"),
			ARCHIVE_BUCKET: bindings.r2({
				name: "warg-archives",
			}),
			LOGGER: bindings.worker({
				worker: "logger",
			}),
			RENDERER: bindings.worker({
				worker: "renderer",
			}),
			HYPERRENDERER: bindings.worker({
				worker: "hyperrenderer",
			}),
			SINGLEFILE: bindings.worker({
				worker: "singlefile",
			}),
			READABILITY: bindings.worker({
				worker: "readability",
			}),
			MONOLITH: bindings.worker({
				worker: "monolith",
			}),
			GCS: bindings.worker({
				worker: "gcs",
			}),
			BROWSER_QUOTA: bindings.durableObject({
				worker: "workflow",
				exportName: "BrowserQuotaDO",
			}),
			ARCHIVE_WORKFLOW: bindings.workflow({
				name: "archive-workflow",
				worker: "workflow",
				exportName: "ArchiveWorkflow",
			}),
		},
		// BrowserQuotaDO was created by the wrangler migration `v1` (`new_classes`),
		// so its lifecycle declaration keeps the legacy key-value storage engine.
		// See https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
		exports: {
			ArchiveWorkflow: exports.workflow({
				name: "archive-workflow",
			}),
			BrowserQuotaDO: exports.durableObject({ storage: "legacy-kv" }),
		},
	},
});
