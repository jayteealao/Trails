import { bindings, defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "singlefile",
		compatibilityDate: "2025-01-01",
		compatibilityFlags: [
			"nodejs_compat",
		],
		entrypoint: "src/index.ts",
		workersDev: false,
		observability: {
			enabled: true,
		},
		env: {
			ARCHIVE_BUCKET: bindings.r2({
				name: "warg-archives",
			}),
			MYBROWSER: bindings.browser({}),
		},
	},
});
