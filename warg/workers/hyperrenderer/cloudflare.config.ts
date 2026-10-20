import { bindings, defineConfig } from "cf/config";

/**
 * Secret-like files were detected but not read or migrated: .dev.vars.example. Only `secrets.required` entries are migrated.
 * @see https://developers.cloudflare.com/workers/configuration/secrets/
 */

export default defineConfig({
	worker: {
		name: "hyperrenderer",
		compatibilityDate: "2025-01-01",
		entrypoint: "src/index.ts",
		workersDev: false,
		observability: {
			enabled: true,
		},
		env: {
			HYPERBROWSER_BASE_URL: bindings.text("https://api.hyperbrowser.ai"),
			HYPERBROWSER_STEALTH: bindings.text("auto"),
			HYPERBROWSER_WAIT_UNTIL: bindings.text("load"),
			HYPERBROWSER_NAV_TIMEOUT_MS: bindings.text("30000"),
			HYPERBROWSER_WAIT_FOR_MS: bindings.text("0"),
			HYPERBROWSER_SCRAPE_TIMEOUT_MS: bindings.text("90000"),
			HYPERBROWSER_POLL_INTERVAL_MS: bindings.text("2000"),
			HYPERBROWSER_PDF_TIMEOUT_MS: bindings.text("45000"),
			HYPERBROWSER_SCREENSHOT_FORMAT: bindings.text("png"),
			ARCHIVE_BUCKET: bindings.r2({
				name: "warg-archives",
			}),
		},
	},
});
