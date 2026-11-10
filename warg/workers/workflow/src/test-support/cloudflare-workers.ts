// Stands in for the Workers runtime module `cloudflare:workers` in node tests (aliased in vitest.config.ts).

export class WorkflowEntrypoint<E = unknown, _P = unknown> {
  protected ctx: unknown;
  protected env: E;

  constructor(ctx: unknown, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class DurableObject<E = unknown> {
  protected ctx: unknown;
  protected env: E;

  constructor(ctx: unknown, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}
