// Helpers for the rules step of scripts/deploy.sh.
//
// The committed firebase/firestore.rules holds the grace placeholder
// `timestamp.value(0); // __GRACE_END_MS__` exactly once. deploy.sh writes a
// build copy with the 0 replaced by the grace end (epoch ms), deploys that
// copy and compares the SHA-256 of each released ruleset with it. The grace
// end in force is read back from the released Firestore rules, so a later
// deploy reuses it instead of moving it. Build copies are LF-normalized: the
// Rules API stores the uploaded text verbatim, so a CRLF checkout would
// otherwise upload different bytes than the live rules.
//
//   node scripts/rules-release.mjs stamp --in <file> --out <file> --end-ms <n>
//   node scripts/rules-release.mjs normalize --in <file> --out <file>
//   node scripts/rules-release.mjs grace-end --in <file>
//   node scripts/rules-release.mjs sha256 --in <file>
//   node scripts/rules-release.mjs buckets --config <firebase.json> --rc <.firebaserc> --project <id>
//   node scripts/rules-release.mjs ruleset-content --in <ruleset.json>
//
// Exit codes: 3 when the rules break the placeholder contract, 64 for a usage
// error, 65 for input that is not the expected JSON.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const GRACE_PLACEHOLDER = 'timestamp.value(0); // __GRACE_END_MS__';
export const GRACE_LINE = /timestamp\.value\((\d+)\);\s*\/\/ __GRACE_END_MS__/g;

export function normalizeLf(text) {
  return text.replace(/\r\n/g, '\n');
}

function placeholderCount(source) {
  return source.split(GRACE_PLACEHOLDER).length - 1;
}

export function stampGraceEnd(source, endMs) {
  if (!Number.isSafeInteger(endMs) || endMs <= 0) {
    throw new Error(`the grace end must be a positive whole number of milliseconds, got ${endMs}`);
  }
  if (placeholderCount(source) !== 1) {
    throw new Error('firebase/firestore.rules must hold the grace placeholder exactly once');
  }
  const stamped = source.replace(GRACE_PLACEHOLDER, `timestamp.value(${endMs}); // __GRACE_END_MS__`);
  if (placeholderCount(stamped) !== 0) {
    throw new Error('the stamped rules still hold the grace placeholder');
  }
  return stamped;
}

// The stamped grace end, or null when the rules hold no grace line, more than
// one, or the unstamped placeholder.
export function readGraceEnd(source) {
  const matches = [...source.matchAll(GRACE_LINE)];
  if (matches.length !== 1) return null;
  const ms = Number(matches[0][1]);
  return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// The buckets the storage rules release to: each `bucket` entry, plus each
// `target` resolved through .firebaserc for the project.
export function storageBuckets(firebaseJson, firebaserc, projectId) {
  const entries = [firebaseJson.storage ?? []].flat();
  const buckets = [];
  for (const entry of entries) {
    if (entry.bucket) {
      buckets.push(entry.bucket);
    } else if (entry.target) {
      const resolved = firebaserc?.targets?.[projectId]?.storage?.[entry.target];
      const list = [resolved ?? []].flat();
      if (list.length === 0) {
        throw new Error(`storage target "${entry.target}" has no bucket in .firebaserc for ${projectId}`);
      }
      buckets.push(...list);
    }
  }
  return [...new Set(buckets)];
}

// The single rules file of a Rules API ruleset body.
export function rulesetContent(ruleset) {
  const files = ruleset?.source?.files;
  if (!Array.isArray(files) || files.length !== 1 || typeof files[0].content !== 'string') {
    throw new Error('the ruleset does not hold exactly one rules file');
  }
  return files[0].content;
}

class UsageError extends Error {}

function options(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || args[i + 1] === undefined) {
      throw new UsageError(`unexpected argument: ${args[i]}`);
    }
    out[args[i].slice(2)] = args[i + 1];
  }
  return out;
}

function need(opts, ...names) {
  for (const name of names) {
    if (opts[name] === undefined) throw new UsageError(`--${name} is required`);
  }
}

function readJson(path) {
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error(`${path} is not JSON`);
    err.exitCode = 65;
    throw err;
  }
}

export function main(argv) {
  const [command, ...rest] = argv;
  const opts = options(rest);
  switch (command) {
    case 'stamp': {
      need(opts, 'in', 'out', 'end-ms');
      const source = normalizeLf(readFileSync(opts.in, 'utf8'));
      let stamped;
      try {
        stamped = stampGraceEnd(source, Number(opts['end-ms']));
      } catch (err) {
        err.exitCode = 3;
        throw err;
      }
      writeFileSync(opts.out, stamped);
      return;
    }
    case 'normalize':
      need(opts, 'in', 'out');
      writeFileSync(opts.out, normalizeLf(readFileSync(opts.in, 'utf8')));
      return;
    case 'grace-end': {
      need(opts, 'in');
      const ms = readGraceEnd(readFileSync(opts.in, 'utf8'));
      if (ms !== null) console.log(ms);
      return;
    }
    case 'sha256':
      need(opts, 'in');
      console.log(sha256Hex(readFileSync(opts.in, 'utf8')));
      return;
    case 'buckets': {
      need(opts, 'config', 'rc', 'project');
      const buckets = storageBuckets(readJson(opts.config), readJson(opts.rc), opts.project);
      if (buckets.length) console.log(buckets.join('\n'));
      return;
    }
    case 'ruleset-content': {
      need(opts, 'in');
      let content;
      try {
        content = rulesetContent(readJson(opts.in));
      } catch (err) {
        err.exitCode ??= 65;
        throw err;
      }
      process.stdout.write(content);
      return;
    }
    default:
      throw new UsageError(`unknown command: ${command ?? '(none)'}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`rules-release: ${err.message}`);
    process.exit(err instanceof UsageError ? 64 : (err.exitCode ?? 1));
  }
}
