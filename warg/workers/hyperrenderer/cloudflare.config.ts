import { bindings, defineConfig } from "cf/config";
import { COMPATIBILITY_DATE } from "../compatibility-date.mjs";

/**
 * Secret-like files were detected but not read or migrated: .dev.vars.example. Only `secrets.required` entries are migrated.
 * @see https://developers.cloudflare.com/workers/configuration/secrets/
 */

export default defineConfig({
	worker: {
		name: "hyperrenderer",
		compatibilityDate: COMPATIBILITY_DATE,
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
			HYPERBROWSER_API_KEY: bindings.secret(),
			HYPERBROWSER_BASE_URL: bindings.text("https://api.hyperbrowser.ai"),
			// Stealth is off by default; set "auto" or "ultra" (here and in wrangler.jsonc) to opt in.
			HYPERBROWSER_STEALTH: bindings.text("none"),
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
