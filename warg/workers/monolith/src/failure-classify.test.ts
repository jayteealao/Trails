import { describe, expect, it } from 'vitest';
import { isR2CredentialRejection, isRpc32MiBLimit } from './failure-classify.js';

describe('isRpc32MiBLimit', () => {
  it('matches the live readFile overflow message', () => {
    expect(
      isRpc32MiBLimit(
        'Serialized RPC arguments or return values are limited to 32MiB, but the size of this value was: 34196415 bytes.'
      )
    ).toBe(true);
  });

  it('matches the raw byte ceiling and capnp phrasings', () => {
    expect(isRpc32MiBLimit('value was 33554432 bytes')).toBe(true);
    expect(isRpc32MiBLimit('Message length too big')).toBe(true);
    expect(isRpc32MiBLimit('exceeded max allowed message length')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isRpc32MiBLimit('LIMITED TO 32MIB')).toBe(true);
  });

  it('does not match unrelated sandbox errors', () => {
    expect(isRpc32MiBLimit('SandboxError: HTTP error! status: 500')).toBe(false);
    expect(isRpc32MiBLimit('connection timed out')).toBe(false);
    expect(isRpc32MiBLimit('')).toBe(false);
  });
});

describe('isR2CredentialRejection', () => {
  it.each([
    'curl: (22) The requested URL returned error: 403',
    '<Code>SignatureDoesNotMatch</Code>',
    'InvalidAccessKeyId',
  ])('reads %s as a rejected storage key', (output) => {
    expect(isR2CredentialRejection(output)).toBe(true);
  });

  it.each([
    'curl: (22) The requested URL returned error: 404',
    'curl: (22) The requested URL returned error: 4030',
    'monolith blew up',
  ])('does not read %s as a rejected storage key', (output) => {
    expect(isR2CredentialRejection(output)).toBe(false);
  });
});
