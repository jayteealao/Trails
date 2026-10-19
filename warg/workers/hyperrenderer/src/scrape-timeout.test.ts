import { describe, expect, it } from 'vitest';
import { scrapeTimeoutForApi } from './index.js';

describe('scrapeTimeoutForApi', () => {
  // Hyperbrowser 400s on scrapeOptions.timeout > 60000. The worker's own default
  // is 90000, so every fallback render failed until this clamp existed.
  it('clamps the configured default down to the API cap', () => {
    expect(scrapeTimeoutForApi(90000)).toBe(60000);
  });

  it('passes a value at the cap through unchanged', () => {
    expect(scrapeTimeoutForApi(60000)).toBe(60000);
  });

  it('leaves a value below the cap unchanged', () => {
    expect(scrapeTimeoutForApi(30000)).toBe(30000);
  });
});
