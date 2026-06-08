import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * The single real production user. The other ~4 accounts are test users that
 * rely on the app's steady-state marker write + read-denial self-heal once the
 * tightened read rule deploys. Mirrors `BACKFILL_USER_ID` in backfill-archiver.
 */
export const DEFAULT_USER_ID = 'TGtRF6GrQaSmfjGk9GEYJ8YZc0v1';

/** Production Firestore project these scripts target via ADC. */
export const PROJECT_ID = 'trails-e428e';

/** Abort window before any write/delete against production. */
const PROD_ABORT_MS = 5_000;

export interface CliArgs {
  readonly user: string;
  readonly apply: boolean;
  readonly limit: number;
  readonly yes: boolean;
}

function readFlagValue(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

/**
 * Parse the shared CLI surface. Dry-run is the default; `--apply` opts into
 * writes/deletes. `--user` overrides the target uid; `--limit` caps the article
 * scan; `--yes` skips the production abort window.
 */
export function parseArgs(argv: readonly string[] = process.argv.slice(2)): CliArgs {
  const apply = argv.includes('--apply');
  const yes = argv.includes('--yes');
  const user = readFlagValue(argv, '--user') ?? DEFAULT_USER_ID;

  let limit = Number.POSITIVE_INFINITY;
  const limitRaw = readFlagValue(argv, '--limit');
  if (limitRaw !== undefined) {
    const parsed = Number(limitRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`--limit must be a positive number, got "${limitRaw}"`);
    }
    limit = Math.floor(parsed);
  }

  return { user, apply, limit, yes };
}

/** Lazily initialize the Admin SDK (ADC, or the emulator when
 * `FIRESTORE_EMULATOR_HOST` is set) and return Firestore. Kept lazy so importing
 * a CLI module for its exported logic never touches credentials. */
export function getDb(): Firestore {
  if (getApps().length === 0) {
    // Pin the production project so the script can never silently target
    // whatever project ambient ADC resolves to. The emulator path keeps default
    // resolution — FIRESTORE_EMULATOR_HOST routes the SDK to the emulator.
    const usingEmulator = process.env['FIRESTORE_EMULATOR_HOST'] != null;
    initializeApp(usingEmulator ? undefined : { projectId: PROJECT_ID });
  }
  return getFirestore();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Make the write target explicit before any destructive operation. When the
 * emulator host is set we proceed immediately; against production we warn and
 * wait a short abort window (skippable with `--yes`).
 */
export async function assertTargetEnv(skipWait = false): Promise<void> {
  const emulator = process.env['FIRESTORE_EMULATOR_HOST'];
  if (emulator) {
    console.log(`[backfill-scripts] targeting EMULATOR ${emulator}`);
    return;
  }

  console.warn(
    `[backfill-scripts] targeting PRODUCTION ${PROJECT_ID} — press Ctrl-C now to abort.`,
  );
  if (skipWait) return;

  for (let remaining = PROD_ABORT_MS / 1_000; remaining > 0; remaining -= 1) {
    process.stderr.write(`  continuing in ${remaining}s...\r`);
    await sleep(1_000);
  }
  process.stderr.write('\n');
}

/** True when `moduleUrl` is the entrypoint Node was invoked with. Lets a CLI
 * file export its logic for tests yet still run `main()` when executed directly. */
export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return moduleUrl === pathToFileURL(entry).href;
}
