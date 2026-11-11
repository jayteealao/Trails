import { describe, it, expect } from 'vitest';
import type { ArtifactKind } from './types.js';
import {
  SAFE_ID_RE,
  LEGACY_SAFE_ID_RE,
  extractDomain,
  extractHostname,
  GCS_ARTIFACT_PATHS,
  getGcsPath,
} from './archive-ids.js';

// The literals each copy held before the copies were merged. Every row checks
// that the shared constant gives the same verdict as the literal it replaced.
const OLD_CREATOR_RE = new RegExp('^[a-zA-Z0-9_-]{8,40}$'); // dashboard, cloud functions, SHARED_ID_PATTERN
const OLD_GATEWAY_RE = new RegExp('^[a-zA-Z0-9_-]{1,40}$'); // gateway request ids

const VALID_BEFORE = [
  'abcdefgh',
  'AbCdEfGhIjKlMnOpQrSt', // 20-character Firestore id
  'aZ09_-bcDEF123', // 14-character Pocket id
  'a'.repeat(40),
];

const REJECTED_BEFORE = [
  '',
  'a'.repeat(41),
  'abc/defg',
  'abc.defg',
  'abc defg',
  '../../etc/passwd',
];

describe('SAFE_ID_RE and LEGACY_SAFE_ID_RE', () => {
  it.each(VALID_BEFORE)('keeps %j valid for both rules', (id) => {
    expect(OLD_CREATOR_RE.test(id)).toBe(true);
    expect(OLD_GATEWAY_RE.test(id)).toBe(true);
    expect(SAFE_ID_RE.test(id)).toBe(OLD_CREATOR_RE.test(id));
    expect(LEGACY_SAFE_ID_RE.test(id)).toBe(OLD_GATEWAY_RE.test(id));
  });

  it.each(REJECTED_BEFORE)('keeps %j rejected by both rules', (id) => {
    expect(OLD_CREATOR_RE.test(id)).toBe(false);
    expect(OLD_GATEWAY_RE.test(id)).toBe(false);
    expect(SAFE_ID_RE.test(id)).toBe(false);
    expect(LEGACY_SAFE_ID_RE.test(id)).toBe(false);
  });

  it('the gateway accepts 1-7 character legacy ids the dashboard rejects', () => {
    for (const id of ['0', '54149', 'a'.repeat(7)]) {
      expect(OLD_GATEWAY_RE.test(id)).toBe(true);
      expect(OLD_CREATOR_RE.test(id)).toBe(false);
      expect(LEGACY_SAFE_ID_RE.test(id)).toBe(true);
      expect(SAFE_ID_RE.test(id)).toBe(false);
    }
  });

  it('carries exactly the old literals', () => {
    expect(SAFE_ID_RE.source).toBe(OLD_CREATOR_RE.source);
    expect(LEGACY_SAFE_ID_RE.source).toBe(OLD_GATEWAY_RE.source);
    expect(SAFE_ID_RE.flags).toBe('');
    expect(LEGACY_SAFE_ID_RE.flags).toBe('');
  });
});

describe('extractDomain and extractHostname', () => {
  it('strips a leading www. only in extractDomain', () => {
    expect(extractDomain('https://www.example.com/a')).toBe('example.com');
    expect(extractHostname('https://www.example.com/a')).toBe('www.example.com');
  });

  it('leaves an inner www. alone in both', () => {
    expect(extractDomain('https://sub.www.example.com')).toBe('sub.www.example.com');
    expect(extractHostname('https://sub.www.example.com')).toBe('sub.www.example.com');
  });

  it('lower-cases the host and drops the port', () => {
    expect(extractDomain('http://EXAMPLE.com:8080')).toBe('example.com');
    expect(extractHostname('http://EXAMPLE.com:8080')).toBe('example.com');
  });

  it('answers unknown for a URL that does not parse', () => {
    expect(extractDomain('not a url')).toBe('unknown');
    expect(extractHostname('not a url')).toBe('unknown');
  });
});

describe('getGcsPath', () => {
  // Copied from the two maps the gcs worker and the upload function held.
  const EXPECTED: Record<ArtifactKind, { folder: string; filename: string; path: string }> = {
    'singlefile.html': { folder: 'singlefile', filename: 'output.html.gz', path: 'archives/req-1/singlefile/output.html.gz' },
    'monolith.html': { folder: 'monolith', filename: 'output.html.gz', path: 'archives/req-1/monolith/output.html.gz' },
    'readability.json': { folder: 'readability', filename: 'output.json', path: 'archives/req-1/readability/output.json' },
    'readability.md': { folder: 'readability', filename: 'output.md.gz', path: 'archives/req-1/readability/output.md.gz' },
    'ai-markdown.md': { folder: 'ai-markdown', filename: 'output.md.gz', path: 'archives/req-1/ai-markdown/output.md.gz' },
    'page.pdf': { folder: 'pdf', filename: 'output.pdf', path: 'archives/req-1/pdf/output.pdf' },
    'screenshot.png': { folder: 'screenshot', filename: 'output.png', path: 'archives/req-1/screenshot/output.png' },
    'rendered.html': { folder: 'rendered', filename: 'output.html.gz', path: 'archives/req-1/rendered/output.html.gz' },
    'rendered.md': { folder: 'rendered', filename: 'output.md.gz', path: 'archives/req-1/rendered/output.md.gz' },
    'manifest.json': { folder: 'manifest', filename: 'manifest.json', path: 'archives/req-1/manifest/manifest.json' },
  };

  it.each(Object.keys(EXPECTED) as ArtifactKind[])('maps %s to its storage path', (kind) => {
    expect(getGcsPath('req-1', kind)).toEqual(EXPECTED[kind]);
  });

  it('covers every artifact kind and no other', () => {
    expect(Object.keys(GCS_ARTIFACT_PATHS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('throws for an unknown kind', () => {
    expect(() => getGcsPath('req-1', 'bogus' as never)).toThrow('Unknown artifact kind: bogus');
  });
});
