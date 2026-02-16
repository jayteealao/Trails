import {
  type ActionEnv,
  bootstrapArticle,
  enqueueArticle,
  errorResponse,
  jsonResponse,
  markArticleProcessing,
  submitBegin,
} from '../lib/article-actions.js';

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{8,40}$/;

/**
 * POST /api/begin
 *
 * - No request_id: enqueue user article and let onUserArticleSave trigger the pipeline.
 * - With request_id: bootstrap canonical doc, call gateway /begin, then mark processing.
 */
export const onRequestPost: PagesFunction<ActionEnv> = async (context) => {
  const { env, request } = context;

  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return jsonResponse({ error: 'Invalid request payload' }, 400);
    }

    const payload = rawBody as Record<string, unknown>;
    const url = typeof payload.url === 'string' ? payload.url.trim() : '';
    if (!url) {
      return jsonResponse({ error: 'url is required' }, 400);
    }
    payload.url = url;

    const requestId =
      typeof payload.request_id === 'string' && payload.request_id.trim().length > 0
        ? payload.request_id.trim()
        : undefined;

    // Top-bar URL submit path: create user article and let onUserArticleSave do setup.
    if (!requestId) {
      const enqueue = await enqueueArticle(env, { url });
      return jsonResponse({
        requestId: enqueue.itemId,
        itemId: enqueue.itemId,
        queued: true,
        started: false,
        existed: enqueue.existed ?? false,
      });
    }

    const bootstrap = await bootstrapArticle(env, requestId);
    const canonicalItemId = bootstrap.canonicalItemId || requestId;
    const shouldStart = bootstrap.shouldStart !== false;

    if (!shouldStart) {
      const reusedRequestId =
        bootstrap.existingRequestId && SAFE_ID_RE.test(bootstrap.existingRequestId)
          ? bootstrap.existingRequestId
          : canonicalItemId;
      return jsonResponse({
        requestId: reusedRequestId,
        itemId: requestId,
        canonicalItemId,
        queued: false,
        started: false,
        reused: true,
        linkedExisting: bootstrap.linkedExisting ?? false,
      });
    }

    const effectiveRequestId = SAFE_ID_RE.test(canonicalItemId)
      ? canonicalItemId
      : requestId;
    payload.request_id = effectiveRequestId;

    const gatewayResult = await submitBegin(env, payload);
    const startedRequestId =
      gatewayResult.requestId ?? gatewayResult.request_id ?? effectiveRequestId;

    let warning: string | undefined;
    try {
      await markArticleProcessing(env, requestId, startedRequestId);
    } catch (err) {
      warning =
        err instanceof Error
          ? err.message
          : 'Gateway started, but failed to mark article as processing';
    }

    return jsonResponse({
      requestId: startedRequestId,
      itemId: requestId,
      canonicalItemId,
      queued: false,
      started: true,
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    return errorResponse(err);
  }
};
