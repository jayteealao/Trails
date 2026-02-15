interface GatewayBeginClientConfig {
  gatewayUrl: string;
  publicApiKey: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
}

interface GatewayErrorPayload {
  status: number;
  body: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function callGatewayBegin(
  config: GatewayBeginClientConfig,
  payload: Record<string, unknown>
): Promise<{ requestId?: string; request_id?: string }> {
  let lastError: GatewayErrorPayload | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${config.gatewayUrl}/begin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.publicApiKey,
        'CF-Access-Client-Id': config.cfAccessClientId,
        'CF-Access-Client-Secret': config.cfAccessClientSecret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (response.ok) {
      return (await response.json()) as { requestId?: string; request_id?: string };
    }

    const body = (await response.text()).slice(0, 600);
    lastError = { status: response.status, body };

    if (!shouldRetry(response.status) || attempt === 2) {
      break;
    }

    await sleep(500 * (2 ** attempt));
  }

  throw new Error(
    `Gateway begin failed: ${lastError?.status ?? 500} ${lastError?.body ?? 'unknown error'}`
  );
}
