interface GatewayInternalLogConfig {
  gatewayUrl: string;
  internalApiKey: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function postGatewayInternalLog(
  config: GatewayInternalLogConfig,
  payload: Record<string, unknown>
): Promise<void> {
  let lastStatus = 0;
  let lastBody = '';

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${config.gatewayUrl}/internal/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': config.internalApiKey,
        'CF-Access-Client-Id': config.cfAccessClientId,
        'CF-Access-Client-Secret': config.cfAccessClientSecret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (response.ok) return;

    lastStatus = response.status;
    lastBody = (await response.text()).slice(0, 600);
    if (!shouldRetry(lastStatus) || attempt === 2) break;

    await sleep(500 * (2 ** attempt));
  }

  throw new Error(`Gateway internal/log failed: ${lastStatus} ${lastBody}`);
}
