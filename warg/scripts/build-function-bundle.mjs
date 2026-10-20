// Builds the deploy folder of one cloud function.
//
// Run from a function folder (`pnpm run build:deploy`). Writes exactly three
// files to dist-deploy/: index.js (one ESM bundle for Node 22), index.js.map,
// and a generated package.json. The function's declared dependencies (the
// Firebase runtime packages, pinned exactly) stay external and are installed
// by Cloud Build from the generated package.json; everything else, including
// any workspace package, is bundled. The commit SHA is baked in as GIT_SHA
// and logged once when the bundle loads.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXACT = /^\d+\.\d+\.\d+$/;

// The single structured log line each instance prints when it loads the bundle.
export function shaBanner(sha) {
  const value = JSON.stringify(sha);
  return (
    `globalThis.GIT_SHA = ${value}; ` +
    `console.log(JSON.stringify({ severity: "INFO", message: "function bundle loaded", gitSha: ${value} }));`
  );
}

// GIT_SHA from the environment wins (deploy.sh passes its own label);
// otherwise HEAD, suffixed -dirty when the tree has uncommitted changes.
export function resolveSha(dir, env = process.env) {
  if (env.GIT_SHA && env.GIT_SHA.trim()) return env.GIT_SHA.trim();
  const git = (args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let sha;
  try {
    sha = git(['rev-parse', 'HEAD']);
  } catch (err) {
    throw new Error(`cannot determine the commit SHA (set GIT_SHA or build inside the repo): ${err.message}`, { cause: err });
  }
  if (!sha) throw new Error('cannot determine the commit SHA: git rev-parse HEAD printed nothing');
  return git(['status', '--porcelain']) ? `${sha}-dirty` : sha;
}

// Single-name workspace overrides, in npm's form. Parent-scoped pnpm entries
// (`a>b`) are skipped: an npm nested override reaches every descendant, not
// only the direct dependency, which breaks express 5's own path-to-regexp.
export function npmOverrides(rootPkg) {
  const all = rootPkg.pnpm?.overrides ?? {};
  return Object.fromEntries(Object.entries(all).filter(([name]) => !name.includes('>')));
}

export async function buildFunctionBundle({ dir = process.cwd(), sha, rootPkg } = {}) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const deps = pkg.dependencies ?? {};
  for (const [name, spec] of Object.entries(deps)) {
    if (!EXACT.test(spec)) {
      throw new Error(`${pkg.name}: dependency ${name} must be pinned to an exact x.y.z version, found "${spec}"`);
    }
  }
  const label = sha ?? resolveSha(dir);
  const root = rootPkg ?? JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8'));
  const out = join(dir, 'dist-deploy');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const names = Object.keys(deps);
  await build({
    absWorkingDir: dir,
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: true,
    outfile: join(out, 'index.js'),
    external: [...names, ...names.map((name) => `${name}/*`)],
    define: { GIT_SHA: JSON.stringify(label) },
    banner: { js: shaBanner(label) },
    logLevel: 'warning'
  });

  const manifest = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    type: 'module',
    main: 'index.js',
    engines: { node: '22' },
    dependencies: deps,
    overrides: npmOverrides(root)
  };
  writeFileSync(join(out, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { sha: label, out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { sha, out } = await buildFunctionBundle();
    console.log(`built ${out} at ${sha}`);
  } catch (err) {
    console.error(`build-function-bundle: ${err.message}`);
    process.exit(1);
  }
}
