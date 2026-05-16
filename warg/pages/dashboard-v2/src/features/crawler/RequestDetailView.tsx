import { useParams, useNavigate } from 'react-router';
import { useApi } from '@/hooks/useApi';
import { fetchRequestDetail } from '@/api/endpoints';
import { PipelineVisualizer } from '@/components/pipeline/PipelineVisualizer';
import { Timeline } from '@/components/pipeline/Timeline';
import { ArtifactsGrid } from '@/components/pipeline/ArtifactsGrid';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { CopyableText } from '@/components/ui/CopyableText';
import { LoadingState } from '@/components/ui/LoadingState';
import { formatTime, getDomain } from '@/lib/formatters';

export function RequestDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: req, loading, refetch } = useApi(
    () => fetchRequestDetail(id!),
    [id],
  );

  if (loading && !req) return <LoadingState />;
  if (!req) return <div className="font-mono text-xs text-text-muted">Request not found</div>;

  const stage = req.derived?.stage ?? 'queued';
  const events = req.events ?? [];
  const artifacts = req.artifacts ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/crawler')}
          className="btn-tactical text-[10px]"
        >
          &lt; BACK
        </button>
        <h2 className="font-display text-sm font-bold tracking-widest uppercase">Request Detail</h2>
        <button onClick={refetch} className="btn-tactical text-[10px] ml-auto">REFRESH</button>
      </div>

      <PipelineVisualizer events={events} />

      {/* Header metadata */}
      <div className="tech-border p-4">
        <div className="font-mono text-sm text-text-primary mb-3 break-all">
          {req.url || 'Unknown URL'}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetaItem label="Request ID">
            <CopyableText text={req.requestId} display={req.requestId} />
          </MetaItem>
          <MetaItem label="Domain">{getDomain(req.url)}</MetaItem>
          <MetaItem label="Status"><StatusBadge status={stage} /></MetaItem>
          <MetaItem label="Created">{formatTime(req.createdAt)}</MetaItem>
        </div>
      </div>

      {/* Events */}
      <div className="tech-border">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase">
            Events Timeline
          </span>
          <span className="font-mono text-[10px] text-text-muted">{events.length} events</span>
        </div>
        <div className="p-3">
          <Timeline events={events} />
        </div>
      </div>

      {/* Artifacts */}
      <div className="tech-border">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase">
            Artifacts
          </span>
          <span className="font-mono text-[10px] text-text-muted">{artifacts.length}</span>
        </div>
        <div className="p-3">
          <ArtifactsGrid artifacts={artifacts} />
        </div>
      </div>
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
