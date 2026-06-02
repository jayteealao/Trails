#!/usr/bin/env node
// One-shot reconciler: for every GCS prefix archives/{id}/ in the standard
// archives bucket, list the artifacts present and merge them into
// Firestore as `archives.<key> = {status: 'success', gcs_path, ...}`. This
// rescues the ~770 articles where the bytes uploaded to GCS but the
// Firestore archives map was never finalized (audit Mode B).
//
// Plan 3b from warg/plans/article-status-recovery.md. Idempotent — safe to
// re-run; only adds/upgrades entries, never regresses an existing success.
//
// Usage:
//   gcloud auth login                                       (once)
//   node warg/scripts/reconcile-archives-map.mjs            # dry-run
//   node warg/scripts/reconcile-archives-map.mjs --apply    # writes
//   node warg/scripts/reconcile-archives-map.mjs --apply --ids gcs-ids.txt
//   node warg/scripts/reconcile-archives-map.mjs --apply --concurrency 8
//
// After this runs with --apply, run reconcile-status.mjs --apply to
// flip the derived status field on the rescued docs.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROJECT = 'trails-e428e';
const GCS_PROJECT = 'trails-414917';
const BUCKET = 'htbase-archives-standard';
const DB = `projects/${PROJECT}/databases/(default)`;
const DOC_PREFIX = `${DB}/documents`;

// Folder name (under archives/{id}/) → archive key in Firestore.
// Must match KIND_TO_ARCHIVE_KEY in archive-gateway/src/types.ts.
const FOLDER_TO_ARCHIVE_KEY = {
  rendered: 'rendered',
  singlefile: 'singlefile',
  monolith: 'monolith',
  readability: 'readability',
  markdown: 'markdown',
  pdf: 'pdf',
  screenshot: 'screenshot',
};

// --- CLI parsing ---
const apply = process.argv.includes('--apply');
const idsArg = process.argv.indexOf('--ids');
const IDS_FILE =
  idsArg >= 0 && process.argv[idsArg + 1]
    ? resolve(process.argv[idsArg + 1])
    : resolve(__dirname, 'gcs-ids.txt');
const concArg = process.argv.indexOf('--concurrency');
const CONCURRENCY =
  concArg >= 0 && process.argv[concArg + 1]
    ? Math.max(1, Math.min(20, Number(process.argv[concArg + 1])))
    : 4;
const limitArg = process.argv.indexOf('--limit');
const LIMIT =
  limitArg >= 0 && process.argv[limitArg + 1]
    ? Number(process.argv[limitArg + 1])
    : Infinity;

// --- gcloud token plumbing ---
let token = '';
let tokenAt = 0;
function refreshToken() {
  const cmd = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
  token = execFileSync(cmd, ['auth', 'print-access-token'], {
    encoding: 'utf8',
    shell: true,
  }).trim();
  tokenAt = Date.now();
}
async function api(method, url, body) {
  if (!token || Date.now() - tokenAt > 30 * 60 * 1000) refreshToken();
  const init = {
    method,
    headers: { Authorization: `Bearer ${token}` },
  };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`${method} ${url} → ${r.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

// --- Firestore typed-value helpers ---
function val(v) {
  if (v == null) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) {
    const out = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields ?? {})) {
      out[k] = val(vv);
    }
    return out;
  }
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(val);
  return undefined;
}
function fields(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields ?? {})) out[k] = val(v);
  return out;
}

// --- GCS list helpers ---
// List all objects under archives/{id}/ — single page should suffice for one
// article (well under 1000 objects).
async function listGcsObjectsUnder(prefix) {
  const url = new URL(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o`);
  url.searchParams.set('prefix', prefix);
  url.searchParams.set('fields', 'items(name,size,timeCreated)');
  url.searchParams.set('maxResults', '200');
  const res = await api('GET', url.toString());
  return res?.items ?? [];
}

function parseGcsObject(prefix, item) {
  // item.name = archives/{id}/<folder>/<filename>
  const rel = item.name.slice(prefix.length);
  const slash = rel.indexOf('/');
  if (slash === -1) return null;
  const folder = rel.slice(0, slash);
  const archiveKey = FOLDER_TO_ARCHIVE_KEY[folder];
  if (!archiveKey) return null;
  return {
    archiveKey,
    folder,
    name: item.name,
    bytes: typeof item.size === 'string' ? Number(item.size) : item.size,
    createdAt: item.timeCreated,
  };
}

// Pick the largest object per folder (multiple files like output.html.gz can
// exist if e.g. rendered.md and rendered.html both produce; canonical key
// uses folder name). For folders with two outputs (rendered: output.html.gz
// AND output.md.gz), the archive key is the same — Firestore stores one
// entry. Keep the most recent.
function groupByArchiveKey(parsed) {
  const byKey = new Map();
  for (const obj of parsed) {
    if (!obj) continue;
    const prev = byKey.get(obj.archiveKey);
    if (!prev || prev.createdAt < obj.createdAt) {
      byKey.set(obj.archiveKey, obj);
    }
  }
  return byKey;
}

// --- Firestore read/write per article ---
async function getArticle(id) {
  const url = `https://firestore.googleapis.com/v1/${DOC_PREFIX}/articles/${id}`;
  try {
    const doc = await api('GET', url);
    return doc ? fields(doc) : null;
  } catch (e) {
    if (String(e).includes('404')) return null;
    throw e;
  }
}

async function patchArchives(id, updates) {
  const params = new URLSearchParams();
  params.append('updateMask.fieldPaths', 'updated_at');
  for (const key of Object.keys(updates)) {
    params.append('updateMask.fieldPaths', `archives.${key}`);
  }
  const url = `https://firestore.googleapis.com/v1/${DOC_PREFIX}/articles/${id}?${params}`;

  const archiveFields = {};
  for (const [key, entry] of Object.entries(updates)) {
    archiveFields[key] = {
      mapValue: {
        fields: {
          status: { stringValue: 'success' },
          gcs_bucket: { stringValue: BUCKET },
          gcs_path: { stringValue: entry.gcs_path },
          compressed_size: { integerValue: String(entry.compressed_size) },
          created_at: { stringValue: entry.created_at },
        },
      },
    };
  }

  await api('PATCH', url, {
    fields: {
      updated_at: { timestampValue: new Date().toISOString() },
      archives: { mapValue: { fields: archiveFields } },
    },
  });
}

async function reconcileOne(id, stats) {
  const prefix = `archives/${id}/`;
  let items;
  try {
    items = await listGcsObjectsUnder(prefix);
  } catch (e) {
    stats.list_errors += 1;
    return { id, error: `list: ${String(e).slice(0, 200)}` };
  }
  if (items.length === 0) {
    stats.no_objects += 1;
    return { id, skipped: 'no_gcs_objects' };
  }

  const parsed = items.map((it) => parseGcsObject(prefix, it));
  const byKey = groupByArchiveKey(parsed);
  if (byKey.size === 0) {
    stats.no_recognized += 1;
    return { id, skipped: 'no_recognized_artifacts' };
  }

  let firestoreDoc;
  try {
    firestoreDoc = await getArticle(id);
  } catch (e) {
    stats.read_errors += 1;
    return { id, error: `read: ${String(e).slice(0, 200)}` };
  }
  const existingArchives =
    firestoreDoc?.archives && typeof firestoreDoc.archives === 'object'
      ? firestoreDoc.archives
      : {};

  // Determine which keys need writing.
  const updates = {};
  for (const [key, obj] of byKey) {
    const existing = existingArchives[key];
    if (existing?.status === 'success' && existing.gcs_path) continue;
    updates[key] = {
      gcs_path: `gs://${BUCKET}/${obj.name}`,
      compressed_size: obj.bytes ?? 0,
      created_at: obj.createdAt ?? new Date().toISOString(),
    };
  }
  if (Object.keys(updates).length === 0) {
    stats.already_complete += 1;
    return { id, skipped: 'already_complete' };
  }

  stats.would_update += 1;
  for (const k of Object.keys(updates)) {
    stats.keys_added[k] = (stats.keys_added[k] ?? 0) + 1;
  }

  if (apply) {
    try {
      await patchArchives(id, updates);
      stats.updated += 1;
    } catch (e) {
      stats.write_errors += 1;
      return { id, error: `write: ${String(e).slice(0, 200)}` };
    }
  }
  return { id, updated_keys: Object.keys(updates) };
}

// --- Concurrency primitive ---
async function pool(items, n, worker, onTick) {
  const results = [];
  let cursor = 0;
  let done = 0;
  async function runner() {
    while (cursor < items.length) {
      const i = cursor++;
      const result = await worker(items[i], i);
      results.push(result);
      done += 1;
      if (onTick && done % 100 === 0) onTick(done);
    }
  }
  await Promise.all(Array.from({ length: n }, runner));
  return results;
}

// --- main ---
async function main() {
  refreshToken();
  const allIds = readFileSync(IDS_FILE, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const ids = allIds.slice(0, LIMIT);

  process.stderr.write(
    `reconcile-archives-map (${apply ? 'APPLY' : 'dry-run'}) ` +
      `bucket=${BUCKET} project=${PROJECT} ids=${ids.length}/${allIds.length} conc=${CONCURRENCY}\n`
  );

  const stats = {
    no_objects: 0,
    no_recognized: 0,
    already_complete: 0,
    would_update: 0,
    updated: 0,
    list_errors: 0,
    read_errors: 0,
    write_errors: 0,
    keys_added: {},
  };
  const errors = [];

  await pool(
    ids,
    CONCURRENCY,
    async (id) => {
      const r = await reconcileOne(id, stats);
      if (r.error) errors.push(r);
    },
    (done) => process.stderr.write(`  progress ${done}/${ids.length}\n`)
  );

  process.stderr.write(`\nDone.\n`);
  process.stderr.write(`  ids considered      ${ids.length}\n`);
  process.stderr.write(`  no GCS objects      ${stats.no_objects}\n`);
  process.stderr.write(`  no recognized arts  ${stats.no_recognized}\n`);
  process.stderr.write(`  already complete    ${stats.already_complete}\n`);
  process.stderr.write(`  would update        ${stats.would_update}\n`);
  process.stderr.write(`  updated (apply=${apply})  ${stats.updated}\n`);
  process.stderr.write(`  errors  list=${stats.list_errors} read=${stats.read_errors} write=${stats.write_errors}\n`);
  process.stderr.write(`  keys added breakdown:\n`);
  for (const [k, v] of Object.entries(stats.keys_added).sort(([, a], [, b]) => b - a)) {
    process.stderr.write(`    ${k.padEnd(16)} ${v}\n`);
  }
  if (errors.length > 0) {
    process.stderr.write(`\nFirst 10 errors:\n`);
    for (const e of errors.slice(0, 10)) {
      process.stderr.write(`  ${e.id}: ${e.error}\n`);
    }
  }
  if (!apply) {
    process.stderr.write('\n(dry-run — pass --apply to actually patch documents)\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
