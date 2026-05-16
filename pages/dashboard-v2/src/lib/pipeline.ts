import { PIPELINE_STEPS } from './constants';
import type { PipelineEvent } from '@/api/types';

export type StepStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface StepState {
  status: StepStatus;
  startedAt: string | null;
  completedAt: string | null;
  elapsed: number | null;
  attempts: number;
  error: string | null;
}

export function derivePipelineState(
  events: PipelineEvent[],
): Record<string, StepState> {
  const steps: Record<string, StepState> = {};

  for (const step of PIPELINE_STEPS) {
    steps[step.id] = {
      status: 'pending',
      startedAt: null,
      completedAt: null,
      elapsed: null,
      attempts: 0,
      error: null,
    };
  }

  for (const event of events) {
    const step = PIPELINE_STEPS.find(s => s.source === event.source);
    if (!step) continue;

    const s = steps[step.id];
    if (!s) continue;

    if (event.type === 'step.started') {
      s.status = 'running';
      s.startedAt = s.startedAt ?? event.ts;
      s.attempts++;
    } else if (event.type === 'step.completed') {
      s.status = 'complete';
      s.completedAt = event.ts;
      if (s.startedAt) {
        s.elapsed = new Date(event.ts).getTime() - new Date(s.startedAt).getTime();
      }
    } else if (event.type === 'step.failed') {
      s.status = 'failed';
      s.completedAt = event.ts;
      s.error = event.message || 'Failed';
      if (s.startedAt) {
        s.elapsed = new Date(event.ts).getTime() - new Date(s.startedAt).getTime();
      }
    }
  }

  return steps;
}
