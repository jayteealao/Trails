import { describe, it, expect } from 'vitest';
import type { ReadabilityResult } from '@warg/shared';
import { buildFinalizeMetadata } from './metadata.js';

function result(overrides: Partial<ReadabilityResult> = {}): ReadabilityResult {
  return {
    title: 'A title',
    byline: 'Jane Doe',
    dir: null,
    lang: 'en',
    content: '<p>one two three</p>',
    textContent: '  one two\n three  ',
    length: 13,
    excerpt: 'An excerpt',
    siteName: 'Example',
    publishedTime: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildFinalizeMetadata', () => {
  it('passes lead_image through unchanged', () => {
    const url = 'https://example.com/a.jpg';
    expect(buildFinalizeMetadata(result({ leadImage: url })).lead_image).toBe(url);
  });

  it('maps a null leadImage to null', () => {
    expect(buildFinalizeMetadata(result({ leadImage: null })).lead_image).toBeNull();
  });

  it('maps a result written before leadImage existed to null', () => {
    const old = result();
    expect('leadImage' in old).toBe(false);
    const metadata = buildFinalizeMetadata(old);
    expect(metadata).toHaveProperty('lead_image');
    expect(metadata.lead_image).toBeNull();
  });

  it('keeps the six existing fields as before', () => {
    expect(buildFinalizeMetadata(result())).toEqual({
      byline: 'Jane Doe',
      excerpt: 'An excerpt',
      published_time: '2026-10-01T00:00:00Z',
      site_name: 'Example',
      title: 'A title',
      word_count: 3,
      lead_image: null,
    });
  });

  it('uses the same defaults as before for missing values', () => {
    expect(
      buildFinalizeMetadata(
        result({
          title: null,
          byline: null,
          excerpt: null,
          siteName: null,
          publishedTime: null,
          textContent: null,
        })
      )
    ).toEqual({
      byline: '',
      excerpt: '',
      published_time: null,
      site_name: null,
      title: '',
      word_count: 0,
      lead_image: null,
    });
  });
});
