// Checks that each worker's two configs agree.
//
// `cf deploy` reads workers/<w>/cloudflare.config.ts; `wrangler dev` and
// `wrangler types` still read workers/<w>/wrangler.jsonc. A binding, Durable
// Object class, cron trigger or compatibility setting changed in one file and
// not the other either breaks local dev and the generated types, or ships a
// worker that differs from what was tested. This script loads both files for
// every worker that has a cloudflare.config.ts, reduces each to the same
// shape, and exits 1 on any difference.
//
//   node scripts/check-worker-configs.mjs [workerDir...]
import { build } from 'esbuild';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WARG = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Removes // and /* */ comments outside strings, then trailing commas.
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const KNOWN_WRANGLER_KEYS = new Set([
  '$schema',
  'name',
  'main',
  'compatibility_date',
  'compatibility_flags',
  'workers_dev',
  'observability',
  'vars',
  'r2_buckets',
  'services',
  'd1_databases',
  'durable_objects',
  'migrations',
  'workflows',
  'browser',
  'containers',
  'triggers'
]);

const sorted = (xs) => [...xs].sort();

// The common shape both configs reduce to.
export function fromWrangler(w) {
  const errors = [];
  for (const key of Object.keys(w)) {
    if (!KNOWN_WRANGLER_KEYS.has(key)) {
      errors.push(
        `wrangler.jsonc key "${key}" is not compared by this check; extend scripts/check-worker-configs.mjs`
      );
    }
  }
  const bindings = {};
  for (const [name, value] of Object.entries(w.vars ?? {}))
    bindings[name] = `text:${value}`;
  for (const b of w.r2_buckets ?? [])
    bindings[b.binding] = `r2:${b.bucket_name}`;
  for (const b of w.services ?? []) bindings[b.binding] = `worker:${b.service}`;
  for (const b of w.d1_databases ?? [])
    bindings[b.binding] = `d1:${b.database_name}:${b.database_id}`;
  for (const b of w.durable_objects?.bindings ?? []) {
    bindings[b.name] =
      `durable-object:${b.script_name ?? w.name}:${b.class_name}`;
  }
  for (const b of w.workflows ?? [])
    bindings[b.binding] = `workflow:${b.name}:${b.class_name}`;
  if (w.browser) bindings[w.browser.binding] = 'browser';

  const exportsOut = {};
  for (const m of w.migrations ?? []) {
    for (const cls of m.new_sqlite_classes ?? [])
      exportsOut[cls] = 'durable-object:sqlite';
    for (const cls of m.new_classes ?? [])
      exportsOut[cls] = 'durable-object:legacy-kv';
    if (m.renamed_classes || m.deleted_classes || m.transferred_classes) {
      errors.push(
        'wrangler.jsonc migrations rename, delete or transfer classes; extend scripts/check-worker-configs.mjs'
      );
    }
  }
  for (const b of w.workflows ?? [])
    exportsOut[b.class_name] = `workflow:${b.name}`;
  const containers = (w.containers ?? []).map(
    (c) => `${c.class_name}:${c.image}:${c.instance_type}:${c.max_instances}`
  );

  return {
    errors,
    shape: {
      name: w.name,
      entrypoint: w.main,
      compatibilityDate: w.compatibility_date,
      compatibilityFlags: sorted(w.compatibility_flags ?? []),
      workersDev: w.workers_dev ?? true,
      observability: Boolean(w.observability?.enabled),
      crons: sorted(w.triggers?.crons ?? []),
      bindings,
      exports: exportsOut,
      containers: sorted(containers)
    }
  };
}

export function fromCf(config) {
  const errors = [];
  const worker = config.worker ?? {};
  const bindings = {};
  for (const [name, b] of Object.entries(worker.env ?? {})) {
    switch (b.type) {
      case 'text':
        bindings[name] = `text:${b.value}`;
        break;
      case 'r2':
        bindings[name] = `r2:${b.name}`;
        break;
      case 'worker':
        bindings[name] = `worker:${b.worker}`;
        break;
      case 'd1':
        bindings[name] = `d1:${b.name}:${b.id}`;
        break;
      case 'durable-object':
        bindings[name] = `durable-object:${b.worker}:${b.exportName}`;
        break;
      case 'workflow':
        bindings[name] = `workflow:${b.name}:${b.exportName}`;
        break;
      case 'browser':
        bindings[name] = 'browser';
        break;
      default:
        errors.push(
          `cloudflare.config.ts binding ${name} has type "${b.type}", which this check does not compare; extend scripts/check-worker-configs.mjs`
        );
    }
  }
  const exportsOut = {};
  const containers = [];
  for (const [name, e] of Object.entries(worker.exports ?? {})) {
    if (e.type === 'durable-object') {
      exportsOut[name] = `durable-object:${e.storage}`;
      if (e.container) {
        const c = e.container;
        containers.push(
          `${name}:${c.image?.dockerfile}:${c.instanceType}:${c.maxInstances}`
        );
      }
    } else if (e.type === 'workflow') {
      exportsOut[name] = `workflow:${e.name}`;
    } else {
      errors.push(
        `cloudflare.config.ts export ${name} has type "${e.type}", which this check does not compare`
      );
    }
  }
  const crons = [];
  for (const t of worker.triggers ?? []) {
    if (t.type === 'scheduled') crons.push(t.schedule);
    else
      errors.push(
        `cloudflare.config.ts trigger type "${t.type}" is not compared by this check`
      );
  }
  return {
    errors,
    shape: {
      name: worker.name,
      entrypoint: worker.entrypoint,
      compatibilityDate: worker.compatibilityDate,
      compatibilityFlags: sorted(worker.compatibilityFlags ?? []),
      workersDev: worker.workersDev ?? true,
      observability: Boolean(worker.observability?.enabled),
      crons: sorted(crons),
      bindings,
      exports: exportsOut,
      containers: sorted(containers)
    }
  };
}

// Returns one line per difference between the two shapes.
export function compareShapes(a, b) {
  const diffs = [];
  for (const key of [
    'name',
    'entrypoint',
    'compatibilityDate',
    'workersDev',
    'observability'
  ]) {
    if (a[key] !== b[key])
      diffs.push(
        `${key}: wrangler.jsonc ${JSON.stringify(a[key])}, cloudflare.config.ts ${JSON.stringify(b[key])}`
      );
  }
  for (const key of ['compatibilityFlags', 'crons', 'containers']) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      diffs.push(
        `${key}: wrangler.jsonc ${JSON.stringify(a[key])}, cloudflare.config.ts ${JSON.stringify(b[key])}`
      );
    }
  }
  for (const key of ['bindings', 'exports']) {
    const names = new Set([...Object.keys(a[key]), ...Object.keys(b[key])]);
    for (const name of sorted(names)) {
      if (a[key][name] !== b[key][name]) {
        diffs.push(
          `${key}.${name}: wrangler.jsonc ${a[key][name] ?? '(absent)'}, cloudflare.config.ts ${b[key][name] ?? '(absent)'}`
        );
      }
    }
  }
  return diffs;
}

export async function loadCfConfig(workerDir) {
  const result = await build({
    entryPoints: [join(workerDir, 'cloudflare.config.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'error',
    absWorkingDir: workerDir
  });
  const code = result.outputFiles[0].text;
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
  return mod.default;
}

export async function checkWorker(workerDir) {
  const wrangler = parseJsonc(
    readFileSync(join(workerDir, 'wrangler.jsonc'), 'utf8')
  );
  const cf = await loadCfConfig(workerDir);
  const w = fromWrangler(wrangler);
  const c = fromCf(cf);
  return [...w.errors, ...c.errors, ...compareShapes(w.shape, c.shape)];
}

async function main() {
  const args = process.argv.slice(2);
  const dirs = args.length
    ? args.map((d) => resolve(d))
    : readdirSync(join(WARG, 'workers'))
        .map((w) => join(WARG, 'workers', w))
        .filter((d) => existsSync(join(d, 'cloudflare.config.ts')));
  let failed = 0;
  for (const dir of dirs) {
    const problems = await checkWorker(dir);
    const name = dir.split(/[\\/]/).pop();
    if (problems.length === 0) {
      console.log(`ok   ${name}`);
    } else {
      failed++;
      console.log(`FAIL ${name}`);
      for (const p of problems) console.log(`     ${p}`);
    }
  }
  if (failed) {
    console.log(
      `${failed} worker(s) have configs that disagree; change the binding in both files`
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
