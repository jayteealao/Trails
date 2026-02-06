import { timingSafeEqual } from '@warg/shared';
import type { ArchiveManifest, ArtifactMeta } from '@warg/shared';
import type {
  PersistRequest,
  PersistResponse,
  CompressionStat,
  CreateUploadRequest,
  CreateUploadResponse,
  FinalizeRequest,
  FinalizeResponse,
  UploadedArtifact,
  UploadedArtifactResult
} from './types.js';
import {
  shouldCompress,
  getGcsPath,
  filterPersistableArtifacts,
  toUploadInfo
} from './artifacts.js';

/**
 * Compress data using gzip via CompressionStream.
 */
async function gzipCompress(data: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(new Uint8Array(data));
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}

/**
 * Upload a single artifact from R2 to GCS using signed URL.
 */
interface UploadResult {
  uploaded: UploadedArtifact;
  compressionStat?: CompressionStat;
}

async function uploadArtifact(
  bucket: R2Bucket,
  artifact: ArtifactMeta,
  signedUrl: string,
  gcsPath: string
): Promise<UploadResult> {
  const compress = shouldCompress(artifact.kind);
  console.log(`[gcs] Uploading ${artifact.kind} from R2 (${artifact.r2Key}) to GCS (${gcsPath})${compress ? ' [gzip]' : ''}`);

  // Read from R2
  const r2Object = await bucket.get(artifact.r2Key);
  if (!r2Object) {
    throw new Error(`Artifact not found in R2: ${artifact.r2Key}`);
  }

  let body = await r2Object.arrayBuffer();
  const originalBytes = body.byteLength;

  // Compress if needed
  if (compress) {
    body = await gzipCompress(body);
    console.log(`[gcs] Compressed ${artifact.kind}: ${originalBytes} -> ${body.byteLength} bytes (${Math.round((1 - body.byteLength / originalBytes) * 100)}% reduction)`);
  }

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': artifact.contentType,
    'Content-Length': body.byteLength.toString()
  };
  if (compress) {
    headers['Content-Encoding'] = 'gzip';
  }

  // Upload to GCS via signed URL
  const response = await fetch(signedUrl, {
    method: 'PUT',
    headers,
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GCS upload failed for ${artifact.kind}: ${response.status} - ${text}`);
  }

  console.log(`[gcs] Successfully uploaded ${artifact.kind} (${body.byteLength} bytes${compress ? ' compressed' : ''})`);

  const uploaded: UploadedArtifact = {
    kind: artifact.kind,
    gcs_path: gcsPath,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    content_type: artifact.contentType
  };

  const compressionStat: CompressionStat | undefined = compress
    ? {
        kind: artifact.kind,
        originalBytes,
        compressedBytes: body.byteLength,
        ratio: originalBytes > 0 ? Math.round((1 - body.byteLength / originalBytes) * 100) / 100 : 0
      }
    : undefined;

  return { uploaded, compressionStat };
}

/**
 * Call Cloud Function endpoint.
 */
async function callCloudFunction<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  apiKey: string
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
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

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method !== 'POST' || url.pathname !== '/persist') {
        return Response.json({ error: 'Not found' }, { status: 404 });
      }

      // Verify internal API key
      const apiKey = request.headers.get('X-Internal-API-Key');
      if (!apiKey || !timingSafeEqual(apiKey, env.INTERNAL_API_KEY)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Parse request body
      let body: PersistRequest;
      try {
        body = (await request.json()) as PersistRequest;
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }

      const { request_id, manifest_key, dryRun } = body;
      if (!request_id || !manifest_key) {
        return Response.json(
          { error: 'Missing required fields: request_id, manifest_key' },
          { status: 400 }
        );
      }

      console.log(`[gcs] Starting persist for ${request_id}, manifest: ${manifest_key}`);

      // Step 1: Read manifest from R2
      console.log('[gcs] Reading manifest from R2...');
      const manifestObj = await env.ARCHIVE_BUCKET.get(manifest_key);
      if (!manifestObj) {
        return Response.json({ error: 'Manifest not found in R2', key: manifest_key }, { status: 404 });
      }

      const manifest = await manifestObj.json<ArchiveManifest>();
      console.log(`[gcs] Manifest loaded: ${manifest.artifacts.length} artifacts`);

      // Filter to persistable artifacts
      const artifacts = filterPersistableArtifacts(manifest.artifacts);
      console.log(`[gcs] Persisting ${artifacts.length} artifacts to GCS`);

      if (artifacts.length === 0) {
        return Response.json({
          success: true,
          firestore_doc_id: request_id,
          uploaded: 0,
          artifacts: []
        } satisfies PersistResponse);
      }

      // Dry run mode - skip actual uploads
      if (dryRun) {
        console.log('[gcs] Dry run mode - skipping uploads');
        const dryRunArtifacts: UploadedArtifactResult[] = artifacts.map((a) => ({
          kind: a.kind,
          gcs_path: getGcsPath(request_id, a.kind).path
        }));
        return Response.json({
          success: true,
          firestore_doc_id: request_id,
          uploaded: artifacts.length,
          artifacts: dryRunArtifacts,
          dryRun: true
        });
      }

      // Step 2: Call Cloud Function /create-upload to get signed URLs
      console.log('[gcs] Requesting signed upload URLs from Cloud Function...');
      const createUploadReq: CreateUploadRequest = {
        request_id,
        url: manifest.url,
        artifacts: artifacts.map((a) => toUploadInfo(request_id, a))
      };

      const createUploadRes = await callCloudFunction<CreateUploadResponse>(
        env.CLOUD_FN_BASE_URL,
        '/create-upload',
        createUploadReq,
        env.INTERNAL_API_KEY
      );

      console.log(`[gcs] Got ${createUploadRes.uploads.length} signed URLs, doc ID: ${createUploadRes.firestore_doc_id}`);

      // Step 3: Upload each artifact to GCS
      const uploadedArtifacts: UploadedArtifact[] = [];
      const uploadResults: UploadedArtifactResult[] = [];
      const compressionStats: CompressionStat[] = [];
      const skippedArtifacts: string[] = [];
      const uploadStart = Date.now();

      for (const artifact of artifacts) {
        const uploadEntry = createUploadRes.uploads.find((u) => u.kind === artifact.kind);
        if (!uploadEntry) {
          console.warn(`[gcs] No signed URL for artifact kind: ${artifact.kind}, skipping`);
          skippedArtifacts.push(artifact.kind);
          continue;
        }

        const result = await uploadArtifact(
          env.ARCHIVE_BUCKET,
          artifact,
          uploadEntry.signed_url,
          uploadEntry.gcs_path
        );

        uploadedArtifacts.push(result.uploaded);
        uploadResults.push({
          kind: result.uploaded.kind,
          gcs_path: result.uploaded.gcs_path
        });
        if (result.compressionStat) {
          compressionStats.push(result.compressionStat);
        }
      }

      const uploadDurationMs = Date.now() - uploadStart;
      console.log(`[gcs] Uploaded ${uploadedArtifacts.length} artifacts to GCS in ${uploadDurationMs}ms`);

      // Step 4: Call Cloud Function /finalize to update Firestore
      console.log('[gcs] Finalizing Firestore document...');
      const finalizeReq: FinalizeRequest = {
        request_id,
        firestore_doc_id: createUploadRes.firestore_doc_id,
        uploaded: uploadedArtifacts
      };

      const finalizeRes = await callCloudFunction<FinalizeResponse>(
        env.CLOUD_FN_BASE_URL,
        '/finalize',
        finalizeReq,
        env.INTERNAL_API_KEY
      );

      console.log(`[gcs] Finalize complete, status: ${finalizeRes.status}`);

      // Step 5: Return success response
      const response: PersistResponse = {
        success: true,
        firestore_doc_id: finalizeRes.firestore_doc_id,
        uploaded: uploadResults.length,
        artifacts: uploadResults,
        meta: {
          compressionStats,
          uploadDurationMs,
          skippedArtifacts
        }
      };

      return Response.json(response);
    } catch (err) {
      console.error('[gcs] Unhandled error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: 'Internal error', message: errMsg }, { status: 500 });
    }
  }
};
