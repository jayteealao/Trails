import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  sort?: { column: string; direction: 'asc' | 'desc' };
  onSort?: (column: string) => void;
  emptyMessage?: string;
}

export function DataTable<T>({
  columns,
  rows,
  onRowClick,
  sort,
  onSort,
  emptyMessage = 'No data',
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-6">
        <span className="font-mono text-xs text-text-muted">{emptyMessage}</span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map(col => {
              const isSorted = sort?.column === col.key;
              const arrow = isSorted ? (sort.direction === 'asc' ? ' \u25B2' : ' \u25BC') : '';

              return (
                <th
                  key={col.key}
                  className={[
                    col.align === 'right' ? 'text-right' : '',
                    col.sortable ? 'sortable' : '',
                  ].join(' ')}
                  onClick={col.sortable && onSort ? () => onSort(col.key) : undefined}
                >
                  {col.label}{arrow}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={onRowClick ? 'clickable' : ''}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map(col => (
                <td key={col.key} className={col.align === 'right' ? 'text-right' : ''}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
