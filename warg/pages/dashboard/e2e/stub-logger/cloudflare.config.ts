import { defineConfig } from "cf/config";

// A stand-in for the logger service, for the dashboard's browser checks only.
// playwright.config.ts starts it from this folder with
// `cf dev --mode e2e`, and the dashboard reaches it through its LOGGER
// service binding. It shares the real logger's name so that binding finds it,
// so it must never be deployed: the config throws in any mode but e2e, and
// `cf deploy` evaluates it with no mode.
export default defineConfig(({ mode }) => {
	if (mode !== "e2e") {
		throw new Error(
			"e2e/stub-logger is the browser checks' stand-in for the logger; run it only with `cf dev --mode e2e`, never deploy it",
		);
	}
	return {
		worker: {
			name: "logger",
			compatibilityDate: "2025-06-01",
			entrypoint: "index.ts",
		},
	};
});
