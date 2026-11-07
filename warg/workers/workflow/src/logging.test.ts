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
});
