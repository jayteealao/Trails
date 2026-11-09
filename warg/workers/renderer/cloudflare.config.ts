import { bindings, defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "renderer",
		compatibilityDate: "2026-03-24",
		entrypoint: "src/index.ts",
		workersDev: false,
		observability: {
			enabled: true,
		},
		env: {
			BROWSER: bindings.browser({}),
			ARCHIVE_BUCKET: bindings.r2({
				name: "warg-archives",
			}),
		},
	},
});
