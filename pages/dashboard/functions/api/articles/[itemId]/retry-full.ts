import {
  type ActionEnv,
  errorResponse,
  fetchArticleDetail,
  jsonResponse,
  submitBegin
} from '../../../lib/article-actions.js';

export const onRequestPost: PagesFunction<ActionEnv> = async (context) => {
  const itemId = context.params.itemId;
  if (!itemId || typeof itemId !== 'string') {
    return jsonResponse({ error: 'Missing itemId' }, 400);
  }

  try {
    const detail = await fetchArticleDetail(context.env, itemId);
    const requestId = detail.warg_request_id ?? itemId;
    const result = await submitBegin(context.env, {
      url: detail.url,
      request_id: requestId,
    });
    const submittedRequestId = result.requestId ?? result.request_id ?? requestId;
    return jsonResponse({ requestId: submittedRequestId, submitted: true });
  } catch (err) {
    return errorResponse(err);
  }
};
