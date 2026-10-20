import { bindings, defineConfig, triggers } from "cf/config";

/**
 * Secret-like files were detected but not read or migrated: .dev.vars.example. Only `secrets.required` entries are migrated.
 * @see https://developers.cloudflare.com/workers/configuration/secrets/
 */

export default defineConfig({
	worker: {
		name: "gateway",
		compatibilityDate: "2025-01-01",
		entrypoint: "src/index.ts",
		observability: {
			enabled: true,
		},
		triggers: [
			triggers.scheduled({
				schedule: "*/10 * * * *",
			}),
		],
		env: {
			ARCHIVE_BUCKET: bindings.r2({
				name: "warg-archives",
			}),
			LOGGER: bindings.worker({
				worker: "logger",
			}),
			WORKFLOW: bindings.worker({
				worker: "workflow",
			}),
			MONOLITH: bindings.worker({
				worker: "monolith",
			}),
		},
	},
});
