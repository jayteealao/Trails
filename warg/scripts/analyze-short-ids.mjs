// One-off: quantify how many backlog items the gateway request_id fix unblocks.
// resolved_id (col 3) is the canonical id sent to /begin as request_id.
import { readFileSync } from 'node:fs';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_OLD = /^[a-zA-Z0-9_-]{8,40}$/; // pre-fix gateway rule
const SAFE_NEW = /^[a-zA-Z0-9_-]{1,40}$/; // post-fix gateway rule

const lines = readFileSync(
  new URL('./user-TGtRF6GrQaSmfjGk9GEYJ8YZc0v1-audit.csv', import.meta.url),
  'utf8'
).split(/\r?\n/);

const header = lines[0].split(',');
const COL = (name) => header.indexOf(name);
const _iResolved = COL('resolved_id');
const _iStatus = COL('status');
const _iDomain = COL('domain');

let total = 0, unanchored = 0;
const shortRows = [];               // unblocked by fix (1-7 char safe id, not UUID)
const stillBroken = [];             // fail even the new rule (bad chars / >40 / empty)
const distinctShort = new Set();
const distinctShortFailed = new Set();
const shortByStatus = {};

// resolved_id sits immediately before archival_triggered ("true"/"false"), which is
// robust even when user_url contains commas (split shifts the URL, not the anchor).
for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line) continue;
  const f = line.split(',');
  let t = -1;
  for (let j = 2; j < f.length; j++) { if (f[j] === 'true' || f[j] === 'false') { t = j; break; } }
  if (t < 1) { unanchored++; continue; }
  total++;
  const id = f[t - 1];
  // status is 3 columns after archival_triggered (canonical_url, domain, status)
  const status = f[t + 3] ?? '';
  const domain = f[t + 2] ?? '';
  const oldOk = UUID_V4.test(id) || SAFE_OLD.test(id);
  const newOk = UUID_V4.test(id) || SAFE_NEW.test(id);
  if (newOk && !oldOk) {
    shortRows.push({ id, domain, status });
    distinctShort.add(id);
    if (status === 'failed') distinctShortFailed.add(id);
    shortByStatus[status || '(empty)'] = (shortByStatus[status || '(empty)'] ?? 0) + 1;
  } else if (!newOk) {
    stillBroken.push({ id, domain, status });
  }
}

console.log(`rows anchored:              ${total}`);
console.log(`rows unanchored (skipped): ${unanchored}`);
console.log(`\n=== UNBLOCKED BY FIX (resolved_id 1-7 chars, was rejected) ===`);
console.log(`  rows:            ${shortRows.length}`);
console.log(`  distinct ids:    ${distinctShort.size}`);
console.log(`  distinct ids currently 'failed': ${distinctShortFailed.size}`);
console.log(`  by current status:`, shortByStatus);
console.log(`  sample:`, shortRows.slice(0, 15).map((r) => `${r.id}(${r.domain}/${r.status})`).join(', '));
const freq = {};
for (const r of shortRows) freq[r.id] = (freq[r.id] ?? 0) + 1;
const shared = Object.entries(freq).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
console.log(`\n=== SHORT IDs SHARED BY >1 ARTICLE (collision risk — same id, different URLs) ===`);
console.log(`  ${shared.map(([id, n]) => `"${id}"×${n}`).join(', ') || '(none)'}`);

console.log(`\n=== STILL INVALID even after fix (bad chars / >40 / empty) ===`);
console.log(`  rows:            ${stillBroken.length}`);
console.log(`  sample:`, stillBroken.slice(0, 10).map((r) => `"${r.id}"(${r.domain})`).join(', '));
