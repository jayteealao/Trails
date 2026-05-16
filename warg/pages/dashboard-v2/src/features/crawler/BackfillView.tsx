import { useApi } from '@/hooks/useApi';
import { useInterval } from '@/hooks/useInterval';
import { useSettings } from '@/hooks/useSettings';
import { fetchBackfill } from '@/api/endpoints';
import { MetricsStrip } from '@/components/ui/MetricsStrip';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatNumber, truncateUrl, formatFirestoreTimestamp } from '@/lib/formatters';
import type { BackfillBatchItem } from '@/api/types';

export function BackfillView() {
  const { data: backfill, loading, refetch } = useApi(fetchBackfill, []);
  const { settings } = useSettings();

  useInterval(refetch, settings.autoRefresh ? settings.refreshInterval * 1000 : null);

  if (loading && !backfill) return <LoadingState />;

  if (!backfill || backfill.status === 'not_initialized') {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-sm font-bold tracking-widest uppercase">Backfill</h2>
        <EmptyState message="Backfill not initialized" />
      </div>
    );
  }

  const t = backfill.tracker;
  if (!t) return <EmptyState message="No tracker data" />;

  const isPaused = t.consecutive_all_failed >= 2;

  const LED_MAP: Record<string, string> = {
    sent_batch: 'archive-dot-success',
    waiting: 'archive-dot-pending',
    settled: 'archive-dot-success',
    idle: 'archive-dot-absent',
    backoff: 'archive-dot-failed',
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold tracking-widest uppercase">Backfill</h2>
        <button onClick={refetch} className="btn-tactical text-[10px]">REFRESH</button>
      </div>

      {isPaused && (
        <div className="tech-border border-accent-red p-3">
          <div className="flex items-center gap-3">
            <span className="led led-error" />
            <span className="font-display text-xs font-bold text-accent-red tracking-wider uppercase">PAUSED</span>
            <span className="font-mono text-[10px] text-text-muted">
              Consecutive failures: {t.consecutive_all_failed}
            </span>
          </div>
        </div>
      )}

      <MetricsStrip
        metrics={[
          {
            label: 'Run Result',
            value: t.last_run_result ?? '--',
          },
          { label: 'Batch #', value: t.batch_number ?? '--' },
          { label: 'Batch Size', value: t.batch?.length ?? 0, variant: 'cyan' },
          { label: 'Total Sent', value: formatNumber(t.total_sent) },
          { label: 'Total Complete', value: formatNumber(t.total_completed), variant: 'green' },
          { label: 'Total Failed', value: formatNumber(t.total_failed), variant: t.total_failed > 0 ? 'red' : 'default' },
        ]}
      />

      <div className="tech-border">
        <div className="grid grid-cols-3 gap-0">
          <InfoCell label="Last Run" value={formatFirestoreTimestamp(t.last_run_at)} />
          <InfoCell label="Batch Started" value={formatFirestoreTimestamp(t.batch_started_at)} />
          <InfoCell
            label="Consecutive Failures"
            value={String(t.consecutive_all_failed)}
            color={t.consecutive_all_failed > 0 ? 'text-accent-amber' : undefined}
          />
        </div>
      </div>

      <div className="tech-border">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase">
            Current Batch Items
          </span>
          <span className="font-mono text-[10px] text-text-muted">{t.batch?.length ?? 0} items</span>
        </div>
        {t.batch && t.batch.length > 0 ? (
          <DataTable columns={batchColumns} rows={t.batch} emptyMessage="No active batch" />
        ) : (
          <EmptyState message="No active batch" />
        )}
      </div>

      {/* Run result LED indicator */}
      <div className="flex items-center gap-2 font-mono text-[10px] text-text-muted">
        <span className={`archive-dot ${LED_MAP[t.last_run_result] ?? 'archive-dot-absent'}`} />
        <span>Last result: {t.last_run_result ?? '--'}</span>
      </div>
    </div>
  );
}

function InfoCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="p-3 border-r border-border last:border-r-0">
      <div className="font-display text-[10px] text-text-muted uppercase tracking-wider">{label}</div>
      <div className={`font-mono text-xs ${color ?? 'text-text-secondary'}`}>{value}</div>
    </div>
  );
}

const batchColumns: Column<BackfillBatchItem>[] = [
  { key: 'url', label: 'URL', render: r => <span className="truncate block max-w-[400px]" title={r.url}>{truncateUrl(r.url, 60)}</span> },
  { key: 'retries', label: 'Retries', align: 'right', render: r => String(r.retry_count) },
  { key: 'sent', label: 'Sent At', render: r => formatFirestoreTimestamp(r.sent_at) },
];
