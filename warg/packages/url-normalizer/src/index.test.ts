import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { normalizeUrl } from './index.js';

interface FixtureCase {
  name: string;
  input: string;
  expected: string;
}

// The same file drives the app's UrlNormalizerTest, which proves every expected value.
const { cases } = JSON.parse(
  readFileSync(
    new URL('../fixtures/url-normalizer-cases.json', import.meta.url),
    'utf8'
  )
) as { cases: FixtureCase[] };

describe('normalizeUrl matches the shared fixture', () => {
  test('the fixture holds at least 50 rows', () => {
    expect(cases.length).toBeGreaterThanOrEqual(50);
  });

  test.each(cases)('$name', ({ input, expected }) => {
    expect(normalizeUrl(input)).toBe(expected);
  });
});
