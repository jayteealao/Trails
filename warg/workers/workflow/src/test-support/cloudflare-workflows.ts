// Stands in for the Workers runtime module `cloudflare:workflows` in node tests (aliased in vitest.config.ts).

export class NonRetryableError extends Error {
  constructor(message: string, name = 'NonRetryableError') {
    super(message);
    this.name = name;
  }
}
