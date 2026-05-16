import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '@/hooks/useApi';
import { useInterval } from '@/hooks/useInterval';
import { useSettings } from '@/hooks/useSettings';
import { useDebounce } from '@/hooks/useDebounce';
import { fetchRequests } from '@/api/endpoints';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { FilterBar, FilterInput, FilterSelect } from '@/components/ui/FilterBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingState } from '@/components/ui/LoadingState';
import { formatTimeShort, truncateUrl, getDomain } from '@/lib/formatters';
import { PAGE_SIZE } from '@/lib/constants';
import type { ArchiveRequest } from '@/api/types';

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'queued', label: 'Queued' },
  { value: 'rendering', label: 'Rendering' },
  { value: 'deriving', label: 'Deriving' },
  { value: 'persisting', label: 'Persisting' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
];

export function RequestsView() {
  const [domain, setDomain] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' }>({ column: 'created', direction: 'desc' });

  const debouncedDomain = useDebounce(domain, 300);
  const navigate = useNavigate();
  const { settings } = useSettings();

  const { data, loading, refetch } = useApi(
    () => fetchRequests({ domain: debouncedDomain || undefined, status: status || undefined, limit: PAGE_SIZE, offset }),
    [debouncedDomain, status, offset],
  );

  useInterval(refetch, settings.autoRefresh ? settings.refreshInterval * 1000 : null);

  const requests = data?.requests ?? [];
  const count = data?.meta?.count ?? requests.length;
  const hasMore = count >= PAGE_SIZE;

  const handleSort = useCallback((column: string) => {
    setSort(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  const sorted = [...requests].sort((a, b) => {
    const dir = sort.direction === 'asc' ? 1 : -1;
    const aVal = getSortValue(a, sort.column);
    const bVal = getSortValue(b, sort.column);
    return aVal < bVal ? -dir : aVal > bVal ? dir : 0;
  });

  const paginationInfo = requests.length > 0
    ? `${offset + 1}-${offset + requests.length} of ${hasMore ? offset + count + '+' : offset + count}`
    : 'No results';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold tracking-widest uppercase">Requests</h2>
        <button onClick={refetch} className="btn-tactical text-[10px]">REFRESH</button>
      </div>

      <FilterBar>
        <FilterInput placeholder="Filter by domain..." value={domain} onChange={v => { setDomain(v); setOffset(0); }} />
        <FilterSelect value={status} onChange={v => { setStatus(v); setOffset(0); }} options={STATUS_OPTIONS} />
      </FilterBar>

      {loading && requests.length === 0 ? (
        <LoadingState />
      ) : (
        <>
          <div className="tech-border">
            <DataTable
              columns={requestColumns}
              rows={sorted}
              onRowClick={r => navigate(`/crawler/requests/${r.requestId}`)}
              sort={sort}
              onSort={handleSort}
              emptyMessage="No requests found"
            />
          </div>
          <Pagination
            info={paginationInfo}
            canPrev={offset > 0}
            canNext={hasMore}
            onPrev={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            onNext={() => setOffset(offset + PAGE_SIZE)}
          />
        </>
      )}
    </div>
  );
}

function getSortValue(req: ArchiveRequest, column: string): string {
  switch (column) {
    case 'id': return req.requestId;
    case 'url': return req.url ?? '';
    case 'domain': return req.domain || getDomain(req.url);
    case 'status': return req.stage ?? '';
    case 'created': return req.createdAt ?? '';
    default: return '';
  }
}

const requestColumns: Column<ArchiveRequest>[] = [
  { key: 'id', label: 'ID', sortable: true, render: r => <span className="font-mono text-text-muted">{r.requestId.slice(0, 8)}</span> },
  { key: 'url', label: 'URL', sortable: true, render: r => <span className="truncate block max-w-[300px]" title={r.url}>{truncateUrl(r.url, 60)}</span> },
  { key: 'domain', label: 'Domain', sortable: true, render: r => r.domain || getDomain(r.url) },
  { key: 'status', label: 'Status', sortable: true, render: r => <StatusBadge status={r.stage} /> },
  { key: 'errors', label: 'Errors', align: 'right', render: r => r.errorCount > 0 ? <span className="text-accent-red">{r.errorCount}</span> : <span className="text-text-muted">0</span> },
  { key: 'created', label: 'Created', sortable: true, render: r => formatTimeShort(r.createdAt) },
];
