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

    expect(classified.errorCode).toBe('MONOLITH_SERVICE_ERROR');
    expect(classified.retryable).toBe(true);
    expect(classified.recommendedAction).toBe('retry_step');
  });
});
