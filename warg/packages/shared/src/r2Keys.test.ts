import { describe, it, expect } from 'vitest';
import { getR2Key, getOptionsKey } from './r2Keys.js';

describe('getR2Key', () => {
  const requestId = 'abc123';

  it('generates correct key for rendered.html', () => {
    expect(getR2Key(requestId, 'rendered.html')).toBe(
      'archives/abc123/raw/rendered.html'
    );
  });

  it('generates correct key for rendered.md', () => {
    expect(getR2Key(requestId, 'rendered.md')).toBe('archives/abc123/raw/rendered.md');
  });

  it('generates correct key for screenshot.png', () => {
    expect(getR2Key(requestId, 'screenshot.png')).toBe(
      'archives/abc123/raw/screenshot.png'
    );
  });

  it('generates correct key for page.pdf', () => {
    expect(getR2Key(requestId, 'page.pdf')).toBe('archives/abc123/raw/page.pdf');
  });

  it('generates correct key for singlefile.html', () => {
    expect(getR2Key(requestId, 'singlefile.html')).toBe(
      'archives/abc123/derived/singlefile.html'
    );
  });

  it('generates correct key for readability.json', () => {
    expect(getR2Key(requestId, 'readability.json')).toBe(
      'archives/abc123/derived/readability.json'
    );
  });

  it('generates correct key for readability.md', () => {
    expect(getR2Key(requestId, 'readability.md')).toBe(
      'archives/abc123/derived/readability.md'
    );
  });

  it('generates correct key for monolith.html', () => {
    expect(getR2Key(requestId, 'monolith.html')).toBe(
      'archives/abc123/derived/monolith.html'
    );
  });

  it('generates correct key for manifest.json', () => {
    expect(getR2Key(requestId, 'manifest.json')).toBe(
      'archives/abc123/manifest.json'
    );
  });
});

describe('getOptionsKey', () => {
  it('generates correct key for options', () => {
    expect(getOptionsKey('abc123')).toBe('archives/abc123/input/options.json');
  });
});
