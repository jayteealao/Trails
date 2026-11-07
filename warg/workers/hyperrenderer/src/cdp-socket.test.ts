import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectCdpWebSocket } from './cdp-pdf.js';

describe('connectCdpWebSocket', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // From the 2026-03-17 compatibility date Workers deliver binary frames as Blob;
  // the CDP client decodes them as ArrayBuffer, so the socket must ask for that.
  it('accepts the socket and asks for binary frames as ArrayBuffer', async () => {
    const socket = { accept: vi.fn(), binaryType: 'blob' };
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 101, webSocket: socket })));

    const connected = await connectCdpWebSocket('https://cdp.example/devtools');

    expect(connected).toBe(socket);
    expect(socket.accept).toHaveBeenCalledOnce();
    expect(socket.binaryType).toBe('arraybuffer');
  });
});
