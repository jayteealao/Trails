/**
 * Test harness for the archive workflow: a fake step that runs or replays like
 * the Workflows engine, fake bindings for every service the run calls, an event
 * factory and failure fixtures. Test-only; never imported by the worker.
 */
import type { WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

type StepCallback = () => Promise<unknown>;

interface StepConfig {
  retries?: { limit: number };
}

export interface FakeStep {
  step: WorkflowStep;
  /** Every step.do name, in call order, cached or not. */
  names: string[];
  /** Callback executions per step name (a cached step adds none). */
  attempts: Map<string, number>;
  sleeps: Array<[string, unknown]>;
  /** Step results by `name#occurrence`, in the order they completed. */
  cache: Map<string, unknown>;
}

/**
 * A step that behaves like the Workflows engine on the points the tests pin:
 * a result is cached by step name and occurrence (deep-cloned, as the engine
 * serializes it), so a run against a seeded cache replays it; a throwing
 * callback is re-run up to `retries.limit` extra times, and at once stops on a
 * NonRetryableError. A step without a config is not retried. Sleeps return at once.
 */
export function makeFakeStep(seed: Map<string, unknown> = new Map()): FakeStep {
  const cache = new Map(seed);
  const names: string[] = [];
  const attempts = new Map<string, number>();
  const sleeps: Array<[string, unknown]> = [];
  const seen = new Map<string, number>();

  const fake = {
    async do(name: string, configOrFn: StepConfig | StepCallback, fn?: StepCallback): Promise<unknown> {
      names.push(name);
      const occurrence = (seen.get(name) ?? 0) + 1;
      seen.set(name, occurrence);
      const key = `${name}#${occurrence}`;
      if (cache.has(key)) return structuredClone(cache.get(key));

      const callback = typeof configOrFn === 'function' ? configOrFn : fn;
      const config = typeof configOrFn === 'function' ? undefined : configOrFn;
      if (!callback) throw new Error(`step ${name} has no callback`);

      const maxAttempts = (config?.retries?.limit ?? 0) + 1;
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        attempts.set(name, (attempts.get(name) ?? 0) + 1);
        try {
          const value = await callback();
          cache.set(key, structuredClone(value));
          return value;
        } catch (error) {
          lastError = error;
          if (error instanceof NonRetryableError) break;
        }
      }
      throw lastError;
    },
    async sleep(name: string, duration: unknown): Promise<void> {
      sleeps.push([name, duration]);
    },
  };

  // The fake implements only the step.do and step.sleep surface the workflow uses.
  return { step: fake as unknown as WorkflowStep, names, attempts, sleeps, cache };
}
