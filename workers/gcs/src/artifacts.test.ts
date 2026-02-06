import { describe, it, expect } from 'vitest';
import type { ArtifactMeta, ArtifactKind } from '@warg/shared';
import {
  COMPRESSIBLE_KINDS,
  shouldCompress,
  getGcsPath,
  filterPersistableArtifacts,
  toUploadInfo
} from './artifacts.js';

describe('COMPRESSIBLE_KINDS', () => {
  it('includes text-based HTML and markdown kinds', () => {
    expect(COMPRESSIBLE_KINDS.has('singlefile.html')).toBe(true);
    expect(COMPRESSIBLE_KINDS.has('monolith.html')).toBe(true);
    expect(COMPRESSIBLE_KINDS.has('rendered.html')).toBe(true);
    expect(COMPRESSIBLE_KINDS.has('rendered.md')).toBe(true);
    expect(COMPRESSIBLE_KINDS.has('readability.md')).toBe(true);
  });

  it('excludes binary and JSON kinds', () => {
    expect(COMPRESSIBLE_KINDS.has('screenshot.png')).toBe(false);
    expect(COMPRESSIBLE_KINDS.has('page.pdf')).toBe(false);
    expect(COMPRESSIBLE_KINDS.has('readability.json')).toBe(false);
    expect(COMPRESSIBLE_KINDS.has('manifest.json')).toBe(false);
  });
});

describe('shouldCompress', () => {
  it('returns true for compressible kinds', () => {
    expect(shouldCompress('singlefile.html')).toBe(true);
    expect(shouldCompress('rendered.html')).toBe(true);
  });

  it('returns false for non-compressible kinds', () => {
    expect(shouldCompress('screenshot.png')).toBe(false);
    expect(shouldCompress('readability.json')).toBe(false);
  });
});

describe('getGcsPath', () => {
  const requestId = 'req-abc';

  it('returns correct path for singlefile.html', () => {
    const result = getGcsPath(requestId, 'singlefile.html');
    expect(result).toEqual({
      folder: 'singlefile',
      filename: 'output.html',
      path: 'archives/req-abc/singlefile/output.html'
    });
  });

  it('returns correct path for screenshot.png', () => {
    const result = getGcsPath(requestId, 'screenshot.png');
    expect(result).toEqual({
      folder: 'screenshot',
      filename: 'output.png',
      path: 'archives/req-abc/screenshot/output.png'
    });
  });

  it('returns correct path for readability.json', () => {
    const result = getGcsPath(requestId, 'readability.json');
    expect(result).toEqual({
      folder: 'readability',
      filename: 'output.json',
      path: 'archives/req-abc/readability/output.json'
    });
  });

  it('returns correct path for page.pdf', () => {
    const result = getGcsPath(requestId, 'page.pdf');
    expect(result).toEqual({
      folder: 'pdf',
      filename: 'output.pdf',
      path: 'archives/req-abc/pdf/output.pdf'
    });
  });

  it('returns correct path for rendered.html', () => {
    const result = getGcsPath(requestId, 'rendered.html');
    expect(result.path).toBe('archives/req-abc/rendered/output.html');
  });

  it('returns correct path for rendered.md', () => {
    const result = getGcsPath(requestId, 'rendered.md');
    expect(result.path).toBe('archives/req-abc/rendered/output.md');
  });
});

describe('filterPersistableArtifacts', () => {
  const makeArtifact = (kind: ArtifactKind): ArtifactMeta => ({
    kind,
    r2Key: `archives/req/${kind}`,
    bytes: 100,
    sha256: 'abc',
    contentType: 'text/html'
  });

  it('excludes manifest.json', () => {
    const artifacts = [
      makeArtifact('rendered.html'),
      makeArtifact('manifest.json'),
      makeArtifact('singlefile.html')
    ];
    const result = filterPersistableArtifacts(artifacts);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.kind)).toEqual(['rendered.html', 'singlefile.html']);
  });

  it('returns all artifacts when no manifest.json present', () => {
    const artifacts = [makeArtifact('rendered.html'), makeArtifact('page.pdf')];
    const result = filterPersistableArtifacts(artifacts);
    expect(result).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(filterPersistableArtifacts([])).toEqual([]);
  });
});

describe('toUploadInfo', () => {
  const requestId = 'req-xyz';

  it('maps a compressible artifact correctly', () => {
    const artifact: ArtifactMeta = {
      kind: 'singlefile.html',
      r2Key: 'archives/req-xyz/derived/singlefile.html',
      bytes: 5000,
      sha256: 'hash123',
      contentType: 'text/html'
    };
    const info = toUploadInfo(requestId, artifact);
    expect(info).toEqual({
      kind: 'singlefile.html',
      filename: 'output.html',
      bytes: 5000,
      contentType: 'text/html',
      sha256: 'hash123',
      compressed: true
    });
  });

  it('maps a non-compressible artifact without compressed flag', () => {
    const artifact: ArtifactMeta = {
      kind: 'screenshot.png',
      r2Key: 'archives/req-xyz/raw/screenshot.png',
      bytes: 20000,
      sha256: 'hash456',
      contentType: 'image/png'
    };
    const info = toUploadInfo(requestId, artifact);
    expect(info).toEqual({
      kind: 'screenshot.png',
      filename: 'output.png',
      bytes: 20000,
      contentType: 'image/png',
      sha256: 'hash456'
    });
    expect(info).not.toHaveProperty('compressed');
  });
});
