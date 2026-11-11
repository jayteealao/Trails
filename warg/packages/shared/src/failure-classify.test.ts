import { describe, expect, it } from 'vitest';
import { REQUEST_ERROR_CODES } from './dashboard.js';
import type { RequestErrorCode, UserActionHint } from './dashboard.js';
import { PROXY_ERROR_PAGE_REASON } from './render-content.js';
import {
  classifyError,
  classifySandboxOutput,
  classifyServiceFailure,
  classifyServiceTimeout,
  defaultActionForCode,
  defaultRetryableForCode,
  inferLegacyErrorCode,
  isRpc32MiBLimit,
  readClassificationTag,
  rendererFallbackReasonFromBody,
  withClassificationTag,
} from './failure-classify.js';
import type { ErrorClassification } from './failure-classify.js';

function c(errorCode: RequestErrorCode, retryable: boolean, recommendedAction: UserActionHint): ErrorClassification {
  return { errorCode, retryable, recommendedAction };
}

/** A renderer answer that wraps a failed Browser Rendering load. */
function wrappedContentFailure(details: string, status = 500): string {
  return JSON.stringify({ error: 'Browser Rendering /content failed', status, details });
}

const renderProxyErrorPage = {
  error: 'Browser Rendering /content returned a proxy/network error page',
  reason: PROXY_ERROR_PAGE_REASON,
  detail: 'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host',
  url: 'https://www.explorminate.net/post',
};

const singlefileProxyErrorPage = {
  error: 'SingleFile capture returned a proxy/network error page',
  reason: PROXY_ERROR_PAGE_REASON,
  detail: 'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host',
  url: 'https://www.explorminate.net/post',
};

const UNREACHABLE_RENDER = c('RENDER_SERVICE_ERROR', false, 'inspect_url');

// --- (a) the RPC size-limit text ------------------------------------------------

describe('isRpc32MiBLimit', () => {
  it('matches the live readFile overflow message', () => {
    expect(
      isRpc32MiBLimit(
        'Serialized RPC arguments or return values are limited to 32MiB, but the size of this value was: 34196415 bytes.'
      )
    ).toBe(true);
  });

  it('matches the raw byte ceiling and capnp phrasings', () => {
    expect(isRpc32MiBLimit('value was 33554432 bytes')).toBe(true);
    expect(isRpc32MiBLimit('Message length too big')).toBe(true);
    expect(isRpc32MiBLimit('exceeded max allowed message length')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isRpc32MiBLimit('LIMITED TO 32MIB')).toBe(true);
  });

  it('does not match unrelated sandbox errors', () => {
    expect(isRpc32MiBLimit('SandboxError: HTTP error! status: 500')).toBe(false);
    expect(isRpc32MiBLimit('connection timed out')).toBe(false);
    expect(isRpc32MiBLimit('')).toBe(false);
  });
});

// --- (b) the classification tag ------------------------------------------------

const unreachable = {
  errorCode: 'RENDER_SERVICE_ERROR',
  retryable: false,
  recommendedAction: 'inspect_url',
} as const;

describe('classification tag', () => {
  it('reads back the classification written into a message', () => {
    const message = withClassificationTag('Service error 502: dial tcp: no such host', unreachable);
    expect(readClassificationTag(message)).toEqual(unreachable);
  });

  it('reads the tag inside a message wrapped by later text', () => {
    const message = `Step failed: render: ${withClassificationTag('boom', unreachable)} (attempt 1)`;
    expect(readClassificationTag(message)).toEqual(unreachable);
  });

  it('finds nothing in an untagged message or a tag with an unknown code', () => {
    expect(readClassificationTag('Service error 503: Service Unavailable')).toBeUndefined();
    expect(readClassificationTag('x [classified NOT_A_CODE final inspect_url]')).toBeUndefined();
  });
});

describe('classifyError on a tagged step failure', () => {
  it('keeps the classification of the step over the text rules', () => {
    // The text alone reads as a retryable network close; the step judged it final.
    const message = withClassificationTag('Service error 502: network closed 5006', unreachable);
    expect(classifyError('render', message)).toEqual(unreachable);
  });
});

// --- (c) the step-message classifier -------------------------------------------

describe('classifyError', () => {
  it('gives an AI Markdown step failure its own codes, so its failures group apart', () => {
    expect(classifyError('ai-markdown', 'The operation timed out').errorCode).toBe('AI_MARKDOWN_TIMEOUT');
    expect(classifyError('ai-markdown', 'Service error 503: Workers AI').errorCode).toBe('AI_MARKDOWN_SERVICE_ERROR');
  });

  it('classifies monolith timeout signatures on request-level errors', () => {
    const classified = classifyError(
      'request',
      'ServiceCallError: Service timeout calling /monolith'
    );

    expect(classified.errorCode).toBe('MONOLITH_TIMEOUT');
    expect(classified.retryable).toBe(true);
    expect(classified.recommendedAction).toBe('retry_step');
  });

  it('classifies monolith sandbox 500 signatures on request-level errors', () => {
    const classified = classifyError(
      'request',
      'ServiceCallError: Service error 500: {"error":"Internal error","message":"SandboxError: HTTP error! status: 500"}'
    );

    expect(classified.errorCode).toBe('MONOLITH_SANDBOX_500');
    expect(classified.retryable).toBe(true);
    expect(classified.recommendedAction).toBe('retry_step');
  });

  it('classifies no-output terminal failures for full retries', () => {
    const classified = classifyError(
      'request',
      'No requested outputs were produced (requested: render, singlefile, readability, monolith)'
    );

    expect(classified.errorCode).toBe('NO_OUTPUTS_PRODUCED');
    expect(classified.retryable).toBe(true);
    expect(classified.recommendedAction).toBe('retry_full');
  });

  it('classifies renderer network-closed signatures', () => {
    const classified = classifyError(
      'request',
      'ServiceCallError: Service error 502: {"error":"Browser Rendering /content failed","status":422,"details":"{\\"errors\\":[{\\"code\\":5006,\\"message\\":\\"network closed\\"}]}"}'
    );

    expect(classified.errorCode).toBe('RENDER_NETWORK_CLOSED');
    expect(classified.retryable).toBe(true);
    expect(classified.recommendedAction).toBe('retry_full');
  });
});

describe('classifyError for a proxy error page', () => {
  it('labels the singlefile rejection as not retryable', () => {
    const classified = classifyError(
      'singlefile',
      'Service error 502: {"error":"SingleFile capture returned a proxy/network error page","reason":"proxy_error_page","detail":"dial tcp: lookup x on 1.1.1.1:53: no such host","url":"https://x"}'
    );

    expect(classified).toEqual({
      errorCode: 'SINGLEFILE_SERVICE_ERROR',
      retryable: false,
      recommendedAction: 'inspect_url',
    });
  });

  it('labels the renderer rejection as not retryable', () => {
    const classified = classifyError(
      'render',
      'Service error 502: {"error":"Browser Rendering /content returned a proxy/network error page","reason":"proxy_error_page","detail":"dial tcp: lookup x on 1.1.1.1:53: no such host","url":"https://x"}'
    );

    expect(classified).toEqual({
      errorCode: 'RENDER_SERVICE_ERROR',
      retryable: false,
      recommendedAction: 'inspect_url',
    });
  });

  it('keeps a timed-out proxy error page retryable', () => {
    const classified = classifyError(
      'render',
      'Service error 502: {"error":"Browser Rendering /content returned a proxy/network error page","reason":"proxy_error_page","detail":"dial tcp 1.2.3.4:443: i/o timeout","url":"https://x"}'
    );

    expect(classified.retryable).toBe(true);
  });

  it('keeps a plain singlefile service error retryable', () => {
    const classified = classifyError('singlefile', 'Service error 503: Service Unavailable');

    expect(classified.errorCode).toBe('SINGLEFILE_SERVICE_ERROR');
    expect(classified.retryable).toBe(true);
  });
});

describe('classifyError rule by rule', () => {
  it.each([
    ['a monolith 32 MiB limit', 'request', 'Service error 500 calling /monolith: message length too big', c('MONOLITH_RPC_32MIB_LIMIT', false, 'investigate_service')],
    ['a monolith input that is too large', 'monolith', 'Monolith input too large: 40000000 bytes', c('MONOLITH_INPUT_TOO_LARGE', false, 'investigate_service')],
    ['a monolith service error', 'monolith', 'monolith Service error 502: bad gateway', c('MONOLITH_SERVICE_ERROR', true, 'retry_step')],
    ['a missing rendered.html', 'readability', 'Missing rendered.html prerequisite', c('RENDER_PREREQ_MISSING', true, 'retry_full')],
    ['a destroyed page context (6000)', 'render', 'Execution context was destroyed', c('RENDER_CONTEXT_DESTROYED', true, 'retry_full')],
    ['a singlefile edge case', 'singlefile', 'trustedTypes is not defined', c('SINGLEFILE_EDGE_CASE', true, 'retry_step')],
    ['a render timeout', 'render', 'request timed out', c('RENDER_TIMEOUT', true, 'retry_full')],
    ['a singlefile timeout', 'singlefile', 'request timed out', c('SINGLEFILE_TIMEOUT', true, 'retry_step')],
    ['a readability timeout', 'readability', 'request timed out', c('READABILITY_TIMEOUT', true, 'retry_step')],
    ['a monolith-step timeout', 'monolith', 'request timed out', c('MONOLITH_TIMEOUT', true, 'retry_step')],
    ['a timeout of another step', 'persist', 'request timed out', c('UNKNOWN_ERROR', true, 'retry_step')],
    ['a render service error', 'render', 'Service error 503: Service Unavailable', c('RENDER_SERVICE_ERROR', true, 'retry_step')],
    ['a readability service error', 'readability', 'Service error 503: Service Unavailable', c('READABILITY_SERVICE_ERROR', true, 'retry_step')],
    ['a monolith-step service error', 'monolith', 'Service error 503: Service Unavailable', c('MONOLITH_SERVICE_ERROR', true, 'retry_step')],
    ['a persist service error', 'persist', 'Service error 503: Service Unavailable', c('PERSIST_SERVICE_ERROR', true, 'investigate_service')],
    ['a derivatives service error', 'derivatives', 'Service error 503: Service Unavailable', c('MONOLITH_SERVICE_ERROR', true, 'retry_step')],
    ['a service error of another step', 'gcs', 'Service error 503: Service Unavailable', c('UNKNOWN_ERROR', true, 'retry_step')],
    ['an unauthorized answer', 'render', 'Unauthorized', c('ACCESS_BLOCKED', false, 'check_access')],
    ['an invalid url', 'request', 'Invalid url: ftp://x', c('INVALID_INPUT_URL', false, 'inspect_url')],
    ['anything else', 'request', 'something odd', c('UNKNOWN_ERROR', true, 'investigate_service')],
  ])('classifies %s', (_name, step, message, expected) => {
    expect(classifyError(step, message)).toEqual(expected);
  });
});

// --- (d) the service-answer classifier -----------------------------------------

describe('classifyServiceFailure', () => {
  it.each([
    // monolith service classification
    ['/monolith', 500, JSON.stringify({ error: 'Internal error', message: 'SandboxError: timeout waiting for output' }), c('MONOLITH_TIMEOUT', true, 'retry_step')],
    ['/monolith', 500, JSON.stringify({ error: 'Internal error', message: 'SandboxError: HTTP error! status: 500' }), c('MONOLITH_SANDBOX_500', true, 'retry_step')],
    ['/monolith', 500, JSON.stringify({ error: 'Internal error', message: 'Message length too big: found 33640795 bytes, the max allowed message length is 33554432 bytes' }), c('MONOLITH_RPC_32MIB_LIMIT', false, 'investigate_service')],
    ['/monolith', 500, JSON.stringify({ error: 'Internal error', message: 'Monolith input too large: 40000000 bytes' }), c('MONOLITH_INPUT_TOO_LARGE', false, 'investigate_service')],
    // render failures that stay retryable
    ['/render', 503, 'Service Unavailable', c('RENDER_SERVICE_ERROR', true, 'retry_step')],
    ['/render', 502, JSON.stringify({ error: 'upstream failed' }), c('RENDER_SERVICE_ERROR', true, 'retry_step')],
    ['/render', 429, 'Too Many Requests', c('RENDER_SERVICE_ERROR', true, 'retry_step')],
    ['/render', 502, wrappedContentFailure('{"errors":[{"code":5006,"message":"network closed"}]}'), c('RENDER_NETWORK_CLOSED', true, 'retry_full')],
    ['/render', 502, wrappedContentFailure('{"errors":[{"code":6000}]}'), c('RENDER_CONTEXT_DESTROYED', true, 'retry_full')],
    ['/render', 502, wrappedContentFailure('dial tcp 1.2.3.4:443: i/o timeout'), c('RENDER_SERVICE_ERROR', true, 'retry_step')],
    ['/render', 502, wrappedContentFailure('net::ERR_TIMED_OUT at https://example.com/article'), c('RENDER_SERVICE_ERROR', true, 'retry_step')],
    // access-blocked render failures
    ['/render', 502, wrappedContentFailure('forbidden', 403), c('ACCESS_BLOCKED', false, 'check_access')],
    ['/render', 403, 'Forbidden', c('ACCESS_BLOCKED', false, 'check_access')],
    // render failures from a host that cannot be reached
    ['/render', 502, JSON.stringify(renderProxyErrorPage), UNREACHABLE_RENDER],
    ['/render', 502, JSON.stringify({ ...renderProxyErrorPage, detail: 'dial tcp 1.2.3.4:443: i/o timeout' }), c('RENDER_SERVICE_ERROR', true, 'retry_step')],
    ['/render', 502, JSON.stringify({ ...renderProxyErrorPage, detail: 'read tcp 10.0.0.1:5000->1.2.3.4:443: connection reset by peer' }), c('RENDER_SERVICE_ERROR', true, 'retry_step')],
    ['/render', 502, wrappedContentFailure('dial tcp 1.2.3.4:443: some new failure'), c('RENDER_SERVICE_ERROR', true, 'retry_step')],
    ['/render', 502, wrappedContentFailure('dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host'), UNREACHABLE_RENDER],
    ['/render', 502, wrappedContentFailure('net::ERR_NAME_NOT_RESOLVED at https://www.explorminate.net/post'), UNREACHABLE_RENDER],
    ['/render', 502, wrappedContentFailure('net::ERR_CONNECTION_REFUSED at https://www.explorminate.net/post'), UNREACHABLE_RENDER],
    ['/render', 502, wrappedContentFailure('dial tcp 1.2.3.4:443: connect: connection refused'), UNREACHABLE_RENDER],
    // singlefile proxy error page rejections
    ['/singlefile', 502, JSON.stringify(singlefileProxyErrorPage), c('SINGLEFILE_SERVICE_ERROR', false, 'inspect_url')],
    ['/singlefile', 502, JSON.stringify({ ...singlefileProxyErrorPage, detail: 'dial tcp 1.2.3.4:443: i/o timeout' }), c('SINGLEFILE_SERVICE_ERROR', true, 'retry_step')],
    // singlefile failures that keep retrying
    ['/singlefile', 503, 'Service Unavailable', c('SINGLEFILE_SERVICE_ERROR', true, 'retry_step')],
    ['/singlefile', 422, JSON.stringify({ error: 'SingleFile edge-case failure', details: 'trustedTypes is not defined', recoverable: true }), c('SINGLEFILE_EDGE_CASE', true, 'retry_step')],
    ['/singlefile', 502, JSON.stringify({ error: 'SingleFile capture failed: content too short', length: 12 }), c('SINGLEFILE_SERVICE_ERROR', true, 'retry_step')],
    // the status rule
    ['/readability', 401, 'Unauthorized', c('ACCESS_BLOCKED', false, 'check_access')],
    ['/monolith', 403, JSON.stringify({ message: 'SandboxError: timeout' }), c('ACCESS_BLOCKED', false, 'check_access')],
    ['/readability', 429, 'Too Many Requests', c('READABILITY_SERVICE_ERROR', true, 'retry_step')],
    ['/readability', 404, 'Not found', c('READABILITY_SERVICE_ERROR', false, 'investigate_service')],
    ['/persist', 500, 'Internal error', c('PERSIST_SERVICE_ERROR', true, 'retry_step')],
    ['/other', 500, 'Internal error', c('UNKNOWN_ERROR', true, 'retry_step')],
  ])('classifies %s %i %s', (path, status, body, expected) => {
    expect(classifyServiceFailure(path, status, body)).toEqual(expected);
  });
});

describe('classifyServiceTimeout', () => {
  it.each([
    ['/render', 'RENDER_TIMEOUT'],
    ['/singlefile', 'SINGLEFILE_TIMEOUT'],
    ['/readability', 'READABILITY_TIMEOUT'],
    ['/monolith', 'MONOLITH_TIMEOUT'],
    ['/persist', 'UNKNOWN_ERROR'],
  ] as const)('classifies a timeout calling %s as %s, retryable', (path, errorCode) => {
    expect(classifyServiceTimeout(path)).toEqual(c(errorCode, true, 'retry_step'));
  });
});

// --- (e) the renderer fallback reason ------------------------------------------

describe('rendererFallbackReasonFromBody', () => {
  it.each([
    ['a wrapped 403', wrappedContentFailure('forbidden', 403), 'browser_rendering_403'],
    ['a wrapped 5006', wrappedContentFailure('{"errors":[{"code":5006}]}'), 'browser_rendering_5006'],
    ['a wrapped 6000', wrappedContentFailure('{"errors":[{"code":6000}]}'), 'browser_rendering_6000'],
    ['a dead host', wrappedContentFailure('dial tcp: lookup x on 1.1.1.1:53: no such host'), 'browser_rendering_dead_host'],
    ['a proxy error page', JSON.stringify(renderProxyErrorPage), 'browser_rendering_proxy_error_page'],
    ['a timed-out dial', wrappedContentFailure('dial tcp 1.2.3.4:443: i/o timeout'), undefined],
    ['a body that is not a Browser Rendering failure', JSON.stringify({ error: 'upstream failed' }), undefined],
    ['a body that is not JSON', 'Service Unavailable', undefined],
  ])('reads %s', (_name, body, expected) => {
    expect(rendererFallbackReasonFromBody(body)).toBe(expected);
  });
});

// --- (f) the sandbox output classifier -----------------------------------------

describe('a monolith container that is not ready', () => {
  const body = JSON.stringify({
    error: 'Internal error',
    message: 'Sandbox container not ready (retry after 3000 ms)',
    code: 'MONOLITH_CONTAINER_UNAVAILABLE',
    retryable: true,
  });

  it('is classified under its own code, worth a retry', () => {
    expect(classifyServiceFailure('/monolith', 503, body)).toEqual({
      errorCode: 'MONOLITH_CONTAINER_UNAVAILABLE',
      retryable: true,
      recommendedAction: 'retry_step',
    });
    expect(classifyError('monolith', `Service error 503: ${body}`).errorCode).toBe(
      'MONOLITH_CONTAINER_UNAVAILABLE'
    );
  });
});

describe('classifySandboxOutput', () => {
  it.each([
    ['Serialized RPC arguments are limited to 32MiB', '', { errorCode: 'MONOLITH_RPC_32MIB_LIMIT', retryable: false }],
    ['deadline exceeded', '', { errorCode: 'MONOLITH_TIMEOUT', retryable: true }],
    ['', 'monolith timed out', { errorCode: 'MONOLITH_TIMEOUT', retryable: true }],
    // The sandbox has no `abort` timeout word, unlike the service and message rules.
    ['request aborted', '', { errorCode: 'MONOLITH_SANDBOX_500', retryable: true }],
    ['boom', '', { errorCode: 'MONOLITH_SANDBOX_500', retryable: true }],
    [
      'curl: (22) The requested URL returned error: 403',
      '',
      { errorCode: 'MONOLITH_R2_HANDLER_FAILED', retryable: false, handlerStatus: 403 },
    ],
    [
      'curl: (22) The requested URL returned error: 502',
      '',
      { errorCode: 'MONOLITH_R2_HANDLER_FAILED', retryable: true, handlerStatus: 502 },
    ],
  ])('classifies stderr %j stdout %j', (stderr, stdout, expected) => {
    expect(classifySandboxOutput(stderr, stdout)).toEqual(expected);
  });
});

describe('a failed R2 handler answer of the monolith Worker', () => {
  const body = (retryable: boolean) =>
    JSON.stringify({
      error: 'Internal error',
      message: 'R2 handler answered 403: curl: (22) The requested URL returned error: 403',
      code: 'MONOLITH_R2_HANDLER_FAILED',
      retryable,
    });

  it('keeps the code and the retry judgement of the answer', () => {
    expect(classifyServiceFailure('/monolith', 502, body(false))).toEqual({
      errorCode: 'MONOLITH_R2_HANDLER_FAILED',
      retryable: false,
      recommendedAction: 'investigate_service',
    });
    expect(classifyServiceFailure('/monolith', 502, body(true))).toEqual({
      errorCode: 'MONOLITH_R2_HANDLER_FAILED',
      retryable: true,
      recommendedAction: 'retry_step',
    });
  });

  it('reads the code from the step failure message', () => {
    expect(classifyError('monolith', `Service error 502: ${body(true)}`).errorCode).toBe(
      'MONOLITH_R2_HANDLER_FAILED'
    );
  });
});

// --- (g) the logger's legacy inference -----------------------------------------

describe('inferLegacyErrorCode', () => {
  it.each([
    ['Invalid url', undefined, 'INVALID_INPUT_URL'],
    ['base_url contains invalid characters', undefined, 'INVALID_INPUT_URL'],
    ['Workflow trigger failed: boom', undefined, 'WORKFLOW_TRIGGER_FAILED'],
    ['No requested outputs were produced', undefined, 'NO_OUTPUTS_PRODUCED'],
    ['Forbidden', undefined, 'ACCESS_BLOCKED'],
    ['Missing rendered.html prerequisite', undefined, 'RENDER_PREREQ_MISSING'],
    ['network closed', undefined, 'RENDER_NETWORK_CLOSED'],
    ['{"code":6000}', undefined, 'RENDER_CONTEXT_DESTROYED'],
    ['Service timeout calling /monolith', undefined, 'MONOLITH_TIMEOUT'],
    ['Service timeout calling /singlefile', undefined, 'SINGLEFILE_TIMEOUT'],
    ['readability deadline exceeded', undefined, 'READABILITY_TIMEOUT'],
    ['render aborted', undefined, 'RENDER_TIMEOUT'],
    ['Service error 500: limited to 32MiB', undefined, 'MONOLITH_RPC_32MIB_LIMIT'],
    ['Service error 500: Monolith input too large', undefined, 'MONOLITH_INPUT_TOO_LARGE'],
    ['SandboxError: HTTP error! status: 500', undefined, 'MONOLITH_SANDBOX_500'],
    ['Service error 502 calling /monolith', undefined, 'MONOLITH_SERVICE_ERROR'],
    ['Service error 502 calling /singlefile', undefined, 'SINGLEFILE_SERVICE_ERROR'],
    ['Service error 502 calling /readability', undefined, 'READABILITY_SERVICE_ERROR'],
    ['Internal error', 'gcs', 'PERSIST_SERVICE_ERROR'],
    ['Service error 502 calling /render', undefined, 'RENDER_SERVICE_ERROR'],
    ['Service error 500', undefined, 'UNKNOWN_ERROR'],
    ['singlefile trustedTypes is not defined', undefined, 'SINGLEFILE_EDGE_CASE'],
    ['something odd', undefined, 'UNKNOWN_ERROR'],
  ] as const)('infers %j (source %s) as %s', (message, source, expected) => {
    expect(inferLegacyErrorCode(message, source)).toBe(expected);
  });
});

describe('the default retry and action of each error code', () => {
  const expected: Record<RequestErrorCode, [boolean, UserActionHint]> = {
    INVALID_INPUT_URL: [false, 'inspect_url'],
    WORKFLOW_TRIGGER_FAILED: [true, 'retry_full'],
    NO_OUTPUTS_PRODUCED: [true, 'retry_full'],
    RENDER_TIMEOUT: [true, 'retry_step'],
    RENDER_SERVICE_ERROR: [true, 'retry_step'],
    RENDER_NETWORK_CLOSED: [true, 'retry_full'],
    RENDER_CONTEXT_DESTROYED: [true, 'retry_full'],
    RENDER_PREREQ_MISSING: [true, 'retry_full'],
    SINGLEFILE_TIMEOUT: [true, 'retry_step'],
    SINGLEFILE_SERVICE_ERROR: [true, 'retry_step'],
    SINGLEFILE_EDGE_CASE: [true, 'retry_step'],
    READABILITY_TIMEOUT: [true, 'retry_step'],
    READABILITY_SERVICE_ERROR: [true, 'retry_step'],
    MONOLITH_TIMEOUT: [true, 'retry_step'],
    MONOLITH_SERVICE_ERROR: [true, 'retry_step'],
    MONOLITH_SANDBOX_500: [true, 'retry_step'],
    MONOLITH_RPC_32MIB_LIMIT: [false, 'investigate_service'],
    MONOLITH_INPUT_TOO_LARGE: [false, 'investigate_service'],
    MONOLITH_R2_HANDLER_FAILED: [true, 'retry_step'],
    MONOLITH_CONTAINER_UNAVAILABLE: [true, 'retry_step'],
    PERSIST_SERVICE_ERROR: [true, 'investigate_service'],
    ACCESS_BLOCKED: [false, 'check_access'],
    R2_CREDENTIAL_INVALID: [false, 'check_api_key'],
    BROWSER_TOKEN_INVALID: [false, 'check_api_key'],
    UNKNOWN_ERROR: [true, 'investigate_service'],
    AI_MARKDOWN_TIMEOUT: [true, 'retry_step'],
    AI_MARKDOWN_SERVICE_ERROR: [true, 'retry_step'],
  };

  it.each(REQUEST_ERROR_CODES.map((code) => [code] as const))('gives %s its default', (code) => {
    const [retryable, action] = expected[code];
    expect(defaultRetryableForCode(code)).toBe(retryable);
    expect(defaultActionForCode(code)).toBe(action);
  });
});

// --- (h) the fixed classification rules ----------------------------------------

describe('fixed behaviour', () => {
  it('makes a dead-host proxy error page final with inspect_url', () => {
    expect(classifyServiceFailure('/render', 502, JSON.stringify(renderProxyErrorPage))).toEqual(UNREACHABLE_RENDER);
    expect(classifyServiceFailure('/singlefile', 502, JSON.stringify(singlefileProxyErrorPage))).toEqual(
      c('SINGLEFILE_SERVICE_ERROR', false, 'inspect_url')
    );
    expect(classifyError('render', `Service error 502: ${JSON.stringify(renderProxyErrorPage)}`)).toEqual(UNREACHABLE_RENDER);
  });

  it('makes dead-host render details final with inspect_url', () => {
    expect(classifyServiceFailure('/render', 502, wrappedContentFailure('net::ERR_NAME_NOT_RESOLVED at https://x'))).toEqual(
      UNREACHABLE_RENDER
    );
  });

  it('keeps a timed-out proxy error page or dial retryable', () => {
    const timedOut = JSON.stringify({ ...renderProxyErrorPage, detail: 'dial tcp 1.2.3.4:443: i/o timeout' });
    expect(classifyServiceFailure('/render', 502, timedOut).retryable).toBe(true);
    expect(classifyError('render', `Service error 502: ${timedOut}`).retryable).toBe(true);
    expect(classifyServiceFailure('/render', 502, wrappedContentFailure('dial tcp 1.2.3.4:443: i/o timeout')).retryable).toBe(true);
  });

  it('makes access-blocked final', () => {
    expect(classifyServiceFailure('/render', 502, wrappedContentFailure('forbidden', 403))).toEqual(
      c('ACCESS_BLOCKED', false, 'check_access')
    );
    expect(classifyError('render', 'Forbidden').retryable).toBe(false);
    expect(defaultRetryableForCode('ACCESS_BLOCKED')).toBe(false);
  });
});
