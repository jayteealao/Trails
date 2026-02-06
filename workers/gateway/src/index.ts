import { getOptionsKey } from '@warg/shared';
import type {
  ArchiveOptions,
  LogEvent,
  InitRequestPayload
} from '@warg/shared';
import {
  generateRequestId,
  isValidArchiveUrl,
  isValidRequestId,
  withRequestId,
  createEvent
} from './util.js';

/**
 * Make an internal request to the logger service.
 */
async function loggerRequest(
  env: Env,
  path: string,
  method: string,
  body?: unknown
): Promise<Response> {
  const url = `https://logger${path}`;
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-API-Key': env.INTERNAL_API_KEY
    }
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  return env.LOGGER.fetch(url, options);
}

/**
 * Initialize a request in the logger.
 */
async function initLoggerRequest(
  env: Env,
  payload: InitRequestPayload
): Promise<void> {
  const response = await loggerRequest(env, '/request/init', 'POST', payload);
  if (!response.ok) {
    console.error('Failed to init logger request:', await response.text());
  }
}

/**
 * Append an event to the logger.
 */
async function appendLogEvent(
  env: Env,
  requestId: string,
  event: LogEvent
): Promise<void> {
  const response = await loggerRequest(env, '/event', 'POST', { requestId, event });
  if (!response.ok) {
    console.error('Failed to append log event:', await response.text());
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // POST /begin - Start a new archive request
    if (method === 'POST' && path === '/begin') {
      try {
        const body = (await request.json()) as ArchiveOptions & { request_id?: string };

        if (!body.url) {
          return Response.json({ error: 'url is required' }, { status: 400 });
        }

        if (!isValidArchiveUrl(body.url)) {
          return Response.json(
            { error: 'Invalid URL: only http and https URLs are supported' },
            { status: 400 }
          );
        }

        // Use client-provided request_id or generate one
        const requestId = body.request_id ?? generateRequestId();
        if (body.request_id && !isValidRequestId(requestId)) {
          return Response.json(
            { error: 'Invalid request_id format (UUID v4 required)' },
            { status: 400 }
          );
        }
        const optionsR2Key = getOptionsKey(requestId);

        // Extract options: remove request_id and strip fields that could enable script injection
        const { request_id: _, preScript: _ps, cleanupScript: _cs, ...options } = body as
          ArchiveOptions & { request_id?: string; preScript?: unknown; cleanupScript?: unknown };

        // Store options in R2
        await env.ARCHIVE_BUCKET.put(optionsR2Key, JSON.stringify(options), {
          httpMetadata: { contentType: 'application/json' }
        });

        // Initialize request in logger
        await initLoggerRequest(env, {
          requestId,
          url: options.url,
          optionsR2Key
        });

        // Append request.created event
        await appendLogEvent(
          env,
          requestId,
          createEvent('request.created', 'info', 'Archive request created', {
            url: options.url,
            optionsR2Key
          })
        );

        // Trigger workflow
        const workflowResponse = await env.WORKFLOW.fetch('https://workflow/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: requestId,
            url: options.url,
            options_r2_key: optionsR2Key
          })
        });

        if (!workflowResponse.ok) {
          console.error('Failed to trigger workflow:', await workflowResponse.text());
          await appendLogEvent(
            env,
            requestId,
            createEvent('workflow.trigger_failed', 'error', 'Failed to trigger workflow')
          );
          // Return 202: request was created in logger but workflow did not start
          return withRequestId(
            Response.json({ requestId, warning: 'Workflow trigger failed' }, { status: 202 }),
            requestId
          );
        }

        return withRequestId(Response.json({ requestId }, { status: 201 }), requestId);
      } catch (err) {
        console.error('Error in /begin:', err);
        const message = err instanceof Error ? err.message : 'Internal error';
        return Response.json({ error: message }, { status: 500 });
      }
    }

    // GET /status/:id - Get request status
    if (method === 'GET' && path.startsWith('/status/')) {
      const requestId = path.slice('/status/'.length);
      if (!requestId) {
        return Response.json({ error: 'requestId is required' }, { status: 400 });
      }

      const response = await loggerRequest(env, `/request/${requestId}`, 'GET');
      return withRequestId(
        new Response(response.body, {
          status: response.status,
          headers: { 'Content-Type': 'application/json' }
        }),
        requestId
      );
    }

    // POST /internal/log - Forward event to logger (for external services)
    if (method === 'POST' && path === '/internal/log') {
      const apiKey = request.headers.get('X-Internal-API-Key');
      if (apiKey !== env.INTERNAL_API_KEY) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      try {
        const body = (await request.json()) as { requestId: string; event: LogEvent };
        const response = await loggerRequest(env, '/event', 'POST', body);
        return withRequestId(
          new Response(response.body, {
            status: response.status,
            headers: { 'Content-Type': 'application/json' }
          }),
          body.requestId
        );
      } catch (err) {
        console.error('Error in /internal/log:', err);
        const message = err instanceof Error ? err.message : 'Internal error';
        return Response.json({ error: message }, { status: 500 });
      }
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
};
