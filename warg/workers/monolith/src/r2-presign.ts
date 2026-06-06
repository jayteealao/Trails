import { AwsClient } from 'aws4fetch';

/**
 * Read-only R2 S3-API credentials used to mint short-lived presigned GET URLs.
 * The Sandbox fetches the rendered HTML over its own network from these URLs,
 * replacing the host→container `writeFile` RPC (B1b).
 */
export interface R2PresignConfig {
  accessKeyId: string;
  secretAccessKey: string;
  accountId: string;
  bucket: string;
}

/**
 * Build the path-style S3 object URL for an R2 key.
 * Each path segment is encoded individually so `/` stays a separator.
 */
export function buildR2ObjectUrl(accountId: string, bucket: string, key: string): string {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodedKey}`;
}

function makeClient(config: R2PresignConfig): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: 'auto'
  });
}

/**
 * Mint a short-lived presigned URL for an R2 object via SigV4 query signing.
 * Default TTL is 15 minutes — long enough for one monolith run, short enough to
 * limit exposure of the URL.
 */
async function presignR2Url(
  config: R2PresignConfig,
  key: string,
  method: 'GET' | 'PUT',
  expiresInSeconds: number
): Promise<string> {
  const url = new URL(buildR2ObjectUrl(config.accountId, config.bucket, key));
  url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));

  const signed = await makeClient(config).sign(url.toString(), {
    method,
    aws: { signQuery: true }
  });
  return signed.url;
}

/** Presigned GET URL — the Sandbox fetches the rendered HTML input (B1b). */
export function presignR2GetUrl(
  config: R2PresignConfig,
  key: string,
  expiresInSeconds: number = 900
): Promise<string> {
  return presignR2Url(config, key, 'GET', expiresInSeconds);
}

/** Presigned PUT URL — the Sandbox uploads the monolith output directly to R2,
 *  sidestepping the 32 MiB `readFile` RPC ceiling on large artifacts (B1b-out). */
export function presignR2PutUrl(
  config: R2PresignConfig,
  key: string,
  expiresInSeconds: number = 900
): Promise<string> {
  return presignR2Url(config, key, 'PUT', expiresInSeconds);
}
