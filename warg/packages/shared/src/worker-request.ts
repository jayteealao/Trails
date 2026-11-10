import { timingSafeEqual } from './crypto.js';

/** The header every internal worker reads the shared API key from. */
export const INTERNAL_API_KEY_HEADER = 'X-Internal-API-Key';

export type InternalJsonRequest =
  | { ok: true; url: URL; body: unknown }
  | { ok: false; response: Response };

/**
 * The common entry check of the internal workers, in this order:
 * 1. route: not `POST` to one of `paths` → 404 `{ error: 'Not found' }`
 *    (so an unknown path answers 404 even without a key);
 * 2. key: a missing or wrong internal API key → 401 `{ error: 'Unauthorized' }`;
 * 3. JSON: a body that does not parse → 400 `{ error: 'Invalid JSON' }`.
 *
 * The parsed body comes back as `unknown`; the caller casts it to its
 * own request type at its boundary. The caller keeps its own outer `try`, so a
 * throw here still answers that worker's 500.
 */
export async function readInternalJsonRequest(
  request: Request,
  internalApiKey: string,
  paths: readonly string[]
): Promise<InternalJsonRequest> {
  const url = new URL(request.url);

  if (request.method !== 'POST' || !paths.includes(url.pathname)) {
    return { ok: false, response: Response.json({ error: 'Not found' }, { status: 404 }) };
  }

  const apiKey = request.headers.get(INTERNAL_API_KEY_HEADER);
  if (!apiKey || !timingSafeEqual(apiKey, internalApiKey)) {
    return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: Response.json({ error: 'Invalid JSON' }, { status: 400 }) };
  }

  return { ok: true, url, body };
}
