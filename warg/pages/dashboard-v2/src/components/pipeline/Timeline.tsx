import { formatTime } from '@/lib/formatters';
import { EmptyState } from '@/components/ui/EmptyState';
import type { PipelineEvent } from '@/api/types';

export function Timeline({ events }: { events: PipelineEvent[] }) {
  if (events.length === 0) return <EmptyState message="No events recorded" />;

  const sorted = [...events].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );

  return (
    <div className="flex flex-col gap-0">
      {sorted.map((event, i) => {
        const levelColor =
          event.level === 'error'
            ? 'border-accent-red'
            : event.level === 'warn'
              ? 'border-accent-amber'
              : 'border-border';

        return (
          <div key={i} className={`flex gap-3 py-2 border-l-2 pl-3 ${levelColor}`}>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-display text-[10px] font-semibold text-text-muted uppercase">
                  {event.source || 'system'}
                </span>
                <span className="font-mono text-[10px] text-text-muted">
                  {event.type || 'unknown'}
                </span>
                <span className="font-mono text-[10px] text-text-muted ml-auto flex-shrink-0">
                  {formatTime(event.ts)}
                </span>
              </div>
              {event.message && (
                <div className="font-mono text-[11px] text-text-secondary">
                  {event.message}
                </div>
              )}
              {event.data && (
                <pre className="font-mono text-[10px] text-text-muted mt-1 overflow-x-auto max-w-full">
                  {JSON.stringify(event.data, null, 2)}
                </pre>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
