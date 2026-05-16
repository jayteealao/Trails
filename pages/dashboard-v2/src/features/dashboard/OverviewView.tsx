import { useApi } from '@/hooks/useApi';
import { useInterval } from '@/hooks/useInterval';
import { useSettings } from '@/hooks/useSettings';
import { fetchStats } from '@/api/endpoints';
import { MetricsStrip } from '@/components/ui/MetricsStrip';
import { LoadingState } from '@/components/ui/LoadingState';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { formatTimeShort, truncateUrl, formatNumber } from '@/lib/formatters';
import { useNavigate } from 'react-router';
import type { StatsResponse } from '@/api/types';

export function OverviewView() {
  const { data: stats, loading, refetch } = useApi(fetchStats, []);
  const { settings } = useSettings();
  const navigate = useNavigate();

  useInterval(refetch, settings.autoRefresh ? settings.refreshInterval * 1000 : null);

  if (loading && !stats) return <LoadingState />;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Overview" onRefresh={refetch} />

      {stats && (
        <>
          <MetricsStrip
            metrics={[
              { label: 'Total', value: formatNumber(stats.total) },
              { label: 'Success Rate', value: `${(stats.successRate * 100).toFixed(1)}%`, variant: 'green' },
              { label: 'Active', value: formatNumber(stats.activeCount), variant: 'cyan' },
              { label: 'Stuck', value: formatNumber(stats.stuckCount), variant: stats.stuckCount > 0 ? 'amber' : 'default' },
              { label: 'Last 1h', value: formatNumber(stats.recentActivity.last1h) },
              { label: 'Last 24h', value: formatNumber(stats.recentActivity.last24h) },
            ]}
          />

          <SegmentedBar byStage={stats.byStage} total={stats.total} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Top Domains">
              <TopDomainsTable domains={stats.topDomains} />
            </Card>

            <Card title="Recent Failures">
              <FailuresTable
                failures={stats.recentFailures}
                onSelect={id => navigate(`/crawler/requests/${id}`)}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function SectionHeader({ title, onRefresh }: { title: string; onRefresh: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-display text-sm font-bold tracking-widest uppercase">{title}</h2>
      <button onClick={onRefresh} className="btn-tactical text-[10px]">
        REFRESH
      </button>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tech-border">
      <div className="px-3 py-2 border-b border-border">
        <span className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase">
          {title}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function SegmentedBar({ byStage, total }: { byStage: Record<string, number>; total: number }) {
  if (!byStage || total === 0) return null;

  const stages = Object.entries(byStage).sort((a, b) => b[1] - a[1]);
  const COLORS: Record<string, string> = {
    done: '#ffffff',
    failed: '#ef4444',
    rendering: '#06b6d4',
    deriving: '#a855f7',
    persisting: '#f59e0b',
    queued: '#666666',
  };

  return (
    <div className="tech-border p-3">
      <div className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase mb-2">
        Pipeline Distribution
      </div>
      <div className="progress-segmented">
        {stages.map(([stage, count]) => (
          <div
            key={stage}
            className="progress-segment"
            style={{
              width: `${(count / total) * 100}%`,
              background: COLORS[stage] ?? '#666',
            }}
            title={`${stage}: ${count} (${((count / total) * 100).toFixed(1)}%)`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-2">
        {stages.map(([stage, count]) => (
          <span key={stage} className="flex items-center gap-1 font-mono text-[10px] text-text-muted">
            <span
              className="w-2 h-2 inline-block"
              style={{ background: COLORS[stage] ?? '#666' }}
            />
            {stage} {count} ({((count / total) * 100).toFixed(1)}%)
          </span>
        ))}
      </div>
    </div>
  );
}

const domainColumns: Column<{ domain: string; count: number }>[] = [
  { key: 'domain', label: 'Domain', render: r => r.domain },
  { key: 'count', label: 'Count', align: 'right', render: r => r.count.toLocaleString() },
];

function TopDomainsTable({ domains }: { domains: StatsResponse['topDomains'] }) {
  return <DataTable columns={domainColumns} rows={domains} emptyMessage="No domains" />;
}

const failureColumns: Column<{ requestId: string; url: string; createdAt: string }>[] = [
  { key: 'url', label: 'URL', render: r => <span className="truncate block max-w-[200px]">{truncateUrl(r.url, 40)}</span> },
  { key: 'id', label: 'ID', render: r => r.requestId.slice(0, 8) },
  { key: 'time', label: 'Time', render: r => formatTimeShort(r.createdAt) },
];

function FailuresTable({
  failures,
  onSelect,
}: {
  failures: StatsResponse['recentFailures'];
  onSelect: (id: string) => void;
}) {
  return (
    <DataTable
      columns={failureColumns}
      rows={failures}
      onRowClick={r => onSelect(r.requestId)}
      emptyMessage="No failures"
    />
  );
}
