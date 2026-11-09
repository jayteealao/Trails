import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test } from 'vitest';

// A function bundle inlines this package and keeps firebase-admin external, as
// scripts/build-function-bundle.mjs does with each function's own dependencies.
// The writer must use the function's one Firestore SDK, never a second copy.

test('the writer bundles for node22 with firebase-admin external', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./index.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    external: ['firebase-admin', 'firebase-admin/*'],
    write: false,
    logLevel: 'silent',
  });

  expect(result.errors).toEqual([]);
  const code = result.outputFiles[0]?.text ?? '';
  expect(code).toMatch(/from\s+["']firebase-admin\/firestore["']/);
  expect(code).toContain('function markSharedArticleProcessing');
  expect(code).not.toContain('class Firestore');
});
