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

  it.each([
    ['singlefile', 'Service error 403: {"reason":"access_blocked"}'],
    ['render', 'Service error 401: Unauthorized'],
  ])('classifies a %s worker that answers a site block as access blocked', (stepName, message) => {
    const classified = classifyError(stepName, message);

    expect(classified.errorCode).toBe('ACCESS_BLOCKED');
    expect(classified.retryable).toBe(false);
    expect(classified.recommendedAction).toBe('check_access');
  });

  it('still classifies another singlefile worker failure as a service error', () => {
    expect(classifyError('singlefile', 'Service error 500: x').errorCode).toBe('SINGLEFILE_SERVICE_ERROR');
  });

  it.each([
    [
      'render',
      'Service error 502: {"error":"Browser Rendering /content failed","status":401,"details":"...","reason":"browser_token_invalid"}',
      'BROWSER_TOKEN_INVALID',
    ],
    [
      'render',
      'Renderer failed with Browser Rendering fallback-eligible error and fallback failed. primary=Service error 502: {"error":"Browser Rendering /content failed","status":403,"reason":"browser_token_invalid"}; fallback=Service error 403: Forbidden',
      'BROWSER_TOKEN_INVALID',
    ],
    [
      'monolith',
      'Service error 502: {"error":"Internal error","message":"R2 rejected the storage credential of the presigned URL (HTTP 403)","code":"R2_CREDENTIAL_INVALID","retryable":false}',
      'R2_CREDENTIAL_INVALID',
    ],
    ['persist', 'put: SignatureDoesNotMatch (403)', 'R2_CREDENTIAL_INVALID'],
  ])('classifies a rejected credential in a %s failure under its own code', (stepName, message, code) => {
    const classified = classifyError(stepName, message);

    expect(classified.errorCode).toBe(code);
    expect(classified.retryable).toBe(false);
    expect(classified.recommendedAction).toBe('check_api_key');
  });

  it.each([
    ['render', 'Service error 502: {"error":"Browser Rendering /content failed","status":403,"details":"x"}', 'RENDER_SERVICE_ERROR'],
    ['singlefile', 'Service error 403: {"reason":"access_blocked"}', 'ACCESS_BLOCKED'],
    ['monolith', 'Service error 500: {"code":"MONOLITH_SANDBOX_500"}', 'MONOLITH_SERVICE_ERROR'],
  ])('keeps the code of a %s failure that names no credential', (stepName, message, code) => {
    expect(classifyError(stepName, message).errorCode).toBe(code);
  });
});
