import { formatBytes } from '@/lib/formatters';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Artifact } from '@/api/types';

export function ArtifactsGrid({ artifacts }: { artifacts: Artifact[] }) {
  if (artifacts.length === 0) return <EmptyState message="No artifacts generated" />;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {artifacts.map((a, i) => (
        <div key={i} className="tech-border p-3">
          <div className="font-display text-[10px] font-semibold uppercase tracking-wider text-text-primary mb-1">
            {a.kind || 'unknown'}
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] text-text-muted">
            {a.bytes != null && <span>{formatBytes(a.bytes)}</span>}
            {a.contentType && <span>{a.contentType}</span>}
          </div>
          {a.r2Key && (
            <div className="font-mono text-[9px] text-text-muted mt-1 truncate" title={a.r2Key}>
              {a.r2Key}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
