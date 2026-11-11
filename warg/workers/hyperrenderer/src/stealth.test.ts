// This test reads the checked-in config files from disk, so it needs the Node types (the workflow tests get them the same way).
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSessionOptions, toStealthMode } from './index.js';

describe('fallback renderer stealth setting', () => {
  it.each([
    [undefined, 'none'],
    ['', 'none'],
    ['none', 'none'],
    ['stealthy', 'none'],
    ['auto', 'auto'],
    ['ultra', 'ultra'],
  ] as const)('reads %j as %s', (value, expected) => {
    expect(toStealthMode(value)).toBe(expected);
  });

  it.each([undefined, 'none'])('sets no stealth flag on the session for %j', (value) => {
    const options = buildSessionOptions(toStealthMode(value));

    expect(options).toEqual({});
    expect(options).not.toHaveProperty('useStealth');
    expect(options).not.toHaveProperty('useUltraStealth');
  });

  it('keeps auto and ultra as an explicit opt-in', () => {
    expect(buildSessionOptions(toStealthMode('auto'))).toEqual({ useStealth: true });
    expect(buildSessionOptions(toStealthMode('ultra'))).toEqual({ useUltraStealth: true });
  });

  it('ships both worker configs with stealth off', () => {
    const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const cloudflare = readFileSync(new URL('../cloudflare.config.ts', import.meta.url), 'utf8');

    expect(wrangler).toMatch(/"HYPERBROWSER_STEALTH":\s*"none"/);
    expect(cloudflare).toMatch(/HYPERBROWSER_STEALTH:\s*bindings\.text\("none"\)/);
  });
});
