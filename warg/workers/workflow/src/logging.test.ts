import { describe, expect, it, vi } from 'vitest';
import { classifyError } from '@warg/shared';
import type { RequestSettle } from '@warg/shared';
import {
  classifyTerminalFailure,
  settleForFailure,
  settleForResult,
  settleRequest,
} from './logging.js';
import type { WorkflowResult } from './types.js';

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

  it('warns when the logger ignored the settle as stale', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi.fn(async () =>
      Response.json({ found: true, applied: false, reason: 'stale', stage: 'queued', terminal: false })
    );

    await settleRequest(envWith(fetch), 'req-1', settle);

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0]!.map(String).join(' ');
    expect(logged).toContain('settle not applied');
    expect(logged).toContain('"request_id":"req-1"');
    expect(logged).toContain('"stage":"queued"');
    warn.mockRestore();
  });

  it('does not warn when a retried settle is a duplicate', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi.fn(async () =>
      Response.json({ found: true, applied: false, reason: 'duplicate', stage: 'done', terminal: true })
    );

    await settleRequest(envWith(fetch), 'req-1', settle);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
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

  it('settles a degraded result with only a singlefile failure as incomplete', () => {
    const settle = settleForResult(
      { ...base, degraded: true, partialFailures: [{ step: 'singlefile', error: 'timeout' }] },
      'run-1',
      at
    );

    expect(settle.state).toBe('incomplete');
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
