// Checks that each worker's two configs agree.
//
// `cf deploy` and `cf dev` read <worker>/cloudflare.config.ts (plus
// wrangler.config.ts, which names the static assets directory);
// `wrangler types`, the logger's Workers-pool tests and the remaining
// `wrangler dev` runs still read <worker>/wrangler.jsonc. The workers are
// workers/* and the dashboard (pages/dashboard). A binding, required secret,
// Durable Object class, cron trigger, static assets, compatibility setting or
// tracing setting changed in one file and not the other either breaks local
// dev and the generated types, or ships a
// worker that differs from what was tested. This script loads both files for
// every worker that has a cloudflare.config.ts, reduces each to the same
// shape, and exits 1 on any difference.
//
// Both files of each Worker but those in OWN_DATE_WORKERS must also carry the
// shared compatibility date of workers/compatibility-date.mjs: cloudflare.config.ts imports it (a quoted
// date there fails), and wrangler.jsonc repeats it as a literal. A Worker in
// MINIMUM_COMPATIBILITY_DATES fails when its date is before its minimum.
//
// A Worker in TRACED_WORKERS fails when its configs do not enable
// observability.traces.
//
//   node scripts/check-worker-configs.mjs [workerDir...]
import { build } from 'esbuild';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { COMPATIBILITY_DATE } from '../workers/compatibility-date.mjs';

const WARG = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The earliest compatibility date each listed Worker may run on. The renderer
// needs 2026-03-24 for quickAction() on the browser binding.
export const MINIMUM_COMPATIBILITY_DATES = { renderer: '2026-03-24' };

// Workers that keep their own compatibility date instead of the shared one: the
// dashboard (pages/dashboard) moved off Pages with its 2024-01-01 date and is
// not on the archive path.
export const OWN_DATE_WORKERS = ['dashboard'];

// The Workers one archive passes through; one trace needs each of them traced.
export const TRACED_WORKERS = [
  'gateway',
  'workflow',
  'renderer',
  'hyperrenderer',
  'singlefile',
  'readability'
];

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
  'assets',
  'observability',
  'vars',
  'r2_buckets',
  'services',
  'd1_databases',
  'durable_objects',
  'migrations',
  'workflows',
  'browser',
  'ai',
  'containers',
  'triggers',
  'send_email',
  'secrets'
]);

const sorted = (xs) => [...xs].sort();

// The tracing setting with the platform defaults filled in, so an absent block
// equals { enabled: false }. keys.rate names the sampling key of the file.
const tracesSetting = (t, keys) =>
  JSON.stringify({
    enabled: t?.enabled === true,
    headSamplingRate: t?.[keys.rate] ?? 1,
    persist: t?.persist ?? true,
    destinations: sorted(t?.destinations ?? [])
  });

// One error per observability or traces key this check does not compare.
function observabilityKeyErrors(o, file, rate) {
  const errors = [];
  const report = (key) =>
    errors.push(
      `${file} observability key "${key}" is not compared by this check; extend scripts/check-worker-configs.mjs`
    );
  for (const key of Object.keys(o ?? {}))
    if (key !== 'enabled' && key !== 'traces') report(key);
  for (const key of Object.keys(o?.traces ?? {}))
    if (!['enabled', rate, 'persist', 'destinations'].includes(key))
      report(`traces.${key}`);
  return errors;
}

// One send-email binding: its fixed destination and its allow-lists.
const sendEmail = (destination, allowedDestinations, allowedSenders) =>
  `send-email:${destination ?? ''}:${sorted(allowedDestinations ?? []).join(',')}:${sorted(allowedSenders ?? []).join(',')}`;

// One line for a static assets setup, the same from either config.
function assetsLine({ binding, directory, runWorkerFirst, notFoundHandling, htmlHandling }) {
  return [
    `binding=${binding ?? '-'}`,
    `directory=${directory ?? '-'}`,
    `runWorkerFirst=${JSON.stringify(runWorkerFirst ?? false)}`,
    `notFoundHandling=${notFoundHandling ?? 'none'}`,
    `htmlHandling=${htmlHandling ?? 'auto-trailing-slash'}`
  ].join(' ');
}

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
  errors.push(
    ...observabilityKeyErrors(
      w.observability,
      'wrangler.jsonc',
      'head_sampling_rate'
    )
  );
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
  if (w.ai) bindings[w.ai.binding] = 'ai';
  for (const name of w.secrets?.required ?? []) bindings[name] = 'secret';
  for (const key of Object.keys(w.secrets ?? {})) {
    if (key !== 'required') {
      errors.push(
        `wrangler.jsonc secrets key "${key}" is not compared by this check; extend scripts/check-worker-configs.mjs`
      );
    }
  }
  for (const b of w.send_email ?? []) {
    bindings[b.name] = sendEmail(
      b.destination_address,
      b.allowed_destination_addresses,
      b.allowed_sender_addresses
    );
  }
  if (w.assets?.binding) bindings[w.assets.binding] = 'assets';
  const assets = w.assets
    ? assetsLine({
        binding: w.assets.binding,
        directory: w.assets.directory,
        runWorkerFirst: w.assets.run_worker_first,
        notFoundHandling: w.assets.not_found_handling,
        htmlHandling: w.assets.html_handling
      })
    : '-';

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
      traces: tracesSetting(w.observability?.traces, {
        rate: 'head_sampling_rate'
      }),
      crons: sorted(w.triggers?.crons ?? []),
      assets,
      bindings,
      exports: exportsOut,
      containers: sorted(containers)
    }
  };
}

// `tooling` is the default export of wrangler.config.ts, when there is one.
export function fromCf(config, tooling = {}) {
  const errors = [];
  const worker = config.worker ?? {};
  errors.push(
    ...observabilityKeyErrors(
      worker.observability,
      'cloudflare.config.ts',
      'headSamplingRate'
    )
  );
  const bindings = {};
  let assetsBinding;
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
      case 'ai':
        bindings[name] = 'ai';
        break;
      case 'secret':
        bindings[name] = 'secret';
        break;
      case 'send-email':
        bindings[name] = sendEmail(
          b.destinationAddress,
          b.allowedDestinationAddresses,
          b.allowedSenderAddresses
        );
        break;
      case 'assets':
        bindings[name] = 'assets';
        assetsBinding = name;
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
  const assets =
    worker.assets || assetsBinding || tooling.assetsDirectory
      ? assetsLine({
          binding: assetsBinding,
          directory: tooling.assetsDirectory,
          runWorkerFirst: worker.assets?.runWorkerFirst,
          notFoundHandling: worker.assets?.notFoundHandling,
          htmlHandling: worker.assets?.htmlHandling
        })
      : '-';
  return {
    errors,
    shape: {
      name: worker.name,
      entrypoint: worker.entrypoint,
      compatibilityDate: worker.compatibilityDate,
      compatibilityFlags: sorted(worker.compatibilityFlags ?? []),
      workersDev: worker.workersDev ?? true,
      observability: Boolean(worker.observability?.enabled),
      traces: tracesSetting(worker.observability?.traces, {
        rate: 'headSamplingRate'
      }),
      crons: sorted(crons),
      assets,
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
    'observability',
    'traces',
    'assets'
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

export async function loadCfConfig(workerDir, file = 'cloudflare.config.ts') {
  const result = await build({
    entryPoints: [join(workerDir, file)],
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

/**
 * A cron the worker's code dispatches on (an exported `*_CRON` constant in
 * src/index.ts) must be a configured cron: the gateway runs its sweeps on any
 * other cron, so a schedule changed only in the configs would silently stop the
 * daily health check.
 */
export function sourceCronErrors(source, crons) {
  const errors = [];
  for (const match of source.matchAll(/export const (\w+_CRON) = '([^']+)'/g)) {
    if (!crons.includes(match[2])) {
      errors.push(`${match[1]} '${match[2]}' in src/index.ts is not a configured cron (${JSON.stringify(crons)})`);
    }
  }
  return errors;
}

/**
 * Each file's compatibility date must be the shared constant, and a Worker with
 * a minimum date must not be before it. ISO dates compare as strings.
 */
export function sharedDateErrors(name, wranglerShape, cfShape, shared = COMPATIBILITY_DATE) {
  const errors = [];
  for (const [file, shape] of [
    ['wrangler.jsonc', wranglerShape],
    ['cloudflare.config.ts', cfShape]
  ]) {
    if (shape.compatibilityDate !== shared) {
      errors.push(
        `compatibilityDate: ${file} ${JSON.stringify(shape.compatibilityDate)}, shared constant ${JSON.stringify(shared)} (workers/compatibility-date.mjs)`
      );
    }
  }
  const minimum = MINIMUM_COMPATIBILITY_DATES[name];
  if (minimum && !(wranglerShape.compatibilityDate >= minimum)) {
    errors.push(
      `compatibilityDate ${JSON.stringify(wranglerShape.compatibilityDate)} is before the minimum ${JSON.stringify(minimum)} of ${name}`
    );
  }
  return errors;
}

// A Worker on the archive path must enable tracing. The file-to-file
// comparison carries the rule to cloudflare.config.ts.
export function tracingErrors(name, wranglerShape) {
  return TRACED_WORKERS.includes(name) &&
    JSON.parse(wranglerShape.traces).enabled !== true
    ? [
        `traces: ${name} is on the archive path and must enable observability.traces in both files`
      ]
    : [];
}

// cloudflare.config.ts must take the date from the shared constant, not a quoted literal.
export function literalDateErrors(source) {
  return /compatibilityDate\s*:\s*['"`]/.test(source)
    ? [
        'cloudflare.config.ts sets compatibilityDate to a literal; import COMPATIBILITY_DATE from ../compatibility-date.mjs'
      ]
    : [];
}

export async function checkWorker(workerDir) {
  const wrangler = parseJsonc(
    readFileSync(join(workerDir, 'wrangler.jsonc'), 'utf8')
  );
  const cf = await loadCfConfig(workerDir);
  const tooling = existsSync(join(workerDir, 'wrangler.config.ts'))
    ? await loadCfConfig(workerDir, 'wrangler.config.ts')
    : {};
  const w = fromWrangler(wrangler);
  const c = fromCf(cf, tooling);
  const name = basename(workerDir);
  const indexPath = join(workerDir, 'src', 'index.ts');
  const cronErrors = existsSync(indexPath)
    ? sourceCronErrors(readFileSync(indexPath, 'utf8'), w.shape.crons)
    : [];
  const dateErrors = OWN_DATE_WORKERS.includes(name)
    ? []
    : [
        ...sharedDateErrors(name, w.shape, c.shape),
        ...literalDateErrors(readFileSync(join(workerDir, 'cloudflare.config.ts'), 'utf8'))
      ];
  return [
    ...w.errors,
    ...c.errors,
    ...compareShapes(w.shape, c.shape),
    ...dateErrors,
    ...tracingErrors(name, w.shape),
    ...cronErrors
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const dirs = args.length
    ? args.map((d) => resolve(d))
    : [
        ...readdirSync(join(WARG, 'workers')).map((w) => join(WARG, 'workers', w)),
        join(WARG, 'pages', 'dashboard')
      ].filter((d) => existsSync(join(d, 'cloudflare.config.ts')));
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
