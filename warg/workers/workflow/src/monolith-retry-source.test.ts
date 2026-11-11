/**
 * The wait between monolith attempts belongs to the Workflows runtime: the
 * monolith step declares its retry policy and neither the workflow nor the
 * monolith Worker sleeps with a timer to retry. These checks read the source so
 * a hand-written wait or the old retry loop cannot come back unnoticed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const monolithSource = readFileSync(new URL('../../monolith/src/index.ts', import.meta.url), 'utf8');

describe('monolith retry path', () => {
  it('has no timer wait in the workflow or the monolith Worker', () => {
    expect(workflowSource).not.toContain('setTimeout');
    expect(monolithSource).not.toContain('setTimeout');
  });

  it('runs monolith as one named step, without the old loop steps', () => {
    expect(workflowSource).toContain("'monolith-attempt-1'");
    expect(workflowSource).not.toContain('monolith-attempt-2');
    expect(workflowSource).not.toContain('monolith-backoff');
  });
});
