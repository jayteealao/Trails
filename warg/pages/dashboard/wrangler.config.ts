import { defineWranglerConfig } from "wrangler/experimental-config";

// Build settings that `cf deploy` reads beside cloudflare.config.ts: the
// static files are public/ alone, never the folder that holds src/ and
// node_modules.
export default defineWranglerConfig({
	assetsDirectory: "public",
});
