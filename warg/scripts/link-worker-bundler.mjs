// Links the workspace's wrangler into each worker's own node_modules.
//
// `cf deploy` looks for the Wrangler bundler only at
// `<worker dir>/node_modules/wrangler` and does not walk up to the workspace
// root (source: node_modules/cf/dist/discover-P20XeGBF.mjs, cf 1.0.0-beta.17,
// function `f`: join(cwd, "node_modules", pkg, "package.json")). This workspace
// installs with `node-linker=hoisted`, so pnpm puts wrangler only in the root
// node_modules. Runs as the root postinstall, so every install (local and CI)
// leaves each worker buildable by cf.
// sdlc-debt: remove once cf resolves the bundler through the Node module path
// (or the workspace moves off the hoisted linker).
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
for (const worker of readdirSync(workersDir)) {
  if (!existsSync(join(workersDir, worker, 'cloudflare.config.ts'))) continue;
  const modules = join(workersDir, worker, 'node_modules');
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
