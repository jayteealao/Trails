import type { WorkflowStep } from 'cloudflare:workers';
import type { ArtifactMeta, ArchiveManifest, ArtifactKind } from '@warg/shared';
import { getR2Key } from '@warg/shared';
import type { ArchiveOptionsExtended, WorkflowResult } from './types.js';
import { logEvent, logArtifactWritten, updateManifestKey } from './logging.js';

/**
 * Generate mock artifact metadata.
 */
function createMockArtifact(
  requestId: string,
  kind: ArtifactKind,
  content: string,
  contentType: string
): { meta: ArtifactMeta; content: string } {
  const bytes = new TextEncoder().encode(content);
  return {
    meta: {
      kind,
      r2Key: getR2Key(requestId, kind),
      bytes: bytes.length,
      sha256: 'mock-sha256-' + kind.replace(/\./g, '-'),
      contentType
    },
    content
  };
}

/**
 * Generate all mock artifacts based on options.
 */
function generateMockArtifacts(
  requestId: string,
  url: string,
  options: ArchiveOptionsExtended
): Array<{ meta: ArtifactMeta; content: string }> {
  const timestamp = new Date().toISOString();
  const artifacts: Array<{ meta: ArtifactMeta; content: string }> = [];

  // Always include rendered HTML
  artifacts.push(
    createMockArtifact(
      requestId,
      'rendered.html',
      `<!DOCTYPE html><html><head><title>Mock Rendered</title></head><body><h1>Mock rendered HTML for ${url}</h1><p>Generated at ${timestamp}</p></body></html>`,
      'text/html'
    )
  );

  // Optional screenshot
  if (options.includeScreenshot) {
    artifacts.push(
      createMockArtifact(
        requestId,
        'screenshot.png',
        'MOCK_PNG_DATA_' + requestId,
        'image/png'
      )
    );
  }

  // Optional PDF
  if (options.includePdf) {
    artifacts.push(
      createMockArtifact(requestId, 'page.pdf', 'MOCK_PDF_DATA_' + requestId, 'application/pdf')
    );
  }

  // Derived artifacts
  artifacts.push(
    createMockArtifact(
      requestId,
      'singlefile.html',
      `<!DOCTYPE html><html><head><title>Mock SingleFile</title></head><body><h1>Mock SingleFile HTML for ${url}</h1></body></html>`,
      'text/html'
    )
  );

  artifacts.push(
    createMockArtifact(
      requestId,
      'readability.json',
      JSON.stringify({
        title: 'Mock Readability Extract',
        content: `<p>Mock readable content for ${url}</p>`,
        textContent: `Mock readable content for ${url}`,
        length: 100,
        excerpt: 'Mock excerpt'
      }),
      'application/json'
    )
  );

  artifacts.push(
    createMockArtifact(
      requestId,
      'readability.md',
      `# Mock Readability Extract\n\nMock readable content for ${url}\n`,
      'text/markdown'
    )
  );

  artifacts.push(
    createMockArtifact(
      requestId,
      'monolith.html',
      `<!DOCTYPE html><html><head><title>Mock Monolith</title></head><body><h1>Mock Monolith HTML for ${url}</h1></body></html>`,
      'text/html'
    )
  );

  return artifacts;
}

/**
 * Run the mock pipeline for testing without browser rendering.
 */
export async function runMockPipeline(
  env: Env,
  step: WorkflowStep,
  requestId: string,
  url: string,
  options: ArchiveOptionsExtended
): Promise<WorkflowResult> {
  // Generate mock artifacts
  const mockArtifacts = generateMockArtifacts(requestId, url, options);

  // Write mock artifacts to R2
  const artifactMetas = await step.do('write-mock-artifacts', async () => {
    const metas: ArtifactMeta[] = [];

    for (const { meta, content } of mockArtifacts) {
      await env.ARCHIVE_BUCKET.put(meta.r2Key, content, {
        httpMetadata: { contentType: meta.contentType }
      });
      metas.push(meta);
    }

    return metas;
  });

  // Log artifact writes
  await step.do('log-mock-artifacts', async () => {
    for (const meta of artifactMetas) {
      await logArtifactWritten(
        env,
        requestId,
        meta.kind,
        meta.r2Key,
        meta.bytes,
        meta.contentType,
        meta.sha256
      );
    }
  });

  // Build and write manifest
  const manifestKey = await step.do('write-mock-manifest', async () => {
    const now = new Date().toISOString();
    const manifest: ArchiveManifest = {
      requestId,
      url,
      createdAt: now,
      completedAt: now,
      artifacts: artifactMetas
    };

    const key = getR2Key(requestId, 'manifest.json');
    await env.ARCHIVE_BUCKET.put(key, JSON.stringify(manifest, null, 2), {
      httpMetadata: { contentType: 'application/json' }
    });

    return key;
  });

  // Update manifest key in logger
  await step.do('update-manifest-key', async () => {
    await updateManifestKey(env, requestId, manifestKey);
  });

  // Log completion
  await step.do('log-mock-done', async () => {
    await logEvent(env, requestId, 'workflow.completed', 'Mock pipeline completed', {
      mock: true,
      artifactCount: artifactMetas.length
    });
  });

  return { status: 'done', mock: true, manifestKey };
}
