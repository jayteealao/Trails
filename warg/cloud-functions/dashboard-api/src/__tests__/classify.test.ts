import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArticleHealth, buildArchiveStatuses, classifyArchiveStatus } from '../classify.js';

test('buildArticleHealth returns deterministic score and best archive', () => {
  const statuses = buildArchiveStatuses({
    rendered: { status: 'success' },
    readability: { status: 'success' },
    markdown: { status: 'success' },
    singlefile: { status: 'failed' },
  });

  const health = buildArticleHealth(statuses);
  assert.equal(health.completenessScore, 75);
  assert.deepEqual(health.missingCore, ['singlefile']);
  assert.equal(health.bestAvailableArchive, 'markdown');
  assert.equal(health.recommendedAction, 'retry_missing');
});

test('legacy archive keys map to canonical readability/markdown statuses', () => {
  const statuses = buildArchiveStatuses({
    rendered: { status: 'success' },
    readability_json: { status: 'success' },
    readability_md: { status: 'success' },
    singlefile: { status: 'success' },
  });

  const byKey = new Map(statuses.map((s) => [s.key, s.status]));
  assert.equal(byKey.get('readability'), 'success');
  assert.equal(byKey.get('markdown'), 'success');

  const classification = classifyArchiveStatus({
    status: 'processing',
    archives: {
      rendered: { status: 'success' },
      readability_json: { status: 'success' },
      readability_md: { status: 'success' },
      singlefile: { status: 'success' },
    },
  });
  assert.equal(classification, 'complete');
});
