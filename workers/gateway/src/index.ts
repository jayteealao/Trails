import { getOptionsKey } from '@warg/shared';
import type {
  ArchiveOptions,
  LogEvent,
  InitRequestPayload
} from '@warg/shared';

/**
 * Generate a unique request ID (UUIDv4-like).
 */
function generateRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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

/**
 * Create a log event helper.
 */
function createEvent(
  type: LogEvent['type'],
  level: LogEvent['level'],
  message: string,
  data?: Record<string, unknown>
): LogEvent {
  return {
    ts: new Date().toISOString(),
    source: 'gateway',
    type,
    level,
    message,
    data
  };
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
        const options = (await request.json()) as ArchiveOptions;

        if (!options.url) {
          return Response.json({ error: 'url is required' }, { status: 400 });
        }

        const requestId = generateRequestId();
        const optionsR2Key = getOptionsKey(requestId);

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

        return Response.json({ requestId }, { status: 201 });
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
      return new Response(response.body, {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // POST /internal/event - Forward event to logger (for external services)
    if (method === 'POST' && path === '/internal/event') {
      const apiKey = request.headers.get('X-Internal-API-Key');
      if (apiKey !== env.INTERNAL_API_KEY) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      try {
        const body = (await request.json()) as { requestId: string; event: LogEvent };
        const response = await loggerRequest(env, '/event', 'POST', body);
        return new Response(response.body, {
          status: response.status,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        console.error('Error in /internal/event:', err);
        const message = err instanceof Error ? err.message : 'Internal error';
        return Response.json({ error: message }, { status: 500 });
      }
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
};
