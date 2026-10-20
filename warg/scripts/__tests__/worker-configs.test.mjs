import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkWorker,
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
