import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, test } from 'vitest';

// Each function that imports the normalizer bundles it with these esbuild options
// (scripts/build-function-bundle.mjs), resolving the package from its own folder.
const consumers = ['user-triggers', 'backfill-archiver', 'backfill-scripts'];

describe('a function bundle contains the normalizer', () => {
  test.each(consumers)('%s', async (consumer) => {
    const result = await build({
      stdin: {
        contents:
          'import { normalizeUrl } from "@warg/url-normalizer";\n' +
          'export const out = normalizeUrl("HTTPS://Example.com/a/?utm_source=x&b=1");\n',
        resolveDir: fileURLToPath(
          new URL(`../../../cloud-functions/${consumer}/`, import.meta.url)
        ),
        loader: 'ts'
      },
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      write: false,
      logLevel: 'silent'
    });

    expect(result.errors).toEqual([]);
    const code = result.outputFiles[0]?.text ?? '';
    expect(code).toContain('"fbclid"');
    const bundled = (await import(
      `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    )) as {
      out: string;
    };
    expect(bundled.out).toBe('https://example.com/a?b=1');
  });
});
