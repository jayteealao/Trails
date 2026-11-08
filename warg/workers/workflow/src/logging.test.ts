import { describe, expect, it } from 'vitest';
import { classifyError } from './logging.js';

describe('classifyError', () => {
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
