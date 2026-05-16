import { useState } from 'react';
import { submitArchive } from '@/api/endpoints';
import { useToast } from '@/components/ui/Toast';
import { useNavigate } from 'react-router';

export function ArchiveInput() {
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    try {
      new URL(trimmed);
    } catch {
      showToast('Invalid URL', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitArchive(trimmed);
      const id = result.requestId ?? result.request_id ?? 'unknown';
      showToast(`Submitted: ${id.slice(0, 8)}`);
      setUrl('');
      setTimeout(() => navigate(`/crawler/requests/${id}`), 800);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30">
      <div className="tech-border flex items-center gap-0 bg-bg-surface">
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          placeholder="https://..."
          className="bg-transparent px-4 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:outline-none w-80"
        />
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="btn-tactical h-full border-l border-border disabled:opacity-50"
        >
          {submitting ? 'SENDING...' : 'INITIATE_CRAWL'}
        </button>
      </div>
    </div>
  );
}
