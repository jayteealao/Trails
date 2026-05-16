const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    signal: options?.signal ?? AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(text || `HTTP ${response.status}`, response.status);
  }

  return response.json() as Promise<T>;
}
