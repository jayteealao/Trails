import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { extractLeadImage } from './lead-image.js';

const PAGE = 'https://example.com/post/1';

function page(head: string): string {
  const body = '<p>' + 'Some article text that Readability can keep. '.repeat(40) + '</p>';
  return `<!doctype html><html><head><title>T</title>${head}</head><body><article>${body}</article></body></html>`;
}

function lead(head: string, pageUrl: string | null = PAGE): string | null {
  return extractLeadImage(parseHTML(page(head)).document, pageUrl ?? undefined);
}

describe('extractLeadImage', () => {
  it('returns an absolute og:image unchanged', () => {
    expect(lead('<meta property="og:image" content="https://img.example.org/a.jpg">')).toBe(
      'https://img.example.org/a.jpg'
    );
  });

  it('resolves a relative og:image against the page URL', () => {
    expect(lead('<meta property="og:image" content="/img/a.jpg">')).toBe(
      'https://example.com/img/a.jpg'
    );
  });

  it('resolves a protocol-relative og:image', () => {
    expect(lead('<meta property="og:image" content="//cdn.example.com/a.jpg">')).toBe(
      'https://cdn.example.com/a.jpg'
    );
  });

  it('returns null for an invalid URL', () => {
    expect(lead('<meta property="og:image" content="http://[bad">')).toBeNull();
  });

  it('returns null when the page has no og:image', () => {
    expect(lead('<meta name="description" content="x">')).toBeNull();
  });

  it('returns null for a relative og:image without a page URL', () => {
    expect(lead('<meta property="og:image" content="/img/a.jpg">', null)).toBeNull();
  });

  it('returns null for a data: URL', () => {
    expect(lead('<meta property="og:image" content="data:image/png;base64,AAAA">')).toBeNull();
  });

  it('returns null for a URL longer than 2048 characters', () => {
    const long = 'https://example.com/' + 'a'.repeat(2100);
    expect(lead(`<meta property="og:image" content="${long}">`)).toBeNull();
  });

  it('takes the first of several og:image tags', () => {
    expect(
      lead(
        '<meta property="og:image" content="https://example.com/first.jpg">' +
          '<meta property="og:image" content="https://example.com/second.jpg">'
      )
    ).toBe('https://example.com/first.jpg');
  });

  it('reads og:image from a name attribute', () => {
    expect(lead('<meta name="og:image" content="https://example.com/n.jpg">')).toBe(
      'https://example.com/n.jpg'
    );
  });

  it('falls back to og:image:url', () => {
    expect(lead('<meta property="og:image:url" content="https://example.com/u.jpg">')).toBe(
      'https://example.com/u.jpg'
    );
  });

  it('skips a blank og:image content', () => {
    expect(
      lead(
        '<meta property="og:image" content="  ">' +
          '<meta property="og:image" content="https://example.com/b.jpg">'
      )
    ).toBe('https://example.com/b.jpg');
  });

  it('gives the same value when read before Readability parses the page', () => {
    const html = page('<meta property="og:image" content="/img/a.jpg">');
    const { document } = parseHTML(html);
    const before = extractLeadImage(document, PAGE);
    new Readability(document).parse();
    expect(before).toBe(extractLeadImage(parseHTML(html).document, PAGE));
    expect(before).toBe('https://example.com/img/a.jpg');
  });
});
