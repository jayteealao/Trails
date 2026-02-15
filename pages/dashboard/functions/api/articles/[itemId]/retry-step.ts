import {
  type ActionEnv,
  errorResponse,
  fetchArticleDetail,
  jsonResponse,
  readStepFromRequest,
  submitBegin
} from '../../../lib/article-actions.js';

const VALID_STEPS = new Set(['render', 'singlefile', 'readability', 'monolith']);

export const onRequestPost: PagesFunction<ActionEnv> = async (context) => {
  const itemId = context.params.itemId;
  if (!itemId || typeof itemId !== 'string') {
    return jsonResponse({ error: 'Missing itemId' }, 400);
  }

  const step = await readStepFromRequest(context.request);
  if (!step || !VALID_STEPS.has(step)) {
    return jsonResponse({ error: 'Invalid or missing step' }, 400);
  }

  try {
    const detail = await fetchArticleDetail(context.env, itemId);
    const requestId = detail.warg_request_id ?? itemId;
    const result = await submitBegin(context.env, {
      url: detail.url,
      request_id: requestId,
      steps: [step],
    });
    const submittedRequestId = result.requestId ?? result.request_id ?? requestId;
    return jsonResponse({ requestId: submittedRequestId, submitted: true, steps: [step] });
  } catch (err) {
    return errorResponse(err);
  }
};
