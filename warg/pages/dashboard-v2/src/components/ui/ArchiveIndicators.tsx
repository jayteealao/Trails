import type { ArchiveEntry } from '@/api/types';

const DOT_CLASS: Record<string, string> = {
  success: 'archive-dot-success',
  pending: 'archive-dot-pending',
  failed: 'archive-dot-failed',
  absent: 'archive-dot-absent',
};

export function ArchiveIndicators({ archives }: { archives: ArchiveEntry[] }) {
  if (archives.length === 0) {
    return <span className="text-text-muted text-[10px]">--</span>;
  }

  return (
    <div className="flex items-center gap-1">
      {archives.map(a => (
        <div
          key={a.key}
          className={`archive-dot ${DOT_CLASS[a.status] ?? 'archive-dot-absent'}`}
          title={`${a.key}: ${a.status}`}
        />
      ))}
    </div>
  );
}
