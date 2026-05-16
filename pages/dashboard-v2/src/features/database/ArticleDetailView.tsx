import { useParams, useNavigate } from 'react-router';
import { useState, useEffect } from 'react';
import { fetchArticleDetail, fetchRequestDetail, submitArchive } from '@/api/endpoints';
import { PipelineVisualizer } from '@/components/pipeline/PipelineVisualizer';
import { Timeline } from '@/components/pipeline/Timeline';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { CopyableText } from '@/components/ui/CopyableText';
import { LoadingState } from '@/components/ui/LoadingState';
import { ContentViewer } from '@/components/archive/ContentViewer';
import { useToast } from '@/components/ui/Toast';
import { formatTime, formatTimeShort, formatBytes } from '@/lib/formatters';
import { ARCHIVE_KEY_TO_STEP } from '@/lib/constants';
import type { Article, RequestDetail, PipelineEvent } from '@/api/types';

export function ArticleDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [article, setArticle] = useState<Article | undefined>(undefined);
  const [pipelineData, setPipelineData] = useState<RequestDetail | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [viewingArchive, setViewingArchive] = useState<{ itemId: string; archiveKey: string } | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    setLoading(true);

    fetchArticleDetail(id)
      .then(detail => {
        setArticle(detail);
        if (detail.warg_request_id) {
          return fetchRequestDetail(detail.warg_request_id)
            .then(setPipelineData)
            .catch(() => { /* optional */ });
        }
      })
      .catch(() => { /* handled by UI */ })
      .finally(() => setLoading(false));
  }, [id]);

  const handleArchiveAction = async (action: string, url: string, itemId: string, step?: string) => {
    try {
      const options: { request_id?: string; steps?: string[] } = { request_id: itemId };
      if (action === 'rearchive-step' && step) {
        options.steps = [step];
      }

      const result = await submitArchive(url, options);
      const rid = result.requestId ?? result.request_id ?? 'unknown';
      showToast(`Submitted: ${rid.slice(0, 8)}`);

      // Refresh after delay
      setTimeout(() => {
        if (id) {
          fetchArticleDetail(id).then(setArticle).catch(() => {});
        }
      }, 5000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed', 'error');
    }
  };

  if (loading) return <LoadingState />;
  if (!article) return <div className="font-mono text-xs text-text-muted">Article not found</div>;

  const events: PipelineEvent[] = pipelineData?.events ?? [];
  const classification = article.archive_classification;
  const successCount = article.archives.filter(a => a.status === 'success').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/database')} className="btn-tactical text-[10px]">
          &lt; BACK
        </button>
        <h2 className="font-display text-sm font-bold tracking-widest uppercase">Article Detail</h2>
      </div>

      {events.length > 0 && <PipelineVisualizer events={events} />}

      {/* Header */}
      <div className="tech-border p-4">
        <div className="font-mono text-sm text-text-primary mb-3 break-all">{article.url}</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetaItem label="Item ID">
            <CopyableText text={article.item_id} />
          </MetaItem>
          {article.title && <MetaItem label="Title">{article.title}</MetaItem>}
          <MetaItem label="Domain">{article.domain}</MetaItem>
          <MetaItem label="Classification"><StatusBadge status={classification} /></MetaItem>
          {article.warg_request_id && (
            <MetaItem label="Request ID">
              <CopyableText text={article.warg_request_id} />
            </MetaItem>
          )}
          <MetaItem label="Created">{formatTime(article.created_at)}</MetaItem>
          {article.firestore_status && <MetaItem label="Processing">{article.firestore_status}</MetaItem>}
          {article.error && <MetaItem label="Error"><span className="text-accent-red">{article.error}</span></MetaItem>}
        </div>
      </div>

      {/* Metadata */}
      {article.metadata && (article.metadata.byline || article.metadata.excerpt || article.metadata.word_count) && (
        <div className="tech-border p-4">
          <div className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase mb-2">
            Metadata
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {article.metadata.byline && <MetaItem label="Author">{article.metadata.byline}</MetaItem>}
            {article.metadata.site_name && <MetaItem label="Site">{article.metadata.site_name}</MetaItem>}
            {article.metadata.word_count && <MetaItem label="Words">{article.metadata.word_count.toLocaleString()}</MetaItem>}
            {article.metadata.published_time && <MetaItem label="Published">{formatTime(article.metadata.published_time)}</MetaItem>}
          </div>
          {article.metadata.excerpt && (
            <div className="mt-2">
              <MetaItem label="Excerpt">{article.metadata.excerpt}</MetaItem>
            </div>
          )}
        </div>
      )}

      {/* Archive / Re-archive action */}
      {classification === 'unarchived' && (
        <button
          onClick={() => handleArchiveAction('archive-full', article.url, article.item_id)}
          className="btn-tactical self-start"
        >
          ARCHIVE THIS ARTICLE
        </button>
      )}
      {(classification === 'incomplete' || classification === 'failed') && (
        <button
          onClick={() => handleArchiveAction('rearchive-all', article.url, article.item_id)}
          className="btn-tactical self-start"
        >
          RE-ARCHIVE ALL
        </button>
      )}

      {/* Archives grid */}
      <div className="tech-border">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase">
            Archives
          </span>
          <span className="font-mono text-[10px] text-text-muted">
            {successCount}/{article.archives.length} available
          </span>
        </div>
        <div className="p-3 grid grid-cols-2 md:grid-cols-3 gap-2">
          {article.archives.map(a => {
            const dotClass = a.status === 'success' ? 'archive-dot-success' : a.status === 'pending' ? 'archive-dot-pending' : a.status === 'failed' ? 'archive-dot-failed' : 'archive-dot-absent';
            const step = ARCHIVE_KEY_TO_STEP[a.key];
            const canRearchive = (a.status === 'failed' || a.status === 'absent') && step;
            const canView = a.status === 'success';

            return (
              <div key={a.key} className="tech-border p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`archive-dot ${dotClass}`} />
                  <span className="font-display text-[10px] font-semibold uppercase tracking-wider">{a.key}</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[10px] text-text-muted mb-2">
                  <span>{a.status}</span>
                  {a.compressed_size != null && <span>{formatBytes(a.compressed_size)}</span>}
                  {a.created_at && <span>{formatTimeShort(a.created_at)}</span>}
                </div>
                <div className="flex gap-1">
                  {canView && (
                    <button
                      onClick={() => setViewingArchive({ itemId: article.item_id, archiveKey: a.key })}
                      className="btn-tactical text-[9px] py-0.5 px-2"
                    >
                      VIEW
                    </button>
                  )}
                  {canRearchive && (
                    <button
                      onClick={() => handleArchiveAction('rearchive-step', article.url, article.item_id, step)}
                      className="btn-tactical text-[9px] py-0.5 px-2"
                    >
                      RE-ARCHIVE
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pipeline events */}
      {events.length > 0 && (
        <div className="tech-border">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase">
              Pipeline Events
            </span>
            <span className="font-mono text-[10px] text-text-muted">{events.length} events</span>
          </div>
          <div className="p-3">
            <Timeline events={events} />
          </div>
        </div>
      )}

      {/* Content viewer modal */}
      {viewingArchive && (
        <ContentViewer
          itemId={viewingArchive.itemId}
          archiveKey={viewingArchive.archiveKey}
          onClose={() => setViewingArchive(undefined)}
        />
      )}
    </div>
  );
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase mb-0.5">
        {label}
      </div>
      <div className="font-mono text-xs text-text-secondary">{children}</div>
    </div>
  );
}
