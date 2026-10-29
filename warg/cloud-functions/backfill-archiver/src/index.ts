import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineInt, defineString } from 'firebase-functions/params';
import { callGatewayBegin } from './gateway-client.js';
import { TRACKER_DOC_PATH, runBackfill } from './scheduler.js';
import {
  CF_ACCESS_CLIENT_ID,
  CF_ACCESS_CLIENT_SECRET,
  PUBLIC_API_KEY,
  gatewayBeginConfig,
  getBackfillUserId,
  statusKeyMatches,
  statusSecrets,
} from './secrets.js';
import { normalizeTracker } from './tracker.js';

export { articleStatusDerive } from './article-status-trigger.js';

if (getApps().length === 0) {
  initializeApp();
}

const GATEWAY_URL = defineString('GATEWAY_URL', {
  default: 'https://gateway.jayteealao.workers.dev',
});
// Workstream C1 (archive-completion-rootcause.md): smaller batches + longer
// stagger reduce BrowserQuotaDO contention so render/singlefile starts don't
// queue past the stuck timeout. 12 items × 4s stagger ≈ 48s, well under the
// 540s function budget.
const BATCH_SIZE = defineInt('BACKFILL_BATCH_SIZE', { default: 12 });
const SCAN_PAGE_SIZE = defineInt('BACKFILL_SCAN_PAGE_SIZE', { default: 250 });
// The backfill makes one full pass per label, then scans only changed articles.
const BACKFILL_PASS_LABEL = defineString('BACKFILL_PASS_LABEL', {
  default: '1',
  description: 'Change to start one new full backfill pass',
});

export const backfillArchiver = onSchedule(
  {
    schedule: 'every 10 minutes',
    timeZone: 'UTC',
    retryCount: 0,
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [PUBLIC_API_KEY, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET],
  },
  async () => {
    await runBackfill({
      db: getFirestore(),
      userId: getBackfillUserId(),
      batchSize: BATCH_SIZE.value(),
      scanPageSize: Math.max(BATCH_SIZE.value(), SCAN_PAGE_SIZE.value()),
      passLabel: BACKFILL_PASS_LABEL.value(),
      beginArchive: (payload) =>
        callGatewayBegin(gatewayBeginConfig(GATEWAY_URL.value()), { ...payload }),
    });
  }
);

export const backfillStatus = onRequest(
  // The old shared key is bound only while the key-rotation switch is on.
  { cors: true, memory: '512MiB', secrets: statusSecrets() },
  async (req, res) => {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const apiKey = req.headers['x-internal-api-key'];
    const providedApiKey =
      typeof apiKey === 'string' ? apiKey : Array.isArray(apiKey) ? apiKey[0] : null;

    if (!statusKeyMatches(providedApiKey)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const db = getFirestore();
    const trackerSnap = await db.doc(TRACKER_DOC_PATH).get();
    const tracker = normalizeTracker(trackerSnap.exists ? trackerSnap.data() : undefined);

    if (!trackerSnap.exists) {
      res.json({ status: 'not_initialized', tracker: null });
      return;
    }

    const includeAbandoned = req.query['include_abandoned'] === '1';
    if (!includeAbandoned) {
      res.json({ status: 'ok', tracker });
      return;
    }

    const limitRaw = Number(req.query['limit']);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 100;

    const abandonedSnap = await db
      .collection('articles')
      .where('status', '==', 'abandoned')
      .limit(limit)
      .get();

    const classBreakdown: Record<string, number> = {};
    const items: Array<{
      item_id: string;
      url?: string;
      domain?: string;
      class?: string;
      last_error_message?: string;
      retry_count?: number;
      failed_at?: string;
    }> = [];

    for (const doc of abandonedSnap.docs) {
      const data = doc.data();
      const failure = (data['failure'] as Record<string, unknown> | undefined) ?? {};
      const cls = typeof failure['class'] === 'string' ? failure['class'] : 'UNKNOWN';
      classBreakdown[cls] = (classBreakdown[cls] ?? 0) + 1;
      const failedAt = data['failed_at'];
      items.push({
        item_id: doc.id,
        ...(typeof data['url'] === 'string' ? { url: data['url'] } : {}),
        ...(typeof data['domain'] === 'string' ? { domain: data['domain'] } : {}),
        ...(typeof cls === 'string' ? { class: cls } : {}),
        ...(typeof failure['last_error_message'] === 'string'
          ? { last_error_message: failure['last_error_message'] as string }
          : {}),
        ...(typeof data['retry_count'] === 'number'
          ? { retry_count: data['retry_count'] }
          : {}),
        ...(failedAt && typeof failedAt === 'object' &&
          typeof (failedAt as { toDate?: unknown }).toDate === 'function'
            ? { failed_at: (failedAt as { toDate: () => Date }).toDate().toISOString() }
            : {}),
      });
    }

    res.json({
      status: 'ok',
      tracker,
      abandoned: {
        sampled: items.length,
        limit,
        class_breakdown: classBreakdown,
        items,
      },
    });
  }
);
