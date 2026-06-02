#!/usr/bin/env node
// One-shot reconciler: re-derive every articles/{id}.status field from
// the document's own archives/failure/processing fields, using the same
// rules as the articleStatusDerive Firestore trigger.
//
// Plan 1 from warg/plans/article-status-recovery.md. Idempotent.
//
// Usage:
//   gcloud auth login          (once)
//   node warg/scripts/reconcile-status.mjs                # dry-run
//   node warg/scripts/reconcile-status.mjs --apply        # writes
//   node warg/scripts/reconcile-status.mjs --apply --limit 500
//
// The dry-run mode prints a per-transition table so you can sanity-check
// the migration scope before flipping the flag.

import { execFileSync } from 'node:child_process';

const PROJECT = 'trails-e428e';
const DB = `projects/${PROJECT}/databases/(default)`;
const DOC_PREFIX = `${DB}/documents`;
const PAGE_SIZE = 300;
// Keep in sync with article-status.ts / backfill index.ts (Workstream C3).
const STUCK_TIMEOUT_MS = 45 * 60 * 1000;
const MAX_RETRIES = 2;
const SUFFICIENT_ARCHIVES = ['rendered', 'singlefile', 'monolith'];

// --- CLI parsing ---
const apply = process.argv.includes('--apply');
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
async function api(path, body) {
  if (!token || Date.now() - tokenAt > 30 * 60 * 1000) refreshToken();
  const url = `https://firestore.googleapis.com/v1${path}`;
  const init = body
    ? {
        method: path.includes(':') ? 'POST' : 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    : { headers: { Authorization: `Bearer ${token}` } };
  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text.slice(0, 400)}`);
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
  if ('referenceValue' in v) return v.referenceValue;
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

// --- The rules (mirror of article-status.ts deriveStatus) ---
function hasSufficientArtifact(doc) {
  const archives = doc?.archives ?? {};
  return SUFFICIENT_ARCHIVES.some((k) => archives[k]?.status === 'success');
}
function hasAnySuccessfulArchive(doc) {
  const archives = doc?.archives ?? {};
  return Object.values(archives).some((v) => v?.status === 'success');
}
function timestampToMs(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}
function deriveStatus(doc, nowMs) {
  if (hasSufficientArtifact(doc)) return 'complete';

  const failureClass = doc?.failure?.class ?? null;
  const retryCount =
    typeof doc?.retry_count === 'number' ? doc.retry_count : 0;

  if (failureClass === 'DATA_ISSUE') return 'abandoned';

  const startedMs = timestampToMs(doc?.processing_started_at);
  if (startedMs !== null && nowMs - startedMs <= STUCK_TIMEOUT_MS) {
    return 'processing';
  }

  const archives = doc?.archives ?? {};
  // Legacy signal — see article-status.ts for rationale.
  const hasLegacyError = typeof doc?.error === 'string' && doc.error.length > 0;
  const hasFailureSignal =
    archives.workflow_settlement?.status === 'stuck' ||
    archives.workflow_settlement?.status === 'failed' ||
    archives.gateway_begin?.status === 'failed' ||
    failureClass !== null ||
    hasLegacyError;

  if (hasFailureSignal) {
    if (retryCount >= MAX_RETRIES && !hasAnySuccessfulArchive(doc)) {
      return 'abandoned';
    }
    if (hasAnySuccessfulArchive(doc)) return 'partial';
    return 'failed';
  }
  if (hasAnySuccessfulArchive(doc)) return 'partial';
  return 'pending';
}

// --- Write helpers ---
async function patchStatus(docName, newStatus) {
  const path = `/${docName}?updateMask.fieldPaths=status&updateMask.fieldPaths=status_updated_at`;
  const body = {
    fields: {
      status: { stringValue: newStatus },
      status_updated_at: { timestampValue: new Date().toISOString() },
    },
  };
  await api(path, body);
}

// --- Stream all articles ---
async function* streamAllArticles() {
  let cursor = null;
  while (true) {
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'articles' }],
        orderBy: [
          { field: { fieldPath: '__name__' }, direction: 'ASCENDING' },
        ],
        limit: PAGE_SIZE,
        ...(cursor
          ? {
              startAt: {
                values: [{ referenceValue: cursor }],
                before: false,
              },
            }
          : {}),
      },
    };
    const result = await api(`/${DOC_PREFIX}:runQuery`, body);
    const docs = result.filter((r) => r.document).map((r) => r.document);
    if (docs.length === 0) break;
    for (const d of docs) yield d;
    cursor = docs[docs.length - 1].name;
    if (docs.length < PAGE_SIZE) break;
  }
}

async function main() {
  refreshToken();
  process.stderr.write(
    `Reconcile-status (${apply ? 'APPLY' : 'dry-run'}) — project=${PROJECT}\n`
  );

  const nowMs = Date.now();
  const transitions = new Map();
  let scanned = 0;
  let drifted = 0;
  let written = 0;

  for await (const doc of streamAllArticles()) {
    if (scanned >= LIMIT) break;
    scanned += 1;
    const data = fields(doc);
    const current = data.status ?? '<missing>';
    const derived = deriveStatus(data, nowMs);
    if (current === derived) continue;

    drifted += 1;
    const key = `${current} → ${derived}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);

    if (apply) {
      try {
        await patchStatus(doc.name, derived);
        written += 1;
      } catch (e) {
        process.stderr.write(
          `  ! failed ${doc.name.split('/').pop()}: ${String(e).slice(0, 200)}\n`
        );
      }
    }

    if (scanned % 500 === 0) {
      process.stderr.write(
        `  scanned=${scanned} drifted=${drifted} written=${written}\n`
      );
    }
  }

  process.stderr.write(`\nDone. scanned=${scanned} drifted=${drifted} written=${written}\n\n`);
  process.stderr.write('Transitions:\n');
  for (const [k, v] of [...transitions.entries()].sort(([, a], [, b]) => b - a)) {
    process.stderr.write(`  ${k.padEnd(40)} ${v}\n`);
  }
  if (!apply) {
    process.stderr.write('\n(dry-run — pass --apply to actually patch documents)\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
