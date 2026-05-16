import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { fetchSignedUrl } from '@/api/endpoints';
import { LoadingState } from '@/components/ui/LoadingState';

interface ContentViewerProps {
  itemId: string;
  archiveKey: string;
  onClose: () => void;
}

const HTML_TYPES = ['rendered', 'singlefile', 'monolith'];
const TEXT_TYPES = ['readability', 'markdown'];

export function ContentViewer({ itemId, archiveKey, onClose }: ContentViewerProps) {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [textContent, setTextContent] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetchSignedUrl(itemId, archiveKey)
      .then(data => {
        if (!data.url) throw new Error('No signed URL returned');
        setUrl(data.url);

        if (TEXT_TYPES.includes(archiveKey)) {
          fetch(data.url)
            .then(r => r.text())
            .then(setTextContent)
            .catch(() => setTextContent('Failed to load content'));
        }
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to load');
      });
  }, [itemId, archiveKey]);

  return (
    <Modal title={archiveKey} onClose={onClose}>
      <div className="h-[70vh]">
        {error ? (
          <div className="flex items-center justify-center h-full">
            <span className="font-mono text-xs text-accent-red">{error}</span>
          </div>
        ) : !url ? (
          <LoadingState message="Loading archive..." />
        ) : HTML_TYPES.includes(archiveKey) ? (
          <iframe
            src={url}
            className="w-full h-full border-0"
            sandbox="allow-same-origin"
            title={archiveKey}
          />
        ) : archiveKey === 'pdf' ? (
          <iframe
            src={url}
            className="w-full h-full border-0"
            sandbox="allow-same-origin allow-scripts"
            title={archiveKey}
          />
        ) : archiveKey === 'screenshot' ? (
          <div className="flex items-center justify-center h-full p-4">
            <img src={url} alt="Screenshot" className="max-w-full max-h-full object-contain" />
          </div>
        ) : TEXT_TYPES.includes(archiveKey) ? (
          <pre className="font-mono text-xs text-text-secondary p-4 overflow-auto h-full whitespace-pre-wrap">
            {textContent ?? 'Loading...'}
          </pre>
        ) : (
          <div className="flex items-center justify-center h-full">
            <span className="font-mono text-xs text-text-muted">
              Unsupported archive type: {archiveKey}
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
