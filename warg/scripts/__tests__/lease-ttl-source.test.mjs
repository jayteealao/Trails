// The sandbox lease TTL and the rule that calls a lease stale live once, in
// packages/shared/src/lease.ts. The workflow's quota object is their only
// reader: it drops a stale lease and stops the container of a stale sandbox
// lease. These tests fail when the quota object stops importing the shared
// names or holds a 5-minute literal of its own, when any worker or package
// declares its own lease-age constant, or when the gateway lists leases or
// stops containers again.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const wargDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SHARED_LEASE_FILE = 'packages/shared/src/lease.ts';

const CONSUMERS = [
  { rel: 'workers/workflow/src/BrowserQuotaDO.ts', names: ['LEASE_TTL_MS', 'isLeaseStale'] },
];
const GATEWAY_INDEX = 'workers/gateway/src/index.ts';
const WORKFLOW_INDEX = 'workers/workflow/src/index.ts';
const WORKFLOW_SWEEP = 'workers/workflow/src/container-sweep.ts';
const GATEWAY_FORBIDDEN = ['sandbox-leases', '/container/stop', 'isLeaseStale'];

const FIVE_MINUTE_LITERAL = /\b5\s*\*\s*60\s*\*\s*1000\b|\b5\s*\*\s*60_000\b|\b300_?000\b/;
const LEASE_AGE_NAME = /LEASE_(?:TTL|AGE|MAX_AGE)|SWEEP_MIN_LEASE/i;
// A variable or class field (the shape TypeScript emits: `const X = ...`,
// `X = ...` in a class body, `static X = ...`, `#X = ...`) with a numeric start.
const NUMERIC_DECLARATION =
  /^\s*(?:export\s+)?(?:(?:const|let|var)\s+|static\s+)?#?([A-Za-z_$][\w$]*)\s*=\s*[\d(]/gm;

/** The text as TypeScript emits it: types and comments removed. */
function transpile(text) {
  return ts.transpileModule(text, {
    compilerOptions: { removeComments: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}

function source(rel) {
  return transpile(readFileSync(resolve(wargDir, rel), 'utf8'));
}

/** The names `text` imports from `'@warg/shared'`. */
function sharedImports(text) {
  const names = [];
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@warg\/shared['"]/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0];
      if (name) names.push(name);
    }
  }
  return names;
}

/** The lease-age names `text` declares with a numeric initializer. */
function leaseAgeDeclarations(text) {
  return [...text.matchAll(NUMERIC_DECLARATION)].map((m) => m[1]).filter((name) => LEASE_AGE_NAME.test(name));
}

/** Every non-test `.ts` file under `workers/*\/src` and `packages/*\/src`, relative to warg/. */
function workspaceSources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !entry.name.endsWith('.test.ts')) {
        files.push(relative(wargDir, path).replaceAll('\\', '/'));
      }
    }
  };
  for (const group of ['workers', 'packages']) {
    for (const entry of readdirSync(resolve(wargDir, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = resolve(wargDir, group, entry.name, 'src');
      try {
        walk(src);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  }
  return files;
}

test('the quota object imports the shared lease names', () => {
  for (const { rel, names } of CONSUMERS) {
    const imported = sharedImports(source(rel));
    for (const name of names) {
      assert.ok(imported.includes(name), `${rel} does not import ${name} from '@warg/shared'`);
    }
  }
});

test('the quota object holds no 5-minute literal of its own', () => {
  for (const { rel } of CONSUMERS) {
    const match = source(rel).match(FIVE_MINUTE_LITERAL);
    assert.equal(match, null, `${rel} holds the literal ${match?.[0]}; read LEASE_TTL_MS from '@warg/shared'`);
  }
});

test('no worker or package but the shared lease module declares a lease-age constant', () => {
  const files = workspaceSources();
  assert.ok(files.includes(SHARED_LEASE_FILE), `${SHARED_LEASE_FILE} was not scanned`);
  assert.deepEqual(leaseAgeDeclarations(source(SHARED_LEASE_FILE)), ['LEASE_TTL_MS']);
  for (const { rel } of CONSUMERS) assert.ok(files.includes(rel), `${rel} was not scanned`);

  const offenders = files
    .filter((rel) => rel !== SHARED_LEASE_FILE)
    .flatMap((rel) => leaseAgeDeclarations(source(rel)).map((name) => `${rel}: ${name}`));
  assert.deepEqual(offenders, [], 'declare the lease TTL only in packages/shared/src/lease.ts');
});

test('the matchers flag a planted copy', () => {
  const gatewayCopy = transpile('export const CONTAINER_SWEEP_MIN_LEASE_AGE_MS = 5 * 60 * 1000;');
  const quotaCopy = transpile('class Q { private readonly LEASE_TTL_MS = 300_000; }');

  assert.deepEqual(leaseAgeDeclarations(gatewayCopy), ['CONTAINER_SWEEP_MIN_LEASE_AGE_MS']);
  assert.deepEqual(leaseAgeDeclarations(quotaCopy), ['LEASE_TTL_MS']);
  assert.match(gatewayCopy, FIVE_MINUTE_LITERAL);
  assert.match(quotaCopy, FIVE_MINUTE_LITERAL);
  assert.deepEqual(sharedImports("import { a, isLeaseStale as stale } from '@warg/shared';"), ['a', 'isLeaseStale']);
});

/** The strings of `forbidden` that the comment-stripped `text` contains. */
function forbiddenIn(text, forbidden) {
  return forbidden.filter((needle) => text.includes(needle));
}

test('only the quota object lists leases or stops containers', () => {
  assert.deepEqual(
    forbiddenIn(source(GATEWAY_INDEX), GATEWAY_FORBIDDEN),
    [],
    `${GATEWAY_INDEX} must not list sandbox leases or stop containers; the quota object does it`
  );
  assert.deepEqual(
    forbiddenIn(source(WORKFLOW_INDEX), ['sandbox-leases']),
    [],
    `${WORKFLOW_INDEX} must not serve the sandbox leases route`
  );
  assert.ok(source(WORKFLOW_SWEEP).includes('/container/stop'), `${WORKFLOW_SWEEP} no longer stops containers`);
});
