// @ts-check
import { CONFIG } from './state.js';

/**
 * @typedef {{ domain: string, status: string, q?: string, from?: string, to?: string, dateRange?: string }} RequestFilters
 * @typedef {{ offset: number, limit?: number, total?: number, hasMore?: boolean }} Pagination
 * @typedef {{ requestId: string, url: string, domain: string, createdAt: string, updatedAt: string, lastEventTs: string|null, terminal: boolean, errorCount: number, stage: string|null, manifestR2Key: string|null }} RequestSummary
 * @typedef {{ requestId: string, url: string, createdAt: string, derived?: { stage?: string }, events?: Array<Object>, artifacts?: Array<Object> }} RequestDetail
 * @typedef {{ total: number, byStage: Record<string, number>, successRate: number, failureRate: number, activeCount: number, stuckCount: number, recentActivity: { last1h: number, last24h: number }, topDomains: Array<{domain: string, count: number}>, recentFailures: Array<{requestId: string, url: string, createdAt: string}> }} StatsResponse
 * @typedef {{ status?: string, search?: string }} ArticleFilters
 * @typedef {{ page: number, limit: number, total?: number, hasMore?: boolean }} ArticlePagination
 */

/**
 * @param {string} endpoint
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function apiRequest(endpoint, options) {
  const response = await fetch(`${CONFIG.apiBase}${endpoint}`, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * @param {RequestFilters} filters
 * @param {Pagination} pagination
 * @returns {Promise<{ requests: RequestSummary[], meta?: { count: number, success: boolean } }>}
 */
export async function fetchRequests(filters, pagination) {
  const params = new URLSearchParams();
  if (filters.domain) params.set('domain', filters.domain);
  if (filters.status) params.set('status', filters.status);
  if (filters.q) params.set('q', filters.q);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  params.set('limit', String(pagination.limit || CONFIG.pageSize));
  params.set('offset', String(pagination.offset));
  return apiRequest(`/requests?${params}`);
}

/** @param {string} requestId @returns {Promise<RequestDetail>} */
export async function fetchRequestDetail(requestId) {
  return apiRequest(`/${requestId}`);
}

/** @returns {Promise<StatsResponse>} */
export async function fetchStats() {
  return apiRequest('/stats');
}

/** @returns {Promise<any>} */
export async function fetchInfra() {
  return apiRequest('/infra');
}

/**
 * @param {string} url
 * @param {{ request_id?: string, steps?: string[] }} [options]
 * @returns {Promise<{ requestId?: string, request_id?: string }>}
 */
export async function submitArchive(url, options) {
  /** @type {Record<string, any>} */
  const body = { url };
  if (options) Object.assign(body, options);
  return apiRequest('/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** @returns {Promise<any>} */
export async function fetchBackfill() {
  return apiRequest('/backfill');
}

/**
 * @param {ArticleFilters} articleFilters
 * @param {ArticlePagination} articlePagination
 * @returns {Promise<{ articles: any[], total: number, hasMore: boolean }>}
 */
export async function fetchArticles(articleFilters, articlePagination) {
  const params = new URLSearchParams();
  params.set('page', String(articlePagination.page));
  params.set('limit', String(articlePagination.limit));
  if (articleFilters.status) params.set('filter', articleFilters.status);
  if (articleFilters.search) params.set('search', articleFilters.search);
  return apiRequest(`/articles?${params}`);
}

/** @param {string} itemId @returns {Promise<any>} */
export async function fetchArticleDetail(itemId) {
  return apiRequest(`/articles/${encodeURIComponent(itemId)}`);
}

/**
 * @param {string[]} requestIds
 * @returns {Promise<{ requests: RequestSummary[] }>}
 */
export async function fetchBatch(requestIds) {
  return apiRequest('/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestIds }),
  });
}

/**
 * @param {string} itemId
 * @param {string} archiveKey
 * @returns {Promise<{ url?: string }>}
 */
export async function fetchSignedUrl(itemId, archiveKey) {
  return apiRequest(`/signed-url?itemId=${encodeURIComponent(itemId)}&archiveKey=${encodeURIComponent(archiveKey)}`);
}
