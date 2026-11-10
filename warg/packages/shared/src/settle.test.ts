import { describe, it, expect } from 'vitest';
import { parseRequestSettle, isIncompleteDegradation } from './settle.js';

const at = '2026-01-01T00:00:00.000Z';

describe('parseRequestSettle', () => {
  it('accepts a done settle', () => {
    expect(parseRequestSettle({ state: 'done', runId: 'r1', settledAt: at })).toEqual({
      state: 'done',
      runId: 'r1',
      settledAt: at,
    });
  });

  it('accepts a failed settle with its error fields', () => {
    expect(
      parseRequestSettle({
        state: 'failed',
        runId: 'r1',
        settledAt: at,
        errorCode: 'NO_OUTPUTS_PRODUCED',
        retryable: true,
        recommendedAction: 'retry_full',
        errorMessage: 'No outputs',
      })
    ).toEqual({
      state: 'failed',
      runId: 'r1',
      settledAt: at,
      errorCode: 'NO_OUTPUTS_PRODUCED',
      retryable: true,
      recommendedAction: 'retry_full',
      errorMessage: 'No outputs',
    });
  });

  it('drops an unknown error code and an unknown action', () => {
    expect(
      parseRequestSettle({
        state: 'failed',
        runId: 'r1',
        settledAt: at,
        errorCode: 'NOT_A_CODE',
        recommendedAction: 'reboot',
      })
    ).toEqual({ state: 'failed', runId: 'r1', settledAt: at });
  });

  it('cuts the error message to 500 characters', () => {
    const settle = parseRequestSettle({
      state: 'failed',
      runId: 'r1',
      settledAt: at,
      errorMessage: 'x'.repeat(800),
    });
    expect(settle?.errorMessage).toHaveLength(500);
  });

  it.each([
    ['null', null],
    ['a missing runId', { state: 'done', settledAt: at }],
    ['an empty runId', { state: 'done', runId: '', settledAt: at }],
    ['a non-terminal state', { state: 'queued', runId: 'r1', settledAt: at }],
    ['an unreadable settledAt', { state: 'done', runId: 'r1', settledAt: 'yesterday' }],
  ])('rejects %s', (_label, value) => {
    expect(parseRequestSettle(value)).toBeUndefined();
  });
});

describe('isIncompleteDegradation', () => {
  it.each([
    ['monolith', ['monolith']],
    ['singlefile only', ['singlefile']],
  ])('is true when %s degraded', (_label, steps) => {
    expect(isIncompleteDegradation(steps)).toBe(true);
  });

  it.each([
    ['no steps', []],
    ['undefined', undefined],
  ])('is false for %s', (_label, steps) => {
    expect(isIncompleteDegradation(steps)).toBe(false);
  });
});
