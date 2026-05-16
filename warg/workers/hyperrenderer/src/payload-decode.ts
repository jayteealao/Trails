export interface DecodedBinary {
  data: ArrayBuffer;
  contentType: string;
  source: 'data_url' | 'base64' | 'url';
}

function normalizeBase64(input: string): string {
  const noWhitespace = input.replace(/\s+/g, '');
  const normalized = noWhitespace.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  if (padding === 0) return normalized;
  return normalized + '='.repeat(4 - padding);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const normalized = normalizeBase64(base64);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function parseDataUrl(dataUrl: string): { contentType: string; payload: string } {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('Invalid data URL payload');
  }

  const header = dataUrl.slice(5, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const [contentTypePart] = header.split(';');
  const contentType = contentTypePart || 'application/octet-stream';

  if (!/;base64$/i.test(header) && !/;base64;/i.test(`${header};`)) {
    const text = decodeURIComponent(payload);
    const bytes = new TextEncoder().encode(text);
    return {
      contentType,
      payload: btoa(String.fromCharCode(...bytes)),
    };
  }

  return { contentType, payload };
}

export async function decodeBinaryPayload(
  payload: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DecodedBinary> {
  if (payload.startsWith('data:')) {
    const { contentType, payload: data } = parseDataUrl(payload);
    return {
      source: 'data_url',
      contentType,
      data: base64ToArrayBuffer(data),
    };
  }

  if (/^https?:\/\//i.test(payload)) {
    const response = await fetchImpl(payload);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Failed to download binary payload (${response.status}): ${body.slice(0, 200)}`);
    }

    return {
      source: 'url',
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      data: await response.arrayBuffer(),
    };
  }

  return {
    source: 'base64',
    contentType: 'application/octet-stream',
    data: base64ToArrayBuffer(payload),
  };
}

export function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  return base64ToArrayBuffer(base64);
}
