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
			ARCHIVE_BUCKET: bindings.r2({
				name: "warg-archives",
			}),
		},
	},
});
