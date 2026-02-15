interface Env {
  DASHBOARD_API_URL: string;
  INTERNAL_API_KEY: string;
}

interface SignedUrlPayload {
  url?: string;
  archive_source_key?: string;
}

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{8,40}$/;
const VALID_ARCHIVE_KEYS = new Set([
  'rendered',
  'singlefile',
  'readability',
  'markdown',
  'monolith',
  'pdf',
  'screenshot',
]);

const HTML_ARCHIVES = new Set(['rendered', 'singlefile', 'monolith']);
const TEXT_ARCHIVES = new Set(['readability', 'markdown']);

function buildApiUrl(baseUrl: string, path: string, params: URLSearchParams): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const target = new URL(path, base);
  for (const [key, value] of params.entries()) {
    target.searchParams.set(key, value);
  }
  return target.toString();
}

function inferContentType(archiveKey: string, upstreamType: string | null): string {
  const cleaned = (upstreamType ?? '').trim().toLowerCase();
  if (cleaned && cleaned !== 'application/octet-stream') {
    return upstreamType as string;
  }
  if (HTML_ARCHIVES.has(archiveKey)) return 'text/html; charset=utf-8';
  if (TEXT_ARCHIVES.has(archiveKey)) return 'text/plain; charset=utf-8';
  if (archiveKey === 'pdf') return 'application/pdf';
  if (archiveKey === 'screenshot') return 'image/png';
  return 'application/octet-stream';
}

function isGzipBytes(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

async function maybeDecompressGzip(data: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(data);
  if (!isGzipBytes(bytes)) return data;
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Runtime does not support gzip decompression');
  }

  const stream = new Response(data).body;
  if (!stream) {
    throw new Error('Missing response body while decompressing archive');
  }

  const decompressed = stream.pipeThrough(new DecompressionStream('gzip'));
  return new Response(decompressed).arrayBuffer();
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function safeErrorMessage(text: string, fallback: string): string {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    return trimmed;
  }
  return fallback;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const url = new URL(request.url);
  const itemId = url.searchParams.get('itemId') ?? '';
  const archiveKey = url.searchParams.get('archiveKey') ?? '';
  const download = url.searchParams.get('download') === '1';

  if (!env.DASHBOARD_API_URL) {
    return jsonError('DASHBOARD_API_URL is not configured', 500);
  }
  if (!env.INTERNAL_API_KEY) {
    return jsonError('INTERNAL_API_KEY is not configured', 500);
  }
  if (!SAFE_ID_RE.test(itemId)) {
    return jsonError('Invalid itemId format', 400);
  }
  if (!VALID_ARCHIVE_KEYS.has(archiveKey)) {
    return jsonError('Invalid archiveKey', 400);
  }

  try {
    const signedUrlResponse = await fetch(
      buildApiUrl(
        env.DASHBOARD_API_URL,
        'signed-url',
        new URLSearchParams({ itemId, archiveKey })
      ),
      {
        headers: { 'X-Internal-API-Key': env.INTERNAL_API_KEY },
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!signedUrlResponse.ok) {
      const text = await signedUrlResponse.text();
      const message = safeErrorMessage(
        text,
        `Signed URL request failed (${signedUrlResponse.status})`
      );
      return jsonError(message, signedUrlResponse.status);
    }

    const signed = (await signedUrlResponse.json()) as SignedUrlPayload;
    if (!signed.url) {
      return jsonError('Signed URL response did not include url', 502);
    }

    const upstream = await fetch(signed.url, {
      signal: AbortSignal.timeout(30000),
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      const message = safeErrorMessage(text, `Archive fetch failed (${upstream.status})`);
      return jsonError(message, upstream.status);
    }

    const upstreamData = await upstream.arrayBuffer();
    const body = await maybeDecompressGzip(upstreamData);

    const headers = new Headers();
    headers.set('Content-Type', inferContentType(archiveKey, upstream.headers.get('Content-Type')));
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Archive-Source-Key', signed.archive_source_key ?? archiveKey);

    if (download) {
      headers.set('Content-Disposition', `attachment; filename="${itemId}-${archiveKey}"`);
    }

    return new Response(body, { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonError(message, 500);
  }
};
