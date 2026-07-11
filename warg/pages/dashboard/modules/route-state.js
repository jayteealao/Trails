// @ts-check

export const TOP_LEVEL_VIEWS = Object.freeze([
  'inbox',
  'overview',
  'feed',
  'requests',
  'errors',
  'articles',
  'backfill',
  'infra',
]);

const ALL_VIEWS = new Set([...TOP_LEVEL_VIEWS, 'detail', 'articleDetail']);
const TOP_LEVEL_VIEW_SET = new Set(TOP_LEVEL_VIEWS);
const REQUEST_SORT_SET = new Set(['id', 'url', 'domain', 'status', 'created']);
const SORT_DIR_SET = new Set(['asc', 'desc']);

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readSearchParam(searchParams, key) {
  const value = searchParams.get(key);
  return value == null ? '' : value;
}

export function isValidView(value) {
  return ALL_VIEWS.has(asString(value));
}

export function isTopLevelView(value) {
  return TOP_LEVEL_VIEW_SET.has(asString(value));
}

export function sanitizeOffset(value) {
  const n = Number.parseInt(asString(value), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function sanitizePage(value) {
  const n = Number.parseInt(asString(value), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function sanitizeSort(value) {
  const sort = asString(value);
  return REQUEST_SORT_SET.has(sort) ? sort : 'created';
}

export function sanitizeDir(value) {
  const dir = asString(value);
  return SORT_DIR_SET.has(dir) ? dir : 'desc';
}

function sanitizeTopLevelOrigin(value, fallback) {
  return isTopLevelView(value) ? value : fallback;
}

export function normalizeRouteState(routeState = {}) {
  const requests = routeState.requests || {};
  const articles = routeState.articles || {};

  let view = isValidView(routeState.view) ? routeState.view : 'inbox';
  const requestId = asString(routeState.requestId);
  const itemId = asString(routeState.itemId);
  const from = isTopLevelView(routeState.from) ? routeState.from : undefined;

  if (view === 'detail' && !requestId) {
    view = 'requests';
  }
  if (view === 'articleDetail' && !itemId) {
    view = 'articles';
  }

  return {
    view,
    requestId: requestId || undefined,
    itemId: itemId || undefined,
    from,
    requests: {
      domain: asString(requests.domain),
      status: asString(requests.status),
      q: asString(requests.q),
      dateRange: asString(requests.dateRange),
      offset: sanitizeOffset(String(requests.offset ?? '0')),
      sort: sanitizeSort(String(requests.sort ?? 'created')),
      dir: sanitizeDir(String(requests.dir ?? 'desc')),
    },
    articles: {
      status: asString(articles.status),
      search: asString(articles.search),
      page: sanitizePage(String(articles.page ?? '1')),
    },
  };
}

export function parseLocation(locationLike) {
  const pathname = asString(locationLike?.pathname) || '/';
  const search = asString(locationLike?.search) || '';
  const searchParams = new URLSearchParams(search);
  const parts = pathname.split('/').filter(Boolean).map(safeDecode);

  const routeState = {
    view: 'inbox',
    requestId: undefined,
    itemId: undefined,
    from: sanitizeTopLevelOrigin(readSearchParam(searchParams, 'from'), undefined),
    requests: {
      domain: readSearchParam(searchParams, 'domain'),
      status: readSearchParam(searchParams, 'status'),
      q: readSearchParam(searchParams, 'q'),
      dateRange: readSearchParam(searchParams, 'dateRange'),
      offset: readSearchParam(searchParams, 'offset'),
      sort: readSearchParam(searchParams, 'sort'),
      dir: readSearchParam(searchParams, 'dir'),
    },
    articles: {
      status: readSearchParam(searchParams, 'status'),
      search: readSearchParam(searchParams, 'search'),
      page: readSearchParam(searchParams, 'page'),
    },
  };

  if (parts.length === 0) {
    routeState.view = 'inbox';
  } else if (parts[0] === 'requests' && parts[1]) {
    routeState.view = 'detail';
    routeState.requestId = parts[1];
  } else if (parts[0] === 'articles' && parts[1]) {
    routeState.view = 'articleDetail';
    routeState.itemId = parts[1];
  } else if (parts[0] === 'requests') {
    routeState.view = 'requests';
  } else if (parts[0] === 'articles') {
    routeState.view = 'articles';
  } else if (TOP_LEVEL_VIEW_SET.has(parts[0])) {
    routeState.view = parts[0];
  } else {
    routeState.view = 'inbox';
  }

  return normalizeRouteState(routeState);
}

function appendParam(searchParams, key, value) {
  if (!value) return;
  searchParams.set(key, value);
}

export function buildUrl(routeState) {
  const route = normalizeRouteState(routeState);
  const params = new URLSearchParams();
  // Every branch below (including the final else) assigns path; no initializer needed.
  let path;

  if (route.view === 'detail') {
    path = `/requests/${encodeURIComponent(route.requestId || '')}`;
    appendParam(params, 'from', route.from || '');
  } else if (route.view === 'articleDetail') {
    path = `/articles/${encodeURIComponent(route.itemId || '')}`;
    appendParam(params, 'from', route.from || '');
  } else if (route.view === 'requests') {
    path = '/requests';
    appendParam(params, 'domain', route.requests.domain);
    appendParam(params, 'status', route.requests.status);
    appendParam(params, 'q', route.requests.q);
    appendParam(params, 'dateRange', route.requests.dateRange);
    if (route.requests.offset > 0) params.set('offset', String(route.requests.offset));
    if (route.requests.sort !== 'created') params.set('sort', route.requests.sort);
    if (route.requests.dir !== 'desc') params.set('dir', route.requests.dir);
  } else if (route.view === 'articles') {
    path = '/articles';
    appendParam(params, 'status', route.articles.status);
    appendParam(params, 'search', route.articles.search);
    if (route.articles.page > 1) params.set('page', String(route.articles.page));
  } else {
    path = `/${route.view}`;
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
