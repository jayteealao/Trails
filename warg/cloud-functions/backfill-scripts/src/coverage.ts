export interface CoverageResult {
  readonly expectedCount: number;
  readonly existingCount: number;
  readonly missing: string[];
  readonly covered: boolean;
}

/**
 * Exact per-user coverage: every expected marker key must have an existing
 * marker. Extra existing markers (e.g. for keys beyond a `--limit` sample, or
 * historical keys) do not affect `covered`.
 */
export function computeCoverage(
  expected: ReadonlySet<string>,
  existing: ReadonlySet<string>,
): CoverageResult {
  const missing: string[] = [];
  for (const key of expected) {
    if (!existing.has(key)) missing.push(key);
  }
  return {
    expectedCount: expected.size,
    existingCount: existing.size,
    missing,
    covered: missing.length === 0,
  };
}
