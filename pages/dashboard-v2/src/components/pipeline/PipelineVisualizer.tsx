import { PIPELINE_STEPS } from '@/lib/constants';
import { derivePipelineState, type StepStatus } from '@/lib/pipeline';
import { formatDuration } from '@/lib/formatters';
import type { PipelineEvent } from '@/api/types';

const STATUS_CLASSES: Record<StepStatus, string> = {
  pending: 'border-text-muted bg-transparent',
  running: 'border-accent-cyan bg-accent-cyan/20 animate-pulse-dot',
  complete: 'border-white bg-white',
  failed: 'border-accent-red bg-accent-red',
};

export function PipelineVisualizer({ events }: { events: PipelineEvent[] }) {
  const steps = derivePipelineState(events);

  return (
    <div className="tech-border p-4">
      <div className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase mb-3">
        Pipeline
      </div>
      <div className="flex items-center gap-0">
        {PIPELINE_STEPS.map((def, i) => {
          const s = steps[def.id];
          if (!s) return null;
          const nodeClass = STATUS_CLASSES[s.status];

          return (
            <div key={def.id} className="flex items-center">
              {/* Node */}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-4 h-4 rounded-full border-2 ${nodeClass} flex items-center justify-center`}
                  title={`${def.label}: ${s.status}`}
                >
                  {s.status === 'complete' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-black" />
                  )}
                </div>
                <span className="font-mono text-[9px] text-text-muted whitespace-nowrap">
                  {def.label}
                </span>
                {s.elapsed != null && (
                  <span className="font-mono text-[8px] text-text-muted">
                    {formatDuration(s.elapsed)}
                  </span>
                )}
                {s.attempts > 1 && (
                  <span className="font-mono text-[8px] text-accent-amber">
                    x{s.attempts}
                  </span>
                )}
              </div>

              {/* Connector */}
              {i < PIPELINE_STEPS.length - 1 && (
                <div
                  className={`w-8 h-px mx-1 ${
                    s.status === 'complete' ? 'bg-white' : 'bg-border'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
