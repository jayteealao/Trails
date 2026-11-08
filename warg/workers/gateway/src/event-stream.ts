/**
 * The longest a public-key caller can hold a status stream open. Below the logger's own 2-minute cap.
 */
export const PUBLIC_STATUS_STREAM_MAX_MS = 60_000;

const LINE_FEED = 0x0a;

/**
 * Largest partial SSE frame held back while waiting for its end. A longer one is
 * forwarded as it is, and a cap that cuts it ends it with a blank line.
 */
const MAX_HELD_FRAME_BYTES = 64 * 1024;

/** The index just past the last frame boundary (a blank line, "\n\n") in bytes, or 0 when there is none. */
function endOfLastFrame(bytes: Uint8Array): number {
  for (let i = bytes.length - 1; i >= 1; i--) {
    if (bytes[i] === LINE_FEED && bytes[i - 1] === LINE_FEED) return i + 1;
  }
  return 0;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Forward an SSE body whole frame by whole frame. A frame not yet ended is held back
 * until its blank line arrives, so a client never receives half an event. At maxMs,
 * drop any held partial frame, write `event: timeout` with
 * { reason: 'stream_time_limit', limitMs }, close, and cancel the upstream; when the
 * upstream ends first, forward what is held and close. Cancelling the returned stream
 * cancels the upstream.
 */
export function capEventStream(upstream: ReadableStream<Uint8Array>, maxMs: number): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  // null, not undefined: the Workers clearTimeout takes number | null.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;
  // The bytes after the last frame boundary, not yet forwarded.
  let held: Uint8Array = new Uint8Array(0);
  // True when a partial frame too long to hold was forwarded and has not ended yet.
  let midFrame = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        const data = JSON.stringify({ reason: 'stream_time_limit', limitMs: maxMs });
        controller.enqueue(new TextEncoder().encode(`${midFrame ? '\n\n' : ''}event: timeout\ndata: ${data}\n\n`));
        controller.close();
        reader.cancel('stream time limit').catch((err: unknown) => {
          console.warn('[gateway] cancelling the capped upstream stream failed', err);
        });
      }, maxMs);
    },
    async pull(controller) {
      // Read until something is forwarded: a pull that enqueues nothing is not called again.
      for (;;) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (err) {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          controller.error(err);
          return;
        }
        if (finished) return;
        if (result.done) {
          finished = true;
          clearTimeout(timer);
          if (held.length > 0) controller.enqueue(held);
          controller.close();
          return;
        }
        const bytes = concatBytes(held, result.value);
        // Within a frame forwarded early, any later bytes belong to it: forward them too.
        const end = midFrame ? bytes.length : endOfLastFrame(bytes);
        held = bytes.slice(end);
        if (midFrame) {
          midFrame = endOfLastFrame(bytes) !== bytes.length;
        }
        if (held.length > MAX_HELD_FRAME_BYTES) {
          controller.enqueue(bytes);
          held = new Uint8Array(0);
          midFrame = true;
          return;
        }
        if (end > 0) {
          controller.enqueue(bytes.subarray(0, end));
          return;
        }
      }
    },
    cancel(reason) {
      finished = true;
      clearTimeout(timer);
      return reader.cancel(reason);
    }
  });
}
