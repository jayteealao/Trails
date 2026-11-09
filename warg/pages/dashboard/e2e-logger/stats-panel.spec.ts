import { expect, test } from '@playwright/test';

// The operator opens the overview and reads the stats panel. The dashboard
// runs against the real logger over the rows of seed.sql, so the numbers
// below are the counts of that seed. They must also equal what /api/stats
// returns, so the panel shows the logger's figures unchanged.

interface Stats {
  total: number;
  successRate: number;
  activeCount: number;
  stuckCount: number;
  byStage: Record<string, number>;
  recentActivity: { last1h: number; last24h: number };
  topDomains: { domain: string; count: number }[];
  recentFailures: { requestId: string }[];
}

const SEEDED = {
  total: '11',
  successRate: '66.7%',
  active: '2',
  stuck: '1',
  last1h: '5',
  last24h: '9',
  legend: ['done 6 (54.5%)', 'failed 3 (27.3%)', 'queued 1 (9.1%)', 'rendering 1 (9.1%)'],
  topDomains: [
    ['alpha.test', '5'],
    ['beta.test', '3'],
    ['gamma.test', '2'],
    ['delta.test', '1'],
  ],
  recentFailures: ['e2e-fail-1', 'e2e-fail-3', 'e2e-fail-2'],
};

test('the stats panel shows the counts of the logger index', async ({ page }) => {
  const statsResponse = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/stats');
  await page.goto('/');
  await page.locator('.nav-item[data-view="overview"]').click();
  expect((await statsResponse).status()).toBe(200);
  await expect(page.locator('#statTotal')).not.toHaveText('--');

  await expect(page.locator('#statTotal')).toHaveText(SEEDED.total);
  await expect(page.locator('#statSuccessRate')).toHaveText(SEEDED.successRate);
  await expect(page.locator('#statActive')).toHaveText(SEEDED.active);
  await expect(page.locator('#statStuck')).toHaveText(SEEDED.stuck);
  await expect(page.locator('#statLast1h')).toHaveText(SEEDED.last1h);
  await expect(page.locator('#statLast24h')).toHaveText(SEEDED.last24h);
  for (const item of SEEDED.legend) {
    await expect(page.locator('#segmentedLegend .legend-item', { hasText: item })).toHaveCount(1);
  }
  const domainRows = page.locator('#topDomains tbody tr');
  await expect(domainRows).toHaveCount(SEEDED.topDomains.length);
  for (const [i, [domain, count]] of SEEDED.topDomains.entries()) {
    await expect(domainRows.nth(i).locator('td')).toHaveText([domain, count]);
  }
  const failureRows = page.locator('#recentFailures tbody tr');
  await expect(failureRows).toHaveCount(SEEDED.recentFailures.length);
  for (const [i, id] of SEEDED.recentFailures.entries()) {
    await expect(failureRows.nth(i)).toHaveAttribute('data-id', id);
  }

  // The same figures come back from the stats API the panel reads.
  const res = await page.request.get('/api/stats');
  expect(res.status()).toBe(200);
  const stats: Stats = await res.json();
  expect(String(stats.total)).toBe(SEEDED.total);
  expect((stats.successRate * 100).toFixed(1) + '%').toBe(SEEDED.successRate);
  expect(String(stats.activeCount)).toBe(SEEDED.active);
  expect(String(stats.stuckCount)).toBe(SEEDED.stuck);
  expect(String(stats.recentActivity.last1h)).toBe(SEEDED.last1h);
  expect(String(stats.recentActivity.last24h)).toBe(SEEDED.last24h);
  expect(stats.byStage).toEqual({ done: 6, failed: 3, queued: 1, rendering: 1 });
  expect(stats.topDomains.map((d) => [d.domain, String(d.count)])).toEqual(SEEDED.topDomains);
  expect(stats.recentFailures.map((f) => f.requestId)).toEqual(SEEDED.recentFailures);
});
