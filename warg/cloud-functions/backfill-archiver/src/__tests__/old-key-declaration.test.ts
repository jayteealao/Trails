import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// firebase-tools checks every secret param a function's code declares at
// module load, bound or not, and fails the deploy when the secret's latest
// version is destroyed. The old INTERNAL_API_KEY's versions are destroyed, so
// the module may declare it only while the key-rotation switch is on. Each
// case loads the built module in a fresh process, because firebase-functions
// keeps declared params in a process-wide registry.
const FUNCTION_EXPORT = 'backfillStatus';
const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));
const INDEX_URL = new URL('../index.js', import.meta.url).href;

const PROBE = `
const { declaredParams } = await import('firebase-functions/params');
const mod = await import(process.argv[1]);
const fn = mod[process.argv[2]];
console.log(JSON.stringify({
  declared: declaredParams.map((p) => p.name),
  bound: (fn.__endpoint.secretEnvironmentVariables ?? []).map((s) => s.key),
}));
`;

function load(dualAccept: string | undefined): { declared: string[]; bound: string[] } {
  const env = { ...process.env };
  delete env['KEY_ROTATION_DUAL_ACCEPT'];
  delete env['INTERNAL_API_KEY'];
  if (dualAccept !== undefined) env['KEY_ROTATION_DUAL_ACCEPT'] = dualAccept;
  const out = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', PROBE, INDEX_URL, FUNCTION_EXPORT],
    { cwd: PACKAGE_DIR, env, encoding: 'utf8' }
  );
  const lines = out.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]!) as { declared: string[]; bound: string[] };
}

test('with the switch off, loading the module declares no INTERNAL_API_KEY param', () => {
  const { declared, bound } = load('false');
  assert.ok(declared.length > 0, 'the module declares its other params');
  assert.ok(!declared.includes('INTERNAL_API_KEY'));
  assert.ok(!bound.includes('INTERNAL_API_KEY'));
});

test('with the switch unset or not exactly true, INTERNAL_API_KEY is not declared', () => {
  for (const value of [undefined, '', 'TRUE', '1']) {
    assert.ok(!load(value).declared.includes('INTERNAL_API_KEY'), `switch=${String(value)}`);
  }
});

test('with the switch on, INTERNAL_API_KEY is declared and bound', () => {
  const { declared, bound } = load('true');
  assert.ok(declared.includes('INTERNAL_API_KEY'));
  assert.ok(bound.includes('INTERNAL_API_KEY'));
});
