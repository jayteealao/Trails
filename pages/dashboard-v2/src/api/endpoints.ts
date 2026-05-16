import { apiRequest } from './client';
import type {
  StatsResponse,
  RequestListResponse,
  RequestDetail,
  InfraResponse,
  BackfillResponse,
  ArticleListResponse,
  Article,
  ArchiveSubmitResponse,
  SignedUrlResponse,
} from './types';

export function fetchStats(): Promise<StatsResponse> {
  return apiRequest('/stats');
}

export function fetchRequests(params: {
  domain?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<RequestListResponse> {
  const search = new URLSearchParams();
  if (params.domain) search.set('domain', params.domain);
  if (params.status) search.set('status', params.status);
  if (params.limit) search.set('limit', String(params.limit));
  if (params.offset) search.set('offset', String(params.offset));
  return apiRequest(`/requests?${search}`);
}

export function fetchRequestDetail(requestId: string): Promise<RequestDetail> {
  return apiRequest(`/${encodeURIComponent(requestId)}`);
}

export function fetchInfra(): Promise<InfraResponse> {
  return apiRequest('/infra');
}

export function fetchBackfill(): Promise<BackfillResponse> {
  return apiRequest('/backfill');
}

export function fetchArticles(params: {
  page?: number;
  limit?: number;
  filter?: string;
  search?: string;
}): Promise<ArticleListResponse> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  if (params.filter) search.set('filter', params.filter);
  if (params.search) search.set('search', params.search);
  return apiRequest(`/articles?${search}`);
}

export function fetchArticleDetail(itemId: string): Promise<Article> {
  return apiRequest(`/articles/${encodeURIComponent(itemId)}`);
}

export function submitArchive(
  url: string,
  options?: { request_id?: string; steps?: string[] },
): Promise<ArchiveSubmitResponse> {
  return apiRequest('/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, ...options }),
  });
}

export function fetchSignedUrl(itemId: string, archiveKey: string): Promise<SignedUrlResponse> {
  const search = new URLSearchParams({ itemId, archiveKey });
  return apiRequest(`/signed-url?${search}`);
}
