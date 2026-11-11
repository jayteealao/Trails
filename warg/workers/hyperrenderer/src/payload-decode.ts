import { decodeBase64ToArrayBuffer } from '@warg/shared';

export interface DecodedBinary {
  data: ArrayBuffer;
  contentType: string;
  source: 'data_url' | 'base64' | 'url';
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
      data: decodeBase64ToArrayBuffer(data),
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
    data: decodeBase64ToArrayBuffer(payload),
  };
}
