import type {
  HyperbrowserBasicResponse,
  HyperbrowserClientConfig,
  HyperbrowserScrapeRequest,
  HyperbrowserScrapeResultResponse,
  HyperbrowserScrapeStartResponse,
  HyperbrowserScrapeStatusResponse,
  HyperbrowserSessionDetail,
  HyperbrowserSessionOptions,
} from './types.js';

export class HyperbrowserHttpError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body = '') {
    super(message);
    this.name = 'HyperbrowserHttpError';
    this.status = status;
    this.body = body;
  }
}

export class HyperbrowserRateLimitError extends Error {
  retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'HyperbrowserRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function parseRetryAfterMs(headerValue: string | null): number {
  if (!headerValue) return 5000;

  const seconds = Number.parseInt(headerValue, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(headerValue);
  if (!Number.isNaN(retryAt)) {
    const delta = retryAt - Date.now();
    return Math.max(delta, 1000);
  }

  return 5000;
}

function truncate(text: string, maxLength = 500): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

async function readBodyTextSafe(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

async function parseJsonSafe<T>(response: Response): Promise<T> {
  const text = await readBodyTextSafe(response);
  if (!text) {
    throw new HyperbrowserHttpError('Hyperbrowser returned an empty response body', response.status, '');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HyperbrowserHttpError(
      `Hyperbrowser returned invalid JSON (${response.status})`,
      response.status,
      truncate(text)
    );
  }
}

export class HyperbrowserApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly retries: number;

  constructor(config: HyperbrowserClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.requestTimeoutMs = config.requestTimeoutMs;
    this.retries = config.retries;
  }

  async startScrape(payload: HyperbrowserScrapeRequest): Promise<HyperbrowserScrapeStartResponse> {
    return this.requestJson<HyperbrowserScrapeStartResponse>('POST', '/api/scrape', payload);
  }

  async getScrapeStatus(jobId: string): Promise<HyperbrowserScrapeStatusResponse> {
    return this.requestJson<HyperbrowserScrapeStatusResponse>('GET', `/api/scrape/${encodeURIComponent(jobId)}/status`);
  }

  async getScrapeResult(jobId: string): Promise<HyperbrowserScrapeResultResponse> {
    return this.requestJson<HyperbrowserScrapeResultResponse>('GET', `/api/scrape/${encodeURIComponent(jobId)}`);
  }

  async createSession(options?: HyperbrowserSessionOptions): Promise<HyperbrowserSessionDetail> {
    return this.requestJson<HyperbrowserSessionDetail>('POST', '/api/session', options ?? {});
  }

  async stopSession(sessionId: string): Promise<HyperbrowserBasicResponse> {
    return this.requestJson<HyperbrowserBasicResponse>('PUT', `/api/session/${encodeURIComponent(sessionId)}/stop`);
  }

  private async requestJson<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = joinUrl(this.baseUrl, path);

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      try {
        const headers: HeadersInit = {
          'x-api-key': this.apiKey,
          'content-type': 'application/json',
        };

        const response = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });

        if (response.status === 429) {
          const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
          throw new HyperbrowserRateLimitError(
            `Hyperbrowser rate limited request to ${path}`,
            retryAfterMs,
          );
        }

        if (response.ok) {
          return parseJsonSafe<T>(response);
        }

        const responseBody = await readBodyTextSafe(response);
        const retryable = response.status >= 500 || response.status === 408;
        if (retryable && attempt < this.retries) {
          await sleep(250 * 2 ** attempt);
          continue;
        }

        throw new HyperbrowserHttpError(
          `Hyperbrowser request failed: ${method} ${path} (${response.status})`,
          response.status,
          truncate(responseBody),
        );
      } catch (error) {
        if (error instanceof HyperbrowserRateLimitError) {
          throw error;
        }
        if (error instanceof HyperbrowserHttpError) {
          throw error;
        }

        if (attempt < this.retries) {
          await sleep(250 * 2 ** attempt);
          continue;
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new HyperbrowserHttpError(
          `Hyperbrowser network error: ${method} ${path} (${message})`,
          0,
          '',
        );
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw new HyperbrowserHttpError(`Hyperbrowser request failed after retries: ${method} ${path}`, 0, '');
  }
}
