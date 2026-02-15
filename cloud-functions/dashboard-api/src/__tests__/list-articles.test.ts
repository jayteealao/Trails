import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeArticle } from '../list-articles.js';

test('mergeArticle includes health with best archive and score', () => {
  const article = mergeArticle(
    'item-1',
    { url: 'https://example.com', timeAdded: { toDate: () => new Date('2026-01-01T00:00:00Z') } },
    {
      domain: 'example.com',
      archives: {
        rendered: { status: 'success' },
        readability: { status: 'success' },
        markdown: { status: 'success' },
        singlefile: { status: 'failed' },
      },
      metadata: { title: 'Example' },
    }
  );

  assert.equal(article.health.completenessScore, 75);
  assert.equal(article.health.bestAvailableArchive, 'markdown');
  assert.deepEqual(article.health.missingCore, ['singlefile']);
});
