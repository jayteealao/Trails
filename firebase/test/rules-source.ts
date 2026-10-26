import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The grace-end line as committed in firestore.rules. The 0 means no grace
 * (fails closed); the deploy writes the real end into a build copy.
 */
export const GRACE_PLACEHOLDER = 'timestamp.value(0); // __GRACE_END_MS__';

export function readCommittedFirestoreRules(): string {
  return readFileSync(resolve(here, '../firestore.rules'), 'utf8');
}

export function readStorageRules(): string {
  return readFileSync(resolve(here, '../storage.rules'), 'utf8');
}

export function countPlaceholders(source: string): number {
  return source.split(GRACE_PLACEHOLDER).length - 1;
}

/**
 * Returns the rules source with the grace end set to `endMs` (epoch
 * milliseconds). Refuses a non-positive or unsafe end and a source that does
 * not hold the placeholder exactly once.
 */
export function stampGraceEnd(source: string, endMs: number): string {
  if (!Number.isSafeInteger(endMs) || endMs <= 0) {
    throw new Error(`grace end must be a positive integer of epoch milliseconds, got ${endMs}`);
  }
  const count = countPlaceholders(source);
  if (count !== 1) {
    throw new Error(`expected exactly one grace placeholder, found ${count}`);
  }
  return source.replace(GRACE_PLACEHOLDER, `timestamp.value(${endMs}); // __GRACE_END_MS__`);
}
