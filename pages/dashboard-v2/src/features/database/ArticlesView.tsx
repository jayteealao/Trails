import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '@/hooks/useApi';
import { useInterval } from '@/hooks/useInterval';
import { useSettings } from '@/hooks/useSettings';
import { useDebounce } from '@/hooks/useDebounce';
import { fetchArticles } from '@/api/endpoints';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { FilterBar, FilterInput, FilterSelect } from '@/components/ui/FilterBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ArchiveIndicators } from '@/components/ui/ArchiveIndicators';
import { LoadingState } from '@/components/ui/LoadingState';
import { formatTimeShort, truncateUrl } from '@/lib/formatters';
import type { Article } from '@/api/types';

const CLASSIFICATION_OPTIONS = [
  { value: '', label: 'All Classifications' },
  { value: 'complete', label: 'Complete' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'failed', label: 'Failed' },
  { value: 'unarchived', label: 'Unarchived' },
];

const PAGE_LIMIT = 50;

export function ArticlesView() {
  const [filter, setFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const { settings } = useSettings();

  const debouncedSearch = useDebounce(searchText, 300);

  const { data, loading, refetch } = useApi(
    () => fetchArticles({
      page,
      limit: PAGE_LIMIT,
      filter: filter || undefined,
      search: debouncedSearch || undefined,
    }),
    [page, filter, debouncedSearch],
  );

  useInterval(refetch, settings.autoRefresh ? settings.refreshInterval * 1000 : null);

  const articles = data?.articles ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;

  const start = (page - 1) * PAGE_LIMIT + 1;
  const end = start + articles.length - 1;
  const paginationInfo = articles.length > 0
    ? `${start}-${end} of ${total}`
    : 'No results';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold tracking-widest uppercase">Articles</h2>
        <button onClick={refetch} className="btn-tactical text-[10px]">REFRESH</button>
      </div>

      <FilterBar>
        <FilterInput
          placeholder="Search articles..."
          value={searchText}
          onChange={v => { setSearchText(v); setPage(1); }}
        />
        <FilterSelect
          value={filter}
          onChange={v => { setFilter(v); setPage(1); }}
          options={CLASSIFICATION_OPTIONS}
        />
      </FilterBar>

      {loading && articles.length === 0 ? (
        <LoadingState />
      ) : (
        <>
          <div className="tech-border">
            <DataTable
              columns={articleColumns}
              rows={articles}
              onRowClick={a => navigate(`/database/articles/${a.item_id}`)}
              emptyMessage="No articles found"
            />
          </div>
          <Pagination
            info={paginationInfo}
            canPrev={page > 1}
            canNext={hasMore}
            onPrev={() => setPage(p => Math.max(1, p - 1))}
            onNext={() => setPage(p => p + 1)}
          />
        </>
      )}
    </div>
  );
}

const articleColumns: Column<Article>[] = [
  {
    key: 'title',
    label: 'Title / URL',
    render: a => (
      <span className="truncate block max-w-[300px]" title={a.url}>
        {a.title ? truncateUrl(a.title, 60) : truncateUrl(a.url, 60)}
      </span>
    ),
  },
  { key: 'domain', label: 'Domain', render: a => a.domain },
  { key: 'classification', label: 'Classification', render: a => <StatusBadge status={a.archive_classification} /> },
  { key: 'archives', label: 'Archives', render: a => <ArchiveIndicators archives={a.archives} /> },
  { key: 'created', label: 'Created', render: a => formatTimeShort(a.created_at) },
];
