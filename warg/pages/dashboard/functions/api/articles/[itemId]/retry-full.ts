import {
  type ActionEnv,
  bootstrapArticle,
  errorResponse,
  fetchArticleDetail,
  jsonResponse,
  markArticleProcessing,
  submitBegin
} from '../../../lib/article-actions.js';

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{8,40}$/;

export const onRequestPost: PagesFunction<ActionEnv> = async (context) => {
  const itemId = context.params.itemId;
  if (!itemId || typeof itemId !== 'string') {
    return jsonResponse({ error: 'Missing itemId' }, 400);
  }

  try {
    const detail = await fetchArticleDetail(context.env, itemId);
    const bootstrap = await bootstrapArticle(context.env, itemId);
    const canonicalItemId = bootstrap.canonicalItemId || itemId;
    const shouldStart = bootstrap.shouldStart !== false;

    if (!shouldStart) {
      const reusedRequestId =
        bootstrap.existingRequestId && SAFE_ID_RE.test(bootstrap.existingRequestId)
          ? bootstrap.existingRequestId
          : canonicalItemId;
      return jsonResponse({
        requestId: reusedRequestId,
        canonicalItemId,
        submitted: false,
        reused: true,
        reason: 'Linked to existing canonical article; no re-archive needed.',
      });
    }

    const requestId = SAFE_ID_RE.test(canonicalItemId)
      ? canonicalItemId
      : (detail.warg_request_id ?? itemId);
    const result = await submitBegin(context.env, {
      url: detail.url,
      request_id: requestId,
    });
    const submittedRequestId = result.requestId ?? result.request_id ?? requestId;
    let warning: string | undefined;
    try {
      await markArticleProcessing(context.env, itemId, submittedRequestId);
    } catch (err) {
      warning =
        err instanceof Error
          ? err.message
          : 'Started archive but failed to mark processing state';
    }
    return jsonResponse({
      requestId: submittedRequestId,
      canonicalItemId,
      submitted: true,
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    return errorResponse(err);
  }
};
