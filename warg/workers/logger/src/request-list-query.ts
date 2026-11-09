/** SQL condition for a row that no event has reached yet. */
export const NO_EVENT_CONDITION = "(last_event_ts IS NULL OR trim(last_event_ts) = '')";

export interface RequestListQuery {
  sql: string;
  bindings: (string | number)[];
}

/**
 * Builds the D1 query of GET /requests from its query string.
 *
 * Filters: domain, status (the stage), q (url substring), from and to
 * (created_at bounds), and events=none (only rows with no event yet).
 * Order: newest first, or oldest first with order=asc. Any other value of
 * events or order is ignored.
 */
export function buildRequestListQuery(params: URLSearchParams): RequestListQuery {
  const domain = params.get('domain');
  const status = params.get('status');
  const q = params.get('q');
  const from = params.get('from');
  const to = params.get('to');
  const limitVal = Math.min(Math.max(parseInt(params.get('limit') ?? '', 10) || 50, 1), 1000);
  const offsetVal = Math.min(Math.max(parseInt(params.get('offset') ?? '', 10) || 0, 0), 100000);

  let sql = 'SELECT * FROM requests_index';
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (domain) {
    conditions.push('domain = ?');
    bindings.push(domain);
  }
  if (status) {
    conditions.push('stage = ?');
    bindings.push(status);
  }
  if (q) {
    conditions.push("url LIKE '%' || ? || '%'");
    bindings.push(q);
  }
  if (from) {
    conditions.push('created_at >= ?');
    bindings.push(from);
  }
  if (to) {
    conditions.push('created_at <= ?');
    bindings.push(to);
  }
  if (params.get('events') === 'none') {
    conditions.push(NO_EVENT_CONDITION);
  }
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  const direction = params.get('order') === 'asc' ? 'ASC' : 'DESC';
  sql += ` ORDER BY created_at ${direction} LIMIT ? OFFSET ?`;
  bindings.push(limitVal, offsetVal);

  return { sql, bindings };
}
