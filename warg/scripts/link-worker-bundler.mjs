// Links the workspace's wrangler into each worker's own node_modules: the
// workers/* folders, the dashboard Worker (pages/dashboard) and the browser
// checks' stand-in logger (pages/dashboard/e2e/stub-logger).
//
// `cf deploy` and `cf dev` (cf 1.0.0-beta.17, their project-discovery step)
// look for the Wrangler bundler and dev server only at
// `<worker dir>/node_modules/wrangler` and do not walk up to the workspace
// root. This workspace installs with `node-linker=hoisted`, so pnpm puts
// wrangler only in the root node_modules. Runs as the root postinstall, so
// every install (local and CI) leaves each worker buildable and runnable by cf.
// TODO: delete this script and the postinstall entry once cf resolves the
// bundler through the Node module path, or the workspace moves off the
// hoisted linker (see "Deploying" in warg/README.md).
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'node_modules', 'wrangler');
if (!existsSync(join(target, 'package.json'))) {
  console.error(`link-worker-bundler: ${target} is missing; run pnpm install first`);
  process.exit(1);
}

const workersDir = join(root, 'workers');
const workerDirs = [
  ...readdirSync(workersDir).map((worker) => join(workersDir, worker)),
  join(root, 'pages', 'dashboard'),
  join(root, 'pages', 'dashboard', 'e2e', 'stub-logger'),
];
for (const dir of workerDirs) {
  if (!existsSync(join(dir, 'cloudflare.config.ts'))) continue;
  const modules = join(dir, 'node_modules');
  const link = join(modules, 'wrangler');
  let present = false;
  try {
    lstatSync(link);
    present = true;
  } catch {
    // not linked yet
  }
  if (present) continue;
  mkdirSync(modules, { recursive: true });
  // A junction needs no elevated rights on Windows; other platforms ignore the type.
  symlinkSync(target, link, 'junction');
}
