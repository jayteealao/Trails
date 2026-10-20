// Checks each cloud function's deploy folder the way Cloud Build will use it.
//
//   node scripts/check-function-bundle.mjs [functionDir...]
//
// With no argument it checks every cloud-functions/* folder whose firebase.json
// deploys from dist-deploy. Per function: the generated package.json pins
// exactly the Firebase runtime packages (no workspace:, file: or link:
// specifier); dist-deploy holds only the bundle, its map and the manifest; the
// bundle imports nothing undeclared; firebase-tools can package the folder;
// npm resolves the manifest (as Cloud Build does) to a tree where express is
// 4.22.2 or later and every workspace override holds; and importing the
// bundle logs its commit SHA exactly once. Exits 1 on any failure.
import { execFileSync, execSync } from 'node:child_process';
import { builtinModules, createRequire } from 'node:module';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import semver from 'semver';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const RUNTIME_PINS = {
  'firebase-functions': '7.4.0',
  'firebase-admin': '14.5.0',
  '@google-cloud/storage': '7.21.0'
};
export const MIN_EXPRESS = '4.22.2';
const DEPLOY_FILES = ['index.js', 'index.js.map', 'package.json'];
const LOCAL_SPEC = /^(workspace|file|link):/;
const BANNER = /^globalThis\.GIT_SHA = "([^"]*)";.*"function bundle loaded"/;

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

// The generated package.json against the function's own package.json.
export function checkManifest(pkg, sourcePkg) {
  const errors = [];
  if (pkg.main !== 'index.js') errors.push(`main is ${JSON.stringify(pkg.main)}, expected "index.js"`);
  if (pkg.type !== 'module') errors.push(`type is ${JSON.stringify(pkg.type)}, expected "module"`);
  if (pkg.engines?.node !== '22') errors.push(`engines.node is ${JSON.stringify(pkg.engines?.node)}, expected "22"`);
  const deps = pkg.dependencies ?? {};
  const sourceDeps = sourcePkg.dependencies ?? {};
  for (const name of ['firebase-functions', 'firebase-admin']) {
    if (!(name in deps)) errors.push(`dependency ${name} is missing`);
  }
  for (const [name, spec] of Object.entries(deps)) {
    if (!(name in RUNTIME_PINS)) errors.push(`dependency ${name} is not an allowed runtime package`);
    else if (spec !== RUNTIME_PINS[name]) errors.push(`dependency ${name} is "${spec}", expected exactly "${RUNTIME_PINS[name]}"`);
    if (sourceDeps[name] !== spec) errors.push(`dependency ${name} is "${spec}" but the function declares "${sourceDeps[name]}"`);
  }
  for (const name of Object.keys(sourceDeps)) {
    if (!(name in deps)) errors.push(`dependency ${name} of the function is missing from the generated package.json`);
  }
  for (const [field, entries] of [['dependencies', deps], ['overrides', pkg.overrides ?? {}]]) {
    for (const [name, spec] of Object.entries(entries)) {
      if (typeof spec === 'string' && LOCAL_SPEC.test(spec)) errors.push(`${field}.${name} uses a local specifier "${spec}"`);
    }
  }
  return errors;
}

// Every bare specifier the bundle imports at runtime.
export function bundleImports(code) {
  const specs = new Set();
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const pattern of patterns) for (const match of code.matchAll(pattern)) specs.add(match[1]);
  return [...specs];
}

const isBuiltin = (spec) => spec.startsWith('node:') || builtinModules.includes(spec);
const packageName = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

// The deploy folder: exactly the three files, the SHA banner, no undeclared import.
export function checkFolder(dir) {
  const errors = [];
  const out = join(dir, 'dist-deploy');
  if (!existsSync(out)) return { errors: [`${out} does not exist; run pnpm run build:deploy`], sha: '' };
  const files = readdirSync(out).sort();
  if (files.join() !== [...DEPLOY_FILES].sort().join()) {
    errors.push(`dist-deploy holds [${files.join(', ')}], expected exactly [${DEPLOY_FILES.join(', ')}]`);
  }
  if (!existsSync(join(out, 'index.js'))) return { errors, sha: '' };
  const code = readFileSync(join(out, 'index.js'), 'utf8');
  const sha = BANNER.exec(code.split('\n', 1)[0])?.[1] ?? '';
  if (!sha) errors.push('the first line of index.js does not carry the commit SHA banner');
  const declared = new Set(Object.keys(existsSync(join(out, 'package.json')) ? json(join(out, 'package.json')).dependencies ?? {} : {}));
  for (const spec of bundleImports(code)) {
    if (isBuiltin(spec)) continue;
    if (spec.startsWith('.') || spec.startsWith('/')) errors.push(`index.js imports the file "${spec}", which is not in the deploy folder`);
    else if (!declared.has(packageName(spec))) errors.push(`index.js imports "${spec}", which the generated package.json does not declare`);
  }
  return { errors, sha };
}

// An npm package-lock (v3) of the resolved deploy tree against the workspace overrides.
export function checkLock(lock, overrides) {
  const errors = [];
  const instances = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path || !entry.version || entry.link) continue;
    const parts = path.split('node_modules/');
    const name = parts.at(-1).replace(/\/$/, '');
    const parent = parts.length > 2 ? parts.at(-2).replace(/\/$/, '') : '';
    instances.push({ path, name, parent, version: entry.version });
  }
  for (const it of instances) {
    if (it.name === 'express' && !semver.gte(it.version, MIN_EXPRESS)) {
      errors.push(`${it.path} is express ${it.version}, expected ${MIN_EXPRESS} or later`);
    }
  }
  for (const [key, range] of Object.entries(overrides ?? {})) {
    if (!semver.validRange(range)) {
      errors.push(`override ${key} has a range the check cannot read: "${range}"`);
      continue;
    }
    const [parent, name] = key.includes('>') ? key.split('>').slice(-2) : ['', key];
    for (const it of instances) {
      if (it.name !== name || (parent && it.parent !== parent)) continue;
      if (!semver.satisfies(it.version, range, { includePrerelease: true })) {
        errors.push(`${it.path} is ${name} ${it.version}, which breaks the workspace override ${key} "${range}"`);
      }
    }
  }
  return errors;
}

// Repository rules: no per-function npm lockfile or .npmrc; dist-deploy sources keep their env files.
export function checkRepo(root) {
  const errors = [];
  const functions = [];
  const base = join(root, 'cloud-functions');
  for (const fn of readdirSync(base).sort()) {
    const dir = join(base, fn);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of ['package-lock.json', '.npmrc']) {
      if (existsSync(join(dir, file))) errors.push(`cloud-functions/${fn}/${file} must not exist`);
    }
    if (!existsSync(join(dir, 'firebase.json'))) continue;
    const config = json(join(dir, 'firebase.json')).functions?.[0] ?? {};
    if (config.source !== 'dist-deploy') continue;
    functions.push(dir);
    if (config.configDir !== '.') errors.push(`cloud-functions/${fn}/firebase.json deploys from dist-deploy without configDir "."`);
  }
  return { errors, functions };
}

// Runs the packaging step firebase-tools runs before each functions upload (no network, no credentials).
async function checkPackaging(dir) {
  const require = createRequire(import.meta.url);
  const { prepareFunctionsUpload } = require('firebase-tools/lib/deploy/functions/prepareFunctionsUpload');
  let zip;
  try {
    const result = await prepareFunctionsUpload(dir, join(dir, 'dist-deploy'), {}, [], undefined);
    zip = result?.pathToSource;
    if (!zip || !existsSync(zip) || statSync(zip).size === 0) return ['firebase-tools produced no upload archive'];
    return [];
  } catch (err) {
    return [`firebase-tools could not package dist-deploy: ${err.message}`];
  } finally {
    if (zip) rmSync(zip, { force: true });
  }
}

// Resolves the manifest with npm in a temp folder, checks the tree, and imports the bundle.
function checkResolvedTree(dir, sha, overrides) {
  const errors = [];
  const temp = mkdtempSync(join(tmpdir(), 'function-bundle-'));
  try {
    cpSync(join(dir, 'dist-deploy'), temp, { recursive: true });
    // A fixed command line through the shell, so npm's .cmd shim also runs on Windows.
    execSync('npm install --omit=dev --ignore-scripts --no-audit --no-fund', {
      cwd: temp,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    errors.push(...checkLock(json(join(temp, 'package-lock.json')), overrides));
    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', "await import('./index.js')"], {
      cwd: temp,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const lines = stdout.split('\n').filter((line) => line.includes('"gitSha"'));
    if (lines.length !== 1 || !lines[0].includes(`"gitSha":${JSON.stringify(sha)}`)) {
      errors.push(`importing the bundle printed ${lines.length} SHA log lines, expected exactly one with ${sha}`);
    }
  } catch (err) {
    errors.push(`resolving or importing the deploy folder failed: ${String(err.stderr || err.message).trim()}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return errors;
}

async function main(args) {
  const overrides = json(join(workspaceRoot, 'package.json')).pnpm?.overrides ?? {};
  const repo = checkRepo(workspaceRoot);
  let failed = report('repository', repo.errors);
  const dirs = args.length ? args.map((arg) => resolve(arg)) : repo.functions;
  if (!dirs.length) failed = report('repository', ['no cloud function deploys from dist-deploy']) || failed;
  for (const dir of dirs) {
    const label = dir.split(/[\\/]/).at(-1);
    const folder = checkFolder(dir);
    failed = report(`${label} folder`, folder.errors) || failed;
    if (folder.errors.length) continue;
    const manifest = json(join(dir, 'dist-deploy', 'package.json'));
    failed = report(`${label} manifest`, checkManifest(manifest, json(join(dir, 'package.json')))) || failed;
    failed = report(`${label} packaging`, await checkPackaging(dir)) || failed;
    failed = report(`${label} resolved tree`, checkResolvedTree(dir, folder.sha, overrides)) || failed;
  }
  process.exitCode = failed ? 1 : 0;
}

function report(label, errors) {
  if (!errors.length) {
    console.log(`ok    ${label}`);
    return false;
  }
  for (const error of errors) console.log(`FAIL  ${label}: ${error}`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
