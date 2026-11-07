import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkWorker,
  sourceCronErrors,
  compareShapes,
  fromCf,
  fromWrangler,
  loadCfConfig,
  parseJsonc
} from '../check-worker-configs.mjs';

const WARG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKERS = [
  'logger',
  'renderer',
  'hyperrenderer',
  'singlefile',
  'readability',
  'monolith',
  'gcs',
  'workflow',
  'gateway'
];

const load = async (w) => {
  const dir = join(WARG, 'workers', w);
  return {
    wrangler: parseJsonc(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8')),
    cf: await loadCfConfig(dir)
  };
};

const diff = (wrangler, cf) => {
  const a = fromWrangler(wrangler);
  const b = fromCf(cf);
  return [...a.errors, ...b.errors, ...compareShapes(a.shape, b.shape)];
};

test('parseJsonc keeps // inside strings and drops comments and trailing commas', () => {
  const v = parseJsonc(
    '// head\n{ "url": "https://x.example/a", /* c */ "list": [1, 2,], }\n'
  );
  assert.deepEqual(v, { url: 'https://x.example/a', list: [1, 2] });
});

for (const w of WORKERS) {
  test(`${w}: wrangler.jsonc and cloudflare.config.ts agree`, async () => {
    assert.deepEqual(await checkWorker(join(WARG, 'workers', w)), []);
  });
}

test('a binding added to wrangler.jsonc only is reported', async () => {
  const { wrangler, cf } = await load('gateway');
  wrangler.services.push({ binding: 'GCS', service: 'gcs' });
  assert.match(
    diff(wrangler, cf).join('\n'),
    /bindings\.GCS: wrangler\.jsonc worker:gcs, cloudflare\.config\.ts \(absent\)/
  );
});

test('a binding added to cloudflare.config.ts only is reported', async () => {
  const { wrangler, cf } = await load('renderer');
  cf.worker.env.EXTRA = { type: 'text', value: '1' };
  assert.match(
    diff(wrangler, cf).join('\n'),
    /bindings\.EXTRA: wrangler\.jsonc \(absent\), cloudflare\.config\.ts text:1/
  );
});

test('a binding that points elsewhere is reported', async () => {
  const { wrangler, cf } = await load('gateway');
  cf.worker.env.ARCHIVE_BUCKET = { type: 'r2', name: 'other-bucket' };
  assert.match(diff(wrangler, cf).join('\n'), /bindings\.ARCHIVE_BUCKET/);
});

test('a Durable Object storage kind that differs from the migration is reported', async () => {
  const { wrangler, cf } = await load('workflow');
  cf.worker.exports.BrowserQuotaDO = {
    type: 'durable-object',
    storage: 'sqlite'
  };
  assert.match(
    diff(wrangler, cf).join('\n'),
    /exports\.BrowserQuotaDO: wrangler\.jsonc durable-object:legacy-kv, cloudflare\.config\.ts durable-object:sqlite/
  );
});

test('a missing Durable Object export is reported', async () => {
  const { wrangler, cf } = await load('logger');
  delete cf.worker.exports.LoggerDO;
  assert.match(diff(wrangler, cf).join('\n'), /exports\.LoggerDO/);
});

test('a container setting that differs is reported', async () => {
  const { wrangler, cf } = await load('monolith');
  wrangler.containers[0].max_instances = 9;
  assert.match(diff(wrangler, cf).join('\n'), /containers:/);
});

test('a cron changed in one file is reported', async () => {
  const { wrangler, cf } = await load('gateway');
  wrangler.triggers.crons = ['*/5 * * * *'];
  assert.match(diff(wrangler, cf).join('\n'), /crons:/);
});

test('a dispatched cron that no config lists is reported', () => {
  const source = "export const HEALTH_CHECK_CRON = '0 9 * * *';";
  assert.match(sourceCronErrors(source, ['*/10 * * * *', '0 8 * * *']).join('\n'), /HEALTH_CHECK_CRON '0 9 \* \* \*'/);
  assert.deepEqual(sourceCronErrors(source, ['0 9 * * *']), []);
});

test('a send-email destination set in one file is reported', async () => {
  const { wrangler, cf } = await load('gateway');
  wrangler.send_email[0].destination_address = 'owner@example.com';
  assert.match(diff(wrangler, cf).join('\n'), /bindings\.HEALTH_EMAIL:/);
});

test('a compatibility date or flag that differs is reported', async () => {
  const { wrangler, cf } = await load('singlefile');
  wrangler.compatibility_date = '2026-01-01';
  cf.worker.compatibilityFlags = [];
  const out = diff(wrangler, cf).join('\n');
  assert.match(out, /compatibilityDate:/);
  assert.match(out, /compatibilityFlags:/);
});

test('a wrangler.jsonc section the check does not know is reported, not ignored', async () => {
  const { wrangler, cf } = await load('renderer');
  wrangler.kv_namespaces = [{ binding: 'KV', id: 'x' }];
  assert.match(
    diff(wrangler, cf).join('\n'),
    /key "kv_namespaces" is not compared/
  );
});

test('a secret declared in wrangler.jsonc only is reported', async () => {
  const { wrangler, cf } = await load('renderer');
  wrangler.secrets = {
    required: [...(wrangler.secrets?.required ?? []), 'EXTRA_SECRET']
  };
  assert.match(
    diff(wrangler, cf).join('\n'),
    /bindings\.EXTRA_SECRET: wrangler\.jsonc secret, cloudflare\.config\.ts \(absent\)/
  );
});

test('a secret declared in cloudflare.config.ts only is reported', async () => {
  const { wrangler, cf } = await load('renderer');
  cf.worker.env.EXTRA_SECRET = { type: 'secret' };
  assert.match(
    diff(wrangler, cf).join('\n'),
    /bindings\.EXTRA_SECRET: wrangler\.jsonc \(absent\), cloudflare\.config\.ts secret/
  );
});

test('a wrangler.jsonc secrets setting the check does not know is reported', async () => {
  const { wrangler, cf } = await load('renderer');
  wrangler.secrets = { ...wrangler.secrets, optional: ['EXTRA_SECRET'] };
  assert.match(
    diff(wrangler, cf).join('\n'),
    /secrets key "optional" is not compared/
  );
});

test('the check exits 1 and names the Worker and the secret that differ', () => {
  // Inside warg/ so that cloudflare.config.ts can resolve cf/config.
  const tmp = mkdtempSync(join(WARG, 'node_modules', '.tmp-worker-configs-'));
  try {
    const dir = join(tmp, 'renderer');
    mkdirSync(dir);
    const src = join(WARG, 'workers', 'renderer');
    copyFileSync(join(src, 'cloudflare.config.ts'), join(dir, 'cloudflare.config.ts'));
    const wrangler = parseJsonc(readFileSync(join(src, 'wrangler.jsonc'), 'utf8'));
    wrangler.secrets = {
      required: [...(wrangler.secrets?.required ?? []), 'EXTRA_SECRET']
    };
    writeFileSync(join(dir, 'wrangler.jsonc'), JSON.stringify(wrangler, null, 2));
    const run = spawnSync(
      process.execPath,
      ['scripts/check-worker-configs.mjs', dir],
      { cwd: WARG, encoding: 'utf8' }
    );
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /FAIL renderer/);
    assert.match(run.stdout, /bindings\.EXTRA_SECRET/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
