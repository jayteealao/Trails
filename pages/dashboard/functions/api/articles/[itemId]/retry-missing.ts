import {
  type ActionEnv,
  deriveMissingSteps,
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
    const steps = deriveMissingSteps(detail.archives ?? []);

    if (steps.length === 0) {
      return jsonResponse({
        requestId,
        submitted: false,
        reason: 'No missing or failed archive steps detected',
      });
    }

    const result = await submitBegin(context.env, {
      url: detail.url,
      request_id: requestId,
      steps,
    });
    const submittedRequestId = result.requestId ?? result.request_id ?? requestId;
    return jsonResponse({ requestId: submittedRequestId, submitted: true, steps });
  } catch (err) {
    return errorResponse(err);
  }
};
