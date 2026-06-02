#!/usr/bin/env node
// One-shot audit: cross-reference a user's article subcollection,
// the canonical /articles documents, and the GCS archives bucket.
//
// Usage:
//   gcloud auth login        (once)
//   node warg/scripts/audit-user-articles.mjs [USER_ID] [GCS_IDS_FILE] [OUTPUT_CSV]
//
// Defaults: USER_ID=TGtRF6GrQaSmfjGk9GEYJ8YZc0v1, GCS file beside this script.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const USER_ID = process.argv[2] ?? 'TGtRF6GrQaSmfjGk9GEYJ8YZc0v1';
const GCS_FILE = process.argv[3] ?? resolve(__dirname, 'gcs-ids.txt');
const OUT = process.argv[4] ?? resolve(__dirname, `user-${USER_ID}-audit.csv`);

const PROJECT = 'trails-e428e';
const DB = `projects/${PROJECT}/databases/(default)`;
const DOC_PREFIX = `${DB}/documents`;
const USER_ARTICLES_PARENT = `${DOC_PREFIX}/users/${USER_ID}`;

const PAGE_SIZE = 300;
const BATCH_GET_SIZE = 300;

// --- token plumbing ---
let token = '';
let tokenAt = 0;
function refreshToken() {
  // gcloud on Windows is gcloud.cmd; shell:true lets the OS resolve.
  const cmd = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
  token = execFileSync(cmd, ['auth', 'print-access-token'], { encoding: 'utf8', shell: true }).trim();
  tokenAt = Date.now();
}
async function api(path, body) {
  if (!token || Date.now() - tokenAt > 30 * 60 * 1000) refreshToken();
  const url = `https://firestore.googleapis.com/v1${path}`;
  const r = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// --- value extraction ---
function val(v) {
  if (v == null) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('mapValue' in v) {
    const out = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields ?? {})) out[k] = val(vv);
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

// --- 1. Stream user's article subcollection ---
async function fetchUserArticles() {
  const allDocs = [];
  let cursor = null;
  let pages = 0;
  while (true) {
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'articles' }],
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit: PAGE_SIZE,
        ...(cursor ? { startAt: { values: [{ referenceValue: cursor }], before: false } } : {}),
      },
    };
    const result = await api(`/${USER_ARTICLES_PARENT}:runQuery`, body);
    const docs = result.filter(r => r.document).map(r => r.document);
    if (docs.length === 0) break;
    for (const d of docs) {
      const f = fields(d);
      allDocs.push({
        id: d.name.split('/').pop(),
        fullName: d.name,
        createTime: d.createTime,
        updateTime: d.updateTime,
        url: f.url,
        resolvedId: f.resolvedId,
        archival_triggered: f.archival_triggered === true,
      });
    }
    cursor = docs[docs.length - 1].name;
    pages += 1;
    process.stderr.write(`  user-articles page ${pages}: +${docs.length}, total ${allDocs.length}\n`);
    if (docs.length < PAGE_SIZE) break;
  }
  return allDocs;
}

// --- 2. Batch-get canonical /articles docs ---
async function fetchCanonicalArticles(ids) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += BATCH_GET_SIZE) {
    const chunk = ids.slice(i, i + BATCH_GET_SIZE);
    const body = { documents: chunk.map(id => `${DOC_PREFIX}/articles/${id}`) };
    const result = await api(`/${DOC_PREFIX}:batchGet`, body);
    for (const r of result) {
      if (r.found) {
        const id = r.found.name.split('/').pop();
        map.set(id, { ...fields(r.found), _updateTime: r.found.updateTime });
      } else if (r.missing) {
        const id = r.missing.split('/').pop();
        map.set(id, null);
      }
    }
    process.stderr.write(`  canonical batch ${i + chunk.length}/${ids.length}\n`);
  }
  return map;
}

// --- 3. Classify ---
const LOOSE_KEYS = ['rendered', 'singlefile', 'monolith'];
const STRICT_KEYS = ['rendered', 'readability', 'markdown', 'singlefile'];
function classifyLoose(art, hasGcs) {
  if (!art) return hasGcs ? 'gcs_orphan' : 'never_archived';
  const arch = art.archives ?? {};
  const successKeys = Object.entries(arch).filter(([_, v]) => v?.status === 'success').map(([k]) => k);
  const looseHit = LOOSE_KEYS.some(k => arch[k]?.status === 'success');
  if (looseHit) return 'complete';
  if (art.status === 'failed') return 'failed';
  if (art.status === 'pending') return 'pending';
  if (art.status === 'processing') return 'processing';
  if (successKeys.length > 0) return 'partial';
  return 'unknown';
}
function classifyStrict(art) {
  if (!art) return 'no_doc';
  const arch = art.archives ?? {};
  return STRICT_KEYS.every(k => arch[k]?.status === 'success') ? 'complete' : 'incomplete';
}

// --- 4. CSV plumbing ---
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// --- main ---
async function main() {
  refreshToken();
  process.stderr.write(`Reading GCS prefix list from ${GCS_FILE}\n`);
  const gcsSet = new Set(readFileSync(GCS_FILE, 'utf8').split(/\r?\n/).filter(Boolean));
  process.stderr.write(`  ${gcsSet.size} GCS prefixes loaded\n`);

  process.stderr.write(`Streaming user/${USER_ID}/articles\n`);
  const userDocs = await fetchUserArticles();
  process.stderr.write(`  total user docs: ${userDocs.length}\n`);

  const canonicalIds = new Set();
  for (const u of userDocs) canonicalIds.add(u.resolvedId ?? u.id);
  const ids = [...canonicalIds];
  process.stderr.write(`Resolving ${ids.length} canonical /articles docs\n`);
  const articleMap = await fetchCanonicalArticles(ids);

  const cols = [
    'user_article_id', 'user_url', 'resolved_id', 'archival_triggered',
    'canonical_url', 'domain', 'status', 'retry_count', 'error',
    'title', 'has_gcs_prefix',
    'success_archive_keys', 'core_loose_count', 'core_strict_count',
    'classification_loose', 'classification_strict',
    'user_created_at', 'canonical_updated_at',
  ];
  const out = [cols.join(',')];

  const counters = { complete: 0, failed: 0, processing: 0, pending: 0, partial: 0, unknown: 0, gcs_orphan: 0, never_archived: 0 };
  for (const u of userDocs) {
    const r = u.resolvedId ?? u.id;
    const a = articleMap.get(r);
    const hasGcs = gcsSet.has(r);
    const arch = a?.archives ?? {};
    const okKeys = Object.entries(arch).filter(([_, v]) => v?.status === 'success').map(([k]) => k);
    const looseCnt = LOOSE_KEYS.filter(k => arch[k]?.status === 'success').length;
    const strictCnt = STRICT_KEYS.filter(k => arch[k]?.status === 'success').length;
    const cLoose = classifyLoose(a, hasGcs);
    const cStrict = classifyStrict(a);
    counters[cLoose] = (counters[cLoose] ?? 0) + 1;
    out.push([
      csvCell(u.id), csvCell(u.url), csvCell(r), csvCell(u.archival_triggered),
      csvCell(a?.url), csvCell(a?.domain),
      csvCell(a?.status), csvCell(a?.retry_count), csvCell(a?.error),
      csvCell(a?.metadata?.title), csvCell(hasGcs),
      csvCell(okKeys.join(';')), csvCell(looseCnt), csvCell(strictCnt),
      csvCell(cLoose), csvCell(cStrict),
      csvCell(u.createTime), csvCell(a?._updateTime),
    ].join(','));
  }

  writeFileSync(OUT, out.join('\n'));
  process.stderr.write(`\nWrote ${out.length - 1} rows to ${OUT}\n`);
  process.stderr.write(`Classification counts (loose):\n`);
  for (const [k, v] of Object.entries(counters).sort(([, a], [, b]) => b - a)) {
    process.stderr.write(`  ${k.padEnd(16)} ${v}\n`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
