/**
 * The Worker's R2 handler for the monolith container.
 *
 * The container reaches R2 at `http://r2.monolith.internal/<key>`. The platform
 * hands requests to that one host (and no other) to the Worker, which answers
 * them from its own `ARCHIVE_BUCKET` binding. No storage key or signed URL
 * enters the container.
 *
 * Only two objects of the calling container's own request are reachable:
 * GET of `archives/<id>/raw/rendered.html` and PUT of
 * `archives/<id>/derived/monolith.html`. Everything else answers 403 before
 * any bucket call. Bodies stream in both directions, so the Worker never holds
 * the whole page in memory.
 */
import { getR2Key } from '@warg/shared';

export const R2_HANDLER_HOST = 'r2.monolith.internal';

/** The handler URL of an R2 key, each path segment percent-encoded. */
export function r2HandlerUrl(key: string): string {
  return `http://${R2_HANDLER_HOST}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** The two keys a monolith job may touch: its rendered input and its output. */
export function monolithKeys(requestId: string): { input: string; output: string } {
  return {
    input: getR2Key(requestId, 'rendered.html'),
    output: getR2Key(requestId, 'monolith.html')
  };
}

export interface R2OutboundDeps {
  bucket: Pick<R2Bucket, 'get' | 'put'>;
  /** The id of the container that sent the request. */
  containerId: string;
  /** The container id that a request id maps to. */
  containerIdForRequest(requestId: string): string;
  /** Give a request body a known length, which R2 needs to store a stream. */
  knownLength(body: ReadableStream<Uint8Array>, bytes: number): ReadableStream<Uint8Array>;
}

const KEY_PATTERN = /^archives\/([^/]+)\/(raw\/rendered\.html|derived\/monolith\.html)$/;

/** Decode a request path into an R2 key, or undefined when a segment is not valid. */
function decodeKey(pathname: string): string | undefined {
  try {
    return pathname.replace(/^\//, '').split('/').map(decodeURIComponent).join('/');
  } catch {
    return undefined;
  }
}

/**
 * Whether the method and key are the one read or the one write that the
 * calling container's own request allows.
 */
function isAllowed(method: string, key: string | undefined, deps: R2OutboundDeps): key is string {
  if (key === undefined) return false;
  const match = KEY_PATTERN.exec(key);
  const requestId = match?.[1];
  if (requestId === undefined || requestId === '.' || requestId === '..') return false;
  const { input, output } = monolithKeys(requestId);
  const allowed = (method === 'GET' && key === input) || (method === 'PUT' && key === output);
  return allowed && deps.containerIdForRequest(requestId) === deps.containerId;
}

async function serve(request: Request, key: string, deps: R2OutboundDeps): Promise<Response> {
  if (request.method === 'GET') {
    const object = await deps.bucket.get(key);
    if (!object) return new Response('Not found', { status: 404 });
    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? 'text/html',
        'content-length': String(object.size)
      }
    });
  }

  const lengthHeader = request.headers.get('content-length');
  if (lengthHeader === null || !/^\d+$/.test(lengthHeader)) {
    return new Response('Length required', { status: 411 });
  }
  const bytes = Number(lengthHeader);
  const value = request.body === null ? new Uint8Array(0) : deps.knownLength(request.body, bytes);
  await deps.bucket.put(key, value, { httpMetadata: { contentType: 'text/html' } });
  return new Response(null, { status: 201 });
}

/**
 * Answer one request of the container to the R2 handler host. Logs one line
 * per request with the method, host, key and status (never a body or secret).
 */
export async function handleR2Outbound(request: Request, deps: R2OutboundDeps): Promise<Response> {
  const url = new URL(request.url);
  const key = decodeKey(url.pathname);
  let response: Response;
  if (url.hostname !== R2_HANDLER_HOST || !isAllowed(request.method, key, deps)) {
    response = new Response('Forbidden', { status: 403 });
  } else {
    try {
      response = await serve(request, key, deps);
    } catch (error) {
      console.error('[monolith] r2 handler failed', {
        method: request.method,
        key,
        error: error instanceof Error ? error.message : String(error)
      });
      response = new Response('R2 request failed', { status: 502 });
    }
  }
  console.log('[monolith] r2 handler', {
    method: request.method,
    host: url.hostname,
    key,
    status: response.status
  });
  return response;
}
