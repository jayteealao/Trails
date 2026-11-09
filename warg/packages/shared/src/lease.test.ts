import { describe, it, expect } from 'vitest';
import { LEASE_TTL_MS, isLeaseStale } from './lease.js';

describe('LEASE_TTL_MS', () => {
  it('is five minutes', () => {
    expect(LEASE_TTL_MS).toBe(300_000);
  });
});

describe('isLeaseStale', () => {
  const now = 1_000_000_000;

  it('keeps a lease one second short of the TTL', () => {
    expect(isLeaseStale(now - 299_000, now)).toBe(false);
  });

  it('calls a lease stale once its age reaches the TTL', () => {
    expect(isLeaseStale(now - 300_000, now)).toBe(true);
  });

  it('calls a lease stale one second past the TTL', () => {
    expect(isLeaseStale(now - 301_000, now)).toBe(true);
  });

  it('keeps a lease whose acquiredAt is in the future', () => {
    expect(isLeaseStale(now + 1_000, now)).toBe(false);
  });
});
