import { useApi } from '@/hooks/useApi';
import { useInterval } from '@/hooks/useInterval';
import { useSettings } from '@/hooks/useSettings';
import { fetchStats, fetchRequests, fetchRequestDetail } from '@/api/endpoints';
import { MetricsStrip } from '@/components/ui/MetricsStrip';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LoadingState } from '@/components/ui/LoadingState';
import { formatTimeShort, truncateUrl } from '@/lib/formatters';
import { useNavigate } from 'react-router';
import { useState, useEffect, useCallback } from 'react';

interface ErrorData {
  totalFailed: number;
  failureRate: string;
  errorsBySource: Record<string, number>;
  errorPatterns: { message: string; count: number; requestIds: string[] }[];
  failedRequests: { requestId: string; url: string; createdAt: string }[];
}

export function ErrorsView() {
  const [errorData, setErrorData] = useState<ErrorData | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const { settings } = useSettings();
  const navigate = useNavigate();

  const loadErrors = useCallback(async () => {
    setLoading(true);
    try {
      const [stats, failedData] = await Promise.all([
        fetchStats(),
        fetchRequests({ status: 'failed', limit: 50 }),
      ]);

      const failedRequests = failedData.requests ?? [];

      const detailPromises = failedRequests.slice(0, 10).map(r =>
        fetchRequestDetail(r.requestId).catch(() => null),
      );
      const details = await Promise.all(detailPromises);

      const errorsBySource: Record<string, number> = {};
      const patternMap: Record<string, { message: string; count: number; requestIds: string[] }> = {};

      for (const detail of details) {
        if (!detail) continue;
        const errorEvents = (detail.events ?? []).filter(e => e.level === 'error');
        for (const ev of errorEvents) {
          const src = ev.source || 'unknown';
          errorsBySource[src] = (errorsBySource[src] ?? 0) + 1;

          const key = (ev.message || 'Unknown error').slice(0, 80);
          if (!patternMap[key]) {
            patternMap[key] = { message: key, count: 0, requestIds: [] };
          }
          patternMap[key].count++;
          if (!patternMap[key].requestIds.includes(detail.requestId)) {
            patternMap[key].requestIds.push(detail.requestId);
          }
        }
      }

      const totalFailed = stats.byStage?.['failed'] ?? 0;
      const failureRate = stats.total > 0 ? ((totalFailed / stats.total) * 100).toFixed(1) : '0.0';

      setErrorData({
        totalFailed,
        failureRate,
        errorsBySource,
        errorPatterns: Object.values(patternMap).sort((a, b) => b.count - a.count),
        failedRequests,
      });
    } catch {
      // keep showing previous data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadErrors(); }, [loadErrors]);
  useInterval(loadErrors, settings.autoRefresh ? settings.refreshInterval * 1000 : null);

  if (loading && !errorData) return <LoadingState />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold tracking-widest uppercase">Errors</h2>
        <button onClick={loadErrors} className="btn-tactical text-[10px]">REFRESH</button>
      </div>

      {errorData && (
        <>
          <MetricsStrip
            metrics={[
              { label: 'Total Failed', value: errorData.totalFailed, variant: 'red' },
              { label: 'Failure Rate', value: `${errorData.failureRate}%`, variant: 'red' },
              { label: 'Error Sources', value: Object.keys(errorData.errorsBySource).length },
              { label: 'Patterns', value: errorData.errorPatterns.length },
            ]}
          />

          <ErrorsBySourceCard sources={errorData.errorsBySource} />
          <ErrorPatternsCard patterns={errorData.errorPatterns} />

          <div className="tech-border">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <span className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase">
                Failed Requests
              </span>
              <span className="font-mono text-[10px] text-text-muted">{errorData.failedRequests.length}</span>
            </div>
            <div className="p-0">
              <DataTable
                columns={failedColumns}
                rows={errorData.failedRequests}
                onRowClick={r => navigate(`/crawler/requests/${r.requestId}`)}
                emptyMessage="No failed requests"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const failedColumns: Column<{ requestId: string; url: string; createdAt: string }>[] = [
  { key: 'id', label: 'ID', render: r => r.requestId.slice(0, 8) },
  { key: 'url', label: 'URL', render: r => <span className="truncate block max-w-[300px]">{truncateUrl(r.url, 50)}</span> },
  { key: 'time', label: 'Created', render: r => formatTimeShort(r.createdAt) },
];

function ErrorsBySourceCard({ sources }: { sources: Record<string, number> }) {
  const entries = Object.entries(sources).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  const max = entries[0]?.[1] ?? 1;

  return (
    <div className="tech-border">
      <div className="px-3 py-2 border-b border-border">
        <span className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase">
          Errors by Source
        </span>
      </div>
      <div className="p-3">
        {entries.map(([source, count]) => (
          <div key={source} className="flex items-center gap-3 py-1">
            <span className="font-mono text-[11px] text-text-secondary w-24">{source}</span>
            <span className="font-mono text-[11px] text-text-muted w-8 text-right">{count}</span>
            <div className="flex-1 h-2 bg-bg-elevated border border-border">
              <div
                className="h-full bg-accent-red"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorPatternsCard({ patterns }: { patterns: { message: string; count: number; requestIds: string[] }[] }) {
  if (patterns.length === 0) return null;

  return (
    <div className="tech-border">
      <div className="px-3 py-2 border-b border-border">
        <span className="font-display text-[10px] font-semibold tracking-widest text-text-muted uppercase">
          Error Patterns
        </span>
      </div>
      <div className="p-3 flex flex-col gap-2">
        {patterns.map((p, i) => (
          <div key={i} className="border-b border-border pb-2 last:border-0">
            <div className="font-mono text-[11px] text-text-secondary">{p.message}</div>
            <div className="flex items-center gap-3 mt-1 font-mono text-[10px] text-text-muted">
              <span>Count: {p.count}</span>
              <span>
                Requests: {p.requestIds.slice(0, 3).map(id => id.slice(0, 8)).join(', ')}
                {p.requestIds.length > 3 ? '...' : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
