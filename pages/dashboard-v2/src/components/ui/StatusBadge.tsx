import type { Stage } from '@/api/types';

const STYLE_MAP: Record<string, string> = {
  done: 'tag-done',
  failed: 'tag-failed',
  rendering: 'tag-rendering',
  deriving: 'tag-deriving',
  persisting: 'tag-persisting',
  queued: 'tag-queued',
  // Article classifications
  complete: 'tag-done',
  incomplete: 'tag-rendering',
  unarchived: 'tag-queued',
};

const LED_MAP: Record<string, string> = {
  done: 'led-on',
  failed: 'led-error',
  rendering: 'led-on',
  deriving: 'led-on',
  persisting: 'led-warn',
  queued: 'led-off',
  complete: 'led-on',
  incomplete: 'led-warn',
  unarchived: 'led-off',
};

export function StatusBadge({ status }: { status: Stage | string }) {
  const tagClass = STYLE_MAP[status] ?? 'tag-queued';
  const ledClass = LED_MAP[status] ?? 'led-off';

  return (
    <span className={`tag-status ${tagClass}`}>
      <span className={`led ${ledClass}`} />
      {status}
    </span>
  );
}
