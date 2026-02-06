import { describe, it, expect } from 'vitest';
import type { ReadabilityResult } from './types.js';
import { toMarkdown } from './markdown.js';

function makeResult(overrides: Partial<ReadabilityResult> = {}): ReadabilityResult {
  return {
    title: null,
    byline: null,
    dir: null,
    lang: null,
    content: null,
    textContent: null,
    length: 0,
    excerpt: null,
    siteName: null,
    publishedTime: null,
    ...overrides
  };
}

describe('toMarkdown', () => {
  it('renders title as h1', () => {
    const md = toMarkdown(makeResult({ title: 'My Article' }));
    expect(md).toBe('# My Article\n');
  });

  it('renders byline as italics', () => {
    const md = toMarkdown(makeResult({ byline: 'John Doe' }));
    expect(md).toBe('*John Doe*\n');
  });

  it('renders publishedTime with prefix', () => {
    const md = toMarkdown(makeResult({ publishedTime: '2025-01-01' }));
    expect(md).toBe('Published: 2025-01-01\n');
  });

  it('renders textContent trimmed', () => {
    const md = toMarkdown(makeResult({ textContent: '  Hello world  ' }));
    expect(md).toBe('Hello world');
  });

  it('renders full article with all fields', () => {
    const md = toMarkdown(
      makeResult({
        title: 'Title',
        byline: 'Author',
        publishedTime: '2025-06-15',
        textContent: 'Body text here.'
      })
    );
    expect(md).toBe(
      '# Title\n\n*Author*\n\nPublished: 2025-06-15\n\nBody text here.'
    );
  });

  it('returns empty string when all fields are null', () => {
    const md = toMarkdown(makeResult());
    expect(md).toBe('');
  });
});
