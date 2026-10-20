// Unit tests for the cloud function bundle build and its checks (no network).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFunctionBundle, npmOverrides, resolveSha, shaBanner } from '../build-function-bundle.mjs';
import { bundleImports, checkFolder, checkLock, checkManifest, checkRepo } from '../check-function-bundle.mjs';

const temps = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'function-bundle-test-'));
  temps.push(dir);
  return dir;
};
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const SOURCE = {
  name: '@warg/fixture',
  version: '1.0.0',
  dependencies: { 'firebase-admin': '14.5.0', 'firebase-functions': '7.4.0', '@google-cloud/storage': '7.21.0' }
};
const ROOT = { pnpm: { overrides: { uuid: '>=11.1.1', 'express>path-to-regexp': '~0.1.13', minimatch: '>=9.0.7' } } };

function fixtureFunction(pkg = SOURCE, source = 'export const answer = 42;\n') {
  const dir = tempDir();
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  writeFileSync(join(dir, 'src', 'index.ts'), source);
  return dir;
}

const manifest = (overrides = {}) => ({
  name: SOURCE.name,
  version: SOURCE.version,
  private: true,
  type: 'module',
  main: 'index.js',
  engines: { node: '22' },
  dependencies: { ...SOURCE.dependencies },
  overrides: { uuid: '>=11.1.1' },
  ...overrides
});

describe('shaBanner', () => {
  test('prints exactly one JSON log line carrying the SHA', () => {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', shaBanner('deadbeef')], { encoding: 'utf8' });
    const lines = out.trim().split('\n');
    assert.equal(lines.length, 1);
    const line = JSON.parse(lines[0]);
    assert.equal(line.gitSha, 'deadbeef');
    assert.equal(line.message, 'function bundle loaded');
  });
});

describe('resolveSha', () => {
  test('uses GIT_SHA from the environment when set', () => {
    assert.equal(resolveSha(tempDir(), { GIT_SHA: 'abc123-dirty' }), 'abc123-dirty');
  });
  test('reads HEAD on a clean tree and marks a dirty tree', () => {
    const dir = tempDir();
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q');
    writeFileSync(join(dir, 'a.txt'), 'a');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'a');
    const head = git('rev-parse', 'HEAD');
    const env = { ...process.env, GIT_SHA: '' };
    assert.equal(resolveSha(dir, env), head);
    writeFileSync(join(dir, 'b.txt'), 'b');
    assert.equal(resolveSha(dir, env), `${head}-dirty`);
  });
  test('fails when no SHA can be determined', () => {
    const dir = tempDir();
    const { GIT_DIR: _gitDir, ...rest } = process.env;
    const env = { ...rest, GIT_SHA: '', GIT_CEILING_DIRECTORIES: dirname(dir) };
    assert.throws(() => resolveSha(dir, env), /cannot determine the commit SHA/);
  });
});

describe('buildFunctionBundle', () => {
  test('writes the bundle with the SHA, its map and a manifest that passes the check', async () => {
    const dir = fixtureFunction();
    await buildFunctionBundle({ dir, sha: 'deadbeef', rootPkg: ROOT });
    const code = readFileSync(join(dir, 'dist-deploy', 'index.js'), 'utf8');
    assert.match(code, /deadbeef/);
    assert.ok(existsSync(join(dir, 'dist-deploy', 'index.js.map')));
    const pkg = JSON.parse(readFileSync(join(dir, 'dist-deploy', 'package.json'), 'utf8'));
    assert.deepEqual(checkManifest(pkg, SOURCE), []);
    assert.deepEqual(pkg.overrides, { uuid: '>=11.1.1', minimatch: '>=9.0.7' });
    const folder = checkFolder(dir);
    assert.deepEqual(folder.errors, []);
    assert.equal(folder.sha, 'deadbeef');
  });

  test('refuses a dependency that is not pinned exactly', async () => {
    const dir = fixtureFunction({ ...SOURCE, dependencies: { ...SOURCE.dependencies, 'firebase-admin': '^14.5.0' } });
    await assert.rejects(buildFunctionBundle({ dir, sha: 'deadbeef', rootPkg: ROOT }), /exact x\.y\.z/);
  });
});

describe('npmOverrides', () => {
  test('keeps single-name overrides and drops parent-scoped ones', () => {
    assert.deepEqual(npmOverrides(ROOT), { uuid: '>=11.1.1', minimatch: '>=9.0.7' });
  });
});

describe('checkManifest', () => {
  test('passes the generated shape', () => {
    assert.deepEqual(checkManifest(manifest(), SOURCE), []);
  });
  const bad = {
    'a workspace: dependency': { dependencies: { ...SOURCE.dependencies, '@warg/shared': 'workspace:*' } },
    'a file: dependency': { dependencies: { ...SOURCE.dependencies, local: 'file:../x' } },
    'a ranged pin': { dependencies: { ...SOURCE.dependencies, 'firebase-functions': '^7.4.0' } },
    'an extra dependency': { dependencies: { ...SOURCE.dependencies, lodash: '4.17.21' } },
    'a missing engines field': { engines: undefined },
    'a main that is not the bundle': { main: 'dist/index.js' },
    'a workspace: override': { overrides: { uuid: 'workspace:*' } }
  };
  for (const [name, change] of Object.entries(bad)) {
    test(`fails on ${name}`, () => {
      assert.notDeepEqual(checkManifest(manifest(change), SOURCE), []);
    });
  }
  test('fails when a function dependency is left out', () => {
    const { '@google-cloud/storage': _storage, ...rest } = SOURCE.dependencies;
    assert.notDeepEqual(checkManifest(manifest({ dependencies: rest }), SOURCE), []);
  });
});

describe('checkLock', () => {
  const lock = (packages) => ({ lockfileVersion: 3, packages: { '': { name: 'x' }, ...packages } });
  test('fails on express 4.22.1', () => {
    assert.equal(checkLock(lock({ 'node_modules/express': { version: '4.22.1' } }), {}).length, 1);
  });
  test('passes express 4.22.2 and 5.3.0', () => {
    assert.deepEqual(checkLock(lock({ 'node_modules/express': { version: '4.22.2' } }), {}), []);
    assert.deepEqual(checkLock(lock({ 'node_modules/express': { version: '5.3.0' } }), {}), []);
  });
  test('fails on a nested express 4.22.1', () => {
    const packages = {
      'node_modules/express': { version: '5.3.0' },
      'node_modules/foo/node_modules/express': { version: '4.22.1' }
    };
    assert.equal(checkLock(lock(packages), {}).length, 1);
  });
  test('fails when an instance breaks a single-name override', () => {
    assert.equal(checkLock(lock({ 'node_modules/uuid': { version: '9.0.1' } }), { uuid: '>=11.1.1' }).length, 1);
  });
  test('checks a parent-scoped override only under its parent', () => {
    const overrides = { 'express>path-to-regexp': '~0.1.13' };
    assert.deepEqual(checkLock(lock({ 'node_modules/path-to-regexp': { version: '8.4.2' } }), overrides), []);
    const nested = { 'node_modules/express/node_modules/path-to-regexp': { version: '8.4.2' } };
    assert.equal(checkLock(lock({ 'node_modules/express': { version: '4.22.2' }, ...nested }), overrides).length, 1);
  });
});

describe('checkFolder', () => {
  test('fails on a bare import the manifest does not declare', async () => {
    const dir = fixtureFunction(SOURCE, "import _ from 'lodash';\nexport const x = _;\n");
    // esbuild cannot resolve lodash here, so the folder is written by hand.
    mkdirSync(join(dir, 'dist-deploy'), { recursive: true });
    writeFileSync(join(dir, 'dist-deploy', 'index.js'), `${shaBanner('deadbeef')}\nimport _ from "lodash";\n`);
    writeFileSync(join(dir, 'dist-deploy', 'index.js.map'), '{}');
    writeFileSync(join(dir, 'dist-deploy', 'package.json'), JSON.stringify(manifest()));
    const { errors } = checkFolder(dir);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /lodash/);
  });
  test('reads bare imports, subpaths and builtins from a bundle', () => {
    const code = 'import { a } from "firebase-admin/app";\nimport * as c from "node:crypto";\nconst m = await import("@google-cloud/storage");\n';
    assert.deepEqual(bundleImports(code).sort(), ['@google-cloud/storage', 'firebase-admin/app', 'node:crypto']);
  });
});

describe('checkRepo', () => {
  test('fails on a stray per-function package-lock.json', () => {
    const root = tempDir();
    mkdirSync(join(root, 'cloud-functions', 'x'), { recursive: true });
    writeFileSync(join(root, 'cloud-functions', 'x', 'package-lock.json'), '{}');
    assert.equal(checkRepo(root).errors.length, 1);
  });
  test('fails when a dist-deploy source has no configDir', () => {
    const root = tempDir();
    mkdirSync(join(root, 'cloud-functions', 'x'), { recursive: true });
    writeFileSync(join(root, 'cloud-functions', 'x', 'firebase.json'), JSON.stringify({ functions: [{ source: 'dist-deploy' }] }));
    const result = checkRepo(root);
    assert.equal(result.errors.length, 1);
    assert.equal(result.functions.length, 1);
  });
});
