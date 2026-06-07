import process from 'node:process';

import type { Firestore } from 'firebase-admin/firestore';

import {
  extractResolvedId,
  readExistingMarkerKeys,
  streamUserArticles,
} from './articles.js';
import { computeCoverage } from './coverage.js';
import type { CoverageResult } from './coverage.js';
import { getDb, isMain, parseArgs } from './firebase.js';
import { deriveMarkerKeys } from './keys.js';

const MISSING_SAMPLE_SIZE = 20;

/**
 * Derive the full expected-key set from the user's articles and compare against
 * their existing markers. Read-only — the authorizing precondition for the
 * read-rule flip.
 */
export async function computeUserCoverage(
  db: Firestore,
  user: string,
  limit = Number.POSITIVE_INFINITY,
): Promise<CoverageResult> {
  const existing = await readExistingMarkerKeys(db, user);
  const expected = new Set<string>();

  let articles = 0;
  for await (const doc of streamUserArticles(db, user)) {
    if (articles >= limit) break;
    articles += 1;
    for (const key of deriveMarkerKeys(doc.id, extractResolvedId(doc.data()))) {
      expected.add(key);
    }
  }

  return computeCoverage(expected, existing);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const db = getDb();

  const result = await computeUserCoverage(db, args.user, args.limit);

  console.log(
    `[gate] user=${args.user} expected=${result.expectedCount} existing=${result.existingCount} missing=${result.missing.length}`,
  );
  if (result.missing.length > 0) {
    const sample = result.missing.slice(0, MISSING_SAMPLE_SIZE);
    console.log(`[gate] sample missing keys: ${sample.join(', ')}`);
  }
  console.log(`[gate] ${result.covered ? 'COVERED — safe to flip the read rule' : 'GAP — do NOT flip the read rule'}`);

  process.exit(result.covered ? 0 : 1);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
