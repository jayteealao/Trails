import type { ArchiveManifest, ArtifactMeta, ArtifactKind } from '@warg/shared';
import type {
  PersistRequest,
  PersistResponse,
  CreateUploadRequest,
  CreateUploadResponse,
  FinalizeRequest,
  FinalizeResponse,
  ArtifactUploadInfo,
  UploadedArtifact,
  UploadedArtifactResult
} from './types.js';
import { ARTIFACT_PATH_MAP } from './types.js';

/**
 * Artifact kinds that should be gzip-compressed before upload.
 * Excludes JSON (for easy access) and binary files (already compressed).
 */
const COMPRESSIBLE_KINDS = new Set<ArtifactKind>([
  'singlefile.html',
  'monolith.html',
  'rendered.html',
  'rendered.md',
  'readability.md'
]);

/**
 * Check if an artifact kind should be gzip-compressed.
 */
function shouldCompress(kind: ArtifactKind): boolean {
  return COMPRESSIBLE_KINDS.has(kind);
}

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Get the GCS path for an artifact.
 */
function getGcsPath(requestId: string, kind: ArtifactKind): { folder: string; filename: string; path: string } {
  const mapping = ARTIFACT_PATH_MAP[kind];
  if (!mapping) {
    throw new Error(`Unknown artifact kind: ${kind}`);
  }
  return {
    folder: mapping.folder,
    filename: mapping.filename,
    path: `archives/${requestId}/${mapping.folder}/${mapping.filename}`
  };
}

/**
 * Convert ArtifactMeta to ArtifactUploadInfo for Cloud Function.
 */
function toUploadInfo(requestId: string, artifact: ArtifactMeta): ArtifactUploadInfo {
  const { filename } = getGcsPath(requestId, artifact.kind);
  const compressed = shouldCompress(artifact.kind);
  return {
    kind: artifact.kind,
    filename,
    bytes: artifact.bytes,
    contentType: artifact.contentType,
    sha256: artifact.sha256,
    ...(compressed && { compressed })
  };
}

/**
 * Upload a single artifact from R2 to GCS using signed URL.
 */
async function uploadArtifact(
  bucket: R2Bucket,
  artifact: ArtifactMeta,
  signedUrl: string,
  gcsPath: string
): Promise<UploadedArtifact> {
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

  return {
    kind: artifact.kind,
    gcs_path: gcsPath,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    content_type: artifact.contentType
  };
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
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-API-Key': apiKey
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cloud Function ${path} failed: ${response.status} - ${text}`);
  }

  return (await response.json()) as T;
}

/**
 * Filter artifacts to only those that should be persisted to GCS.
 * Excludes manifest.json (not persisted to GCS).
 */
function filterPersistableArtifacts(artifacts: ArtifactMeta[]): ArtifactMeta[] {
  return artifacts.filter((a) => a.kind !== 'manifest.json');
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
        return jsonResponse({ error: 'Not found' }, 404);
      }

      // Verify internal API key
      const apiKey = request.headers.get('X-Internal-API-Key');
      if (!apiKey || apiKey !== env.INTERNAL_API_KEY) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      // Parse request body
      let body: PersistRequest;
      try {
        body = (await request.json()) as PersistRequest;
      } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
      }

      const { request_id, manifest_key, dryRun } = body;
      if (!request_id || !manifest_key) {
        return jsonResponse(
          { error: 'Missing required fields: request_id, manifest_key' },
          400
        );
      }

      console.log(`[gcs] Starting persist for ${request_id}, manifest: ${manifest_key}`);

      // Step 1: Read manifest from R2
      console.log('[gcs] Reading manifest from R2...');
      const manifestObj = await env.ARCHIVE_BUCKET.get(manifest_key);
      if (!manifestObj) {
        return jsonResponse({ error: 'Manifest not found in R2', key: manifest_key }, 404);
      }

      const manifest = await manifestObj.json<ArchiveManifest>();
      console.log(`[gcs] Manifest loaded: ${manifest.artifacts.length} artifacts`);

      // Filter to persistable artifacts
      const artifacts = filterPersistableArtifacts(manifest.artifacts);
      console.log(`[gcs] Persisting ${artifacts.length} artifacts to GCS`);

      if (artifacts.length === 0) {
        return jsonResponse({
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
        return jsonResponse({
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

      for (const artifact of artifacts) {
        const uploadEntry = createUploadRes.uploads.find((u) => u.kind === artifact.kind);
        if (!uploadEntry) {
          console.warn(`[gcs] No signed URL for artifact kind: ${artifact.kind}, skipping`);
          continue;
        }

        const uploaded = await uploadArtifact(
          env.ARCHIVE_BUCKET,
          artifact,
          uploadEntry.signed_url,
          uploadEntry.gcs_path
        );

        uploadedArtifacts.push(uploaded);
        uploadResults.push({
          kind: uploaded.kind,
          gcs_path: uploaded.gcs_path
        });
      }

      console.log(`[gcs] Uploaded ${uploadedArtifacts.length} artifacts to GCS`);

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
        artifacts: uploadResults
      };

      return jsonResponse(response);
    } catch (err) {
      console.error('[gcs] Unhandled error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      return jsonResponse({ error: 'Internal error', message: errMsg, stack }, 500);
    }
  }
};
