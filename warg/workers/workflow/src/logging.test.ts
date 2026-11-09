import { describe, expect, it, vi } from 'vitest';
import type { RequestSettle } from '@warg/shared';
import {
  classifyError,
  classifyTerminalFailure,
  settleForFailure,
  settleForResult,
  settleRequest,
} from './logging.js';
import type { WorkflowResult } from './types.js';

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

describe('classifyTerminalFailure', () => {
  it('takes a valid code and action from the terminal details', () => {
    const classified = classifyTerminalFailure(new Error('x'), {
      errorCode: 'NO_OUTPUTS_PRODUCED',
      retryable: true,
      recommendedAction: 'retry_full',
    });

    expect(classified).toEqual({
      errorCode: 'NO_OUTPUTS_PRODUCED',
      retryable: true,
      recommendedAction: 'retry_full',
      errorMessage: 'x',
    });
  });

  it('ignores a details code outside the list', () => {
    const classified = classifyTerminalFailure(new Error('x'), { errorCode: 'NOT_A_CODE' });

    expect(classified.errorCode).toBe(classifyError('request', 'x').errorCode);
  });

  it('classifies the message when there are no details', () => {
    const msg = 'ServiceCallError: Service timeout calling /monolith';
    const { errorMessage, ...classified } = classifyTerminalFailure(new Error(msg));

    expect(classified).toEqual(classifyError('request', msg));
    expect(errorMessage).toBe(msg);
  });
});

describe('settleRequest', () => {
  const settle: RequestSettle = { state: 'done', runId: 'run-1', settledAt: '2026-01-01T00:00:00.000Z' };

  function envWith(fetch: ReturnType<typeof vi.fn>): Env {
    // Only the logger binding and the key are read; the Env type is far wider.
    return { LOGGER: { fetch }, INTERNAL_API_KEY: 'test-key' } as unknown as Env;
  }

  it('posts the settle to the request settle route with the internal key', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));

    await settleRequest(envWith(fetch), 'req 1', settle);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://logger/request/req%201/settle');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('X-Internal-API-Key')).toBe('test-key');
    expect(JSON.parse(String(init.body))).toEqual(settle);
  });

  it('rejects with the status when the logger answers 500', async () => {
    const fetch = vi.fn(async () => new Response('boom', { status: 500 }));

    await expect(settleRequest(envWith(fetch), 'req-1', settle)).rejects.toThrow(/500/);
  });

  it('rejects when the fetch rejects', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(settleRequest(envWith(fetch), 'req-1', settle)).rejects.toThrow(/network down/);
  });
});

describe('settleForResult and settleForFailure', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const base: WorkflowResult = { status: 'done', manifestKey: 'archives/r/manifest.json' };

  it('settles a degraded result with a monolith failure as incomplete', () => {
    const settle = settleForResult(
      { ...base, degraded: true, partialFailures: [{ step: 'monolith', error: 'too large' }] },
      'run-1',
      at
    );

    expect(settle).toEqual({ state: 'incomplete', runId: 'run-1', settledAt: at });
  });

  it('settles a degraded result with only a singlefile failure as done', () => {
    const settle = settleForResult(
      { ...base, degraded: true, partialFailures: [{ step: 'singlefile', error: 'timeout' }] },
      'run-1',
      at
    );

    expect(settle.state).toBe('done');
  });

  it('settles a result that is not degraded as done', () => {
    expect(settleForResult(base, 'run-1', at)).toEqual({ state: 'done', runId: 'run-1', settledAt: at });
  });

  it('settles a failure as failed with the classified code', () => {
    const settle = settleForFailure(
      new Error('No requested outputs were produced'),
      { errorCode: 'NO_OUTPUTS_PRODUCED', retryable: true, recommendedAction: 'retry_full' },
      'run-1',
      at
    );

    expect(settle).toEqual({
      state: 'failed',
      runId: 'run-1',
      settledAt: at,
      errorCode: 'NO_OUTPUTS_PRODUCED',
      retryable: true,
      recommendedAction: 'retry_full',
      errorMessage: 'No requested outputs were produced',
    });
  });
});
