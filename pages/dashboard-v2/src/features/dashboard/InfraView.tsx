import { useApi } from '@/hooks/useApi';
import { useInterval } from '@/hooks/useInterval';
import { useSettings } from '@/hooks/useSettings';
import { fetchInfra } from '@/api/endpoints';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LoadingState } from '@/components/ui/LoadingState';
import { formatNumber, formatBytes } from '@/lib/formatters';
import type { WorkerMetric, InfraResponse } from '@/api/types';

export function InfraView() {
  const { data: infra, loading, refetch } = useApi(fetchInfra, []);
  const { settings } = useSettings();

  useInterval(refetch, settings.autoRefresh ? settings.refreshInterval * 1000 : null);

  if (loading && !infra) return <LoadingState />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold tracking-widest uppercase">Infrastructure</h2>
        <button onClick={refetch} className="btn-tactical text-[10px]">REFRESH</button>
      </div>

      {infra && (
        <>
          <Card title="Workers">
            <DataTable
              columns={workerColumns}
              rows={infra.workers}
              emptyMessage="No worker data"
            />
          </Card>

          <Card title="Workflows">
            <WorkflowsMetrics workflows={infra.workflows} />
          </Card>

          <Card title="Storage">
            <StorageMetrics infra={infra} />
          </Card>
        </>
      )}
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
      <div className="p-0">{children}</div>
    </div>
  );
}

const workerColumns: Column<WorkerMetric>[] = [
  { key: 'name', label: 'Worker', render: r => r.scriptName },
  { key: 'requests', label: 'Requests', align: 'right', render: r => formatNumber(r.requests) },
  {
    key: 'errorRate',
    label: 'Error Rate',
    align: 'right',
    render: r => {
      const rate = r.requests > 0 ? ((r.errors / r.requests) * 100).toFixed(1) : '0.0';
      const color = parseFloat(rate) > 5 ? 'text-accent-red' : parseFloat(rate) > 1 ? 'text-accent-amber' : 'text-text-secondary';
      return <span className={color}>{rate}%</span>;
    },
  },
  { key: 'cpuP50', label: 'CPU p50', align: 'right', render: r => r.cpuP50 != null ? `${r.cpuP50}ms` : '--' },
  { key: 'cpuP99', label: 'CPU p99', align: 'right', render: r => r.cpuP99 != null ? `${r.cpuP99}ms` : '--' },
  {
    key: 'health',
    label: 'Health',
    render: r => {
      const rate = r.requests > 0 ? (r.errors / r.requests) * 100 : 0;
      const cls = rate > 5 ? 'archive-dot-failed' : rate > 1 ? 'archive-dot-pending' : 'archive-dot-success';
      return <span className={`archive-dot ${cls}`} />;
    },
  },
];

function WorkflowsMetrics({ workflows }: { workflows: InfraResponse['workflows'] }) {
  const entries = Object.entries(workflows.statusCounts);
  if (entries.length === 0) {
    return <div className="p-3 font-mono text-xs text-text-muted">No workflow instances</div>;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-0">
      {entries.map(([status, count]) => {
        const color = status === 'errored' ? 'text-accent-red' : (status === 'running' || status === 'queued') ? 'text-accent-cyan' : 'text-text-primary';
        return (
          <div key={status} className="p-3 border-r border-b border-border last:border-r-0">
            <div className={`font-mono text-lg font-bold ${color}`}>{count}</div>
            <div className="font-display text-[10px] text-text-muted uppercase tracking-wider">{status}</div>
          </div>
        );
      })}
    </div>
  );
}

function StorageMetrics({ infra }: { infra: InfraResponse }) {
  const cells: { label: string; value: string }[] = [];

  if (infra.d1) {
    cells.push({ label: 'D1 Queries', value: formatNumber(infra.d1.queryCount) });
    cells.push({ label: 'D1 Rows', value: formatNumber(infra.d1.rowsRead) });
    cells.push({ label: 'D1 Size', value: infra.d1.databaseSize ? formatBytes(infra.d1.databaseSize) : '--' });
  }

  if (infra.r2) {
    cells.push({ label: 'R2 Size', value: infra.r2.bucketSize ? formatBytes(infra.r2.bucketSize) : '--' });
    cells.push({ label: 'R2 Objects', value: formatNumber(infra.r2.objectCount) });
    cells.push({ label: 'R2 Ops', value: formatNumber(infra.r2.operationCount) });
  }

  if (infra.durableObjects) {
    cells.push({ label: 'DO Storage', value: infra.durableObjects.storageBytes ? formatBytes(infra.durableObjects.storageBytes) : '--' });
    cells.push({ label: 'DO Requests', value: formatNumber(infra.durableObjects.requestCount) });
  }

  if (cells.length === 0) {
    return <div className="p-3 font-mono text-xs text-text-muted">No storage data</div>;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-0">
      {cells.map(c => (
        <div key={c.label} className="p-3 border-r border-b border-border last:border-r-0">
          <div className="font-mono text-lg font-bold text-text-primary">{c.value}</div>
          <div className="font-display text-[10px] text-text-muted uppercase tracking-wider">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
