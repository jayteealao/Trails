/**
 * Call an archive-gateway Cloud Function endpoint.
 *
 * The storage worker authenticates with its own key, ARCHIVE_GATEWAY_KEY,
 * which opens archive-gateway only. INTERNAL_API_KEY stays the worker's
 * inbound key for worker-to-worker calls and is never sent to the function.
 */
export async function callCloudFunction<T>(
  env: Pick<Env, 'CLOUD_FN_BASE_URL' | 'ARCHIVE_GATEWAY_KEY'>,
  path: string,
  body: unknown
): Promise<T> {
  const apiKey = env.ARCHIVE_GATEWAY_KEY;
  if (!apiKey) {
    throw new Error('ARCHIVE_GATEWAY_KEY is not configured');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${env.CLOUD_FN_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cloud Function ${path} failed: ${response.status} - ${text}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}
