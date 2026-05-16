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

interface GatewayBeginResponse {
  requestId?: string;
  request_id?: string;
  warning?: string;
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
): Promise<GatewayBeginResponse> {
  if (!config.publicApiKey) {
    throw new Error('Gateway begin failed: missing PUBLIC_API_KEY');
  }
  if (!config.cfAccessClientId || !config.cfAccessClientSecret) {
    throw new Error('Gateway begin failed: missing Cloudflare Access machine credentials');
  }

  let lastError: GatewayErrorPayload | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${config.gatewayUrl}/begin`, {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = { status: 503, body: `Network error calling gateway /begin: ${message}` };
      if (attempt < 2) {
        await sleep(500 * (2 ** attempt));
        continue;
      }
      break;
    }

    const rawBody = (await response.text()).slice(0, 600);
    let parsed: GatewayBeginResponse = {};
    if (rawBody) {
      try {
        parsed = JSON.parse(rawBody) as GatewayBeginResponse;
      } catch {
        parsed = {};
      }
    }

    const hasRequestId = Boolean(parsed.requestId ?? parsed.request_id);
    const hasTriggerWarning = response.status === 202 || Boolean(parsed.warning);

    if (response.ok && !hasTriggerWarning && hasRequestId) {
      return parsed;
    }

    const retryStatus = hasTriggerWarning ? 502 : response.status;
    const reason = hasTriggerWarning
      ? `Gateway begin warning: ${rawBody || 'workflow trigger failed'}`
      : rawBody || `HTTP ${response.status}`;
    lastError = { status: retryStatus, body: reason };

    if (!shouldRetry(retryStatus) || attempt === 2) {
      break;
    }

    await sleep(500 * (2 ** attempt));
  }

  throw new Error(
    `Gateway begin failed: ${lastError?.status ?? 500} ${lastError?.body ?? 'unknown error'}`
  );
}
