import { decodeBase64ToArrayBuffer } from './payload-decode.js';
import type { CdpEventMessage, HyperbrowserWaitUntil } from './types.js';

interface PendingCommand {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface EventWaiter {
  predicate: (event: CdpEventMessage) => boolean;
  resolve: (event: CdpEventMessage) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface CapturePdfOptions {
  wsEndpoint: string;
  targetUrl: string;
  waitUntil: HyperbrowserWaitUntil;
  navigationTimeoutMs: number;
  commandTimeoutMs: number;
}

class CdpClient {
  private readonly socket: WebSocket;
  private nextMessageId = 1;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly waiters = new Set<EventWaiter>();
  private closed = false;

  constructor(socket: WebSocket) {
    this.socket = socket;

    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event.data);
    });

    this.socket.addEventListener('close', () => {
      this.closed = true;
      this.failAll(new Error('CDP websocket closed'));
    });

    this.socket.addEventListener('error', () => {
      this.closed = true;
      this.failAll(new Error('CDP websocket error'));
    });
  }

  async sendCommand(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = 10000,
  ): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new Error(`Cannot send CDP command ${method}: websocket closed`);
    }

    const id = this.nextMessageId;
    this.nextMessageId += 1;

    const payload: Record<string, unknown> = {
      id,
      method,
      params,
    };
    if (sessionId) {
      payload.sessionId = sessionId;
    }

    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeoutId });
    });

    this.socket.send(JSON.stringify(payload));
    return promise;
  }

  waitForEvent(
    predicate: (event: CdpEventMessage) => boolean,
    timeoutMs: number,
  ): Promise<CdpEventMessage> {
    if (this.closed) {
      return Promise.reject(new Error('Cannot wait for CDP event: websocket closed'));
    }

    return new Promise<CdpEventMessage>((resolve, reject) => {
      const waiter: EventWaiter = {
        predicate,
        resolve,
        reject,
        timeoutId: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error('Timed out waiting for CDP event'));
        }, timeoutMs),
      };

      this.waiters.add(waiter);
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error('CDP client closed'));
    try {
      this.socket.close(1000, 'done');
    } catch {
      // noop
    }
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
      this.pending.delete(id);
    }

    for (const waiter of this.waiters) {
      clearTimeout(waiter.timeoutId);
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  private handleMessage(rawData: string | ArrayBuffer): void {
    const text =
      typeof rawData === 'string'
        ? rawData
        : new TextDecoder().decode(new Uint8Array(rawData));

    let message: CdpEventMessage;
    try {
      message = JSON.parse(text) as CdpEventMessage;
    } catch {
      return;
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeoutId);
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    if (!message.method) return;

    for (const waiter of [...this.waiters]) {
      try {
        if (!waiter.predicate(message)) continue;
        clearTimeout(waiter.timeoutId);
        this.waiters.delete(waiter);
        waiter.resolve(message);
      } catch (error) {
        clearTimeout(waiter.timeoutId);
        this.waiters.delete(waiter);
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}

async function connectCdpWebSocket(wsEndpoint: string): Promise<WebSocket> {
  const response = await fetch(wsEndpoint, {
    headers: {
      Upgrade: 'websocket',
    },
  });

  if (response.status !== 101 || !response.webSocket) {
    const details = await response.text().catch(() => '');
    throw new Error(`Failed to connect CDP websocket (${response.status}): ${details.slice(0, 500)}`);
  }

  const socket = response.webSocket;
  socket.accept();
  return socket;
}

export async function capturePdfViaCdp(options: CapturePdfOptions): Promise<ArrayBuffer> {
  const socket = await connectCdpWebSocket(options.wsEndpoint);
  const cdp = new CdpClient(socket);

  let targetId = '';
  let sessionId = '';

  try {
    const createTarget = await cdp.sendCommand(
      'Target.createTarget',
      { url: 'about:blank' },
      undefined,
      options.commandTimeoutMs,
    );

    targetId = String(createTarget.targetId ?? '');
    if (!targetId) {
      throw new Error('CDP Target.createTarget did not return targetId');
    }

    const attachToTarget = await cdp.sendCommand(
      'Target.attachToTarget',
      { targetId, flatten: true },
      undefined,
      options.commandTimeoutMs,
    );

    sessionId = String(attachToTarget.sessionId ?? '');
    if (!sessionId) {
      throw new Error('CDP Target.attachToTarget did not return sessionId');
    }

    await cdp.sendCommand('Page.enable', {}, sessionId, options.commandTimeoutMs);
    await cdp.sendCommand(
      'Page.setLifecycleEventsEnabled',
      { enabled: true },
      sessionId,
      options.commandTimeoutMs,
    );

    const loadEventPromise = cdp.waitForEvent((event) => {
      if (event.sessionId !== sessionId) return false;
      if (event.method === 'Page.loadEventFired') return true;

      if (
        options.waitUntil === 'domcontentloaded' &&
        event.method === 'Page.domContentEventFired'
      ) {
        return true;
      }

      if (
        options.waitUntil === 'networkidle' &&
        event.method === 'Page.lifecycleEvent' &&
        event.params?.name === 'networkIdle'
      ) {
        return true;
      }

      if (
        options.waitUntil === 'load' &&
        event.method === 'Page.lifecycleEvent' &&
        event.params?.name === 'load'
      ) {
        return true;
      }

      return false;
    }, options.navigationTimeoutMs);

    const navigateResult = await cdp.sendCommand(
      'Page.navigate',
      { url: options.targetUrl },
      sessionId,
      options.commandTimeoutMs,
    );

    const navigateError = navigateResult.errorText;
    if (typeof navigateError === 'string' && navigateError.length > 0) {
      throw new Error(`CDP navigation failed: ${navigateError}`);
    }

    await loadEventPromise;

    const pdfResult = await cdp.sendCommand(
      'Page.printToPDF',
      {
        printBackground: true,
        preferCSSPageSize: true,
        landscape: false,
        scale: 1,
      },
      sessionId,
      options.commandTimeoutMs,
    );

    const encoded = pdfResult.data;
    if (typeof encoded !== 'string' || encoded.length === 0) {
      throw new Error('CDP printToPDF did not return PDF data');
    }

    return decodeBase64ToArrayBuffer(encoded);
  } finally {
    if (sessionId) {
      try {
        await cdp.sendCommand('Target.detachFromTarget', { sessionId }, undefined, 5000);
      } catch {
        // noop
      }
    }

    if (targetId) {
      try {
        await cdp.sendCommand('Target.closeTarget', { targetId }, undefined, 5000);
      } catch {
        // noop
      }
    }

    await cdp.close();
  }
}
