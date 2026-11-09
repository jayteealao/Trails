import { onRequest as signIn } from '../functions/_middleware';
import { onRequestGet as getArchiveContent } from '../functions/api/archive-content';
import { onRequestGet as getArticles } from '../functions/api/articles';
import { onRequestGet as getArticle } from '../functions/api/articles/[itemId]';
import { onRequestPost as postRetryFull } from '../functions/api/articles/[itemId]/retry-full';
import { onRequestPost as postRetryMissing } from '../functions/api/articles/[itemId]/retry-missing';
import { onRequestPost as postRetryStep } from '../functions/api/articles/[itemId]/retry-step';
import { onRequestGet as getBackfill } from '../functions/api/backfill';
import { onRequestPost as postBatch } from '../functions/api/batch';
import { onRequestPost as postBegin } from '../functions/api/begin';
import { onRequestGet as getInbox } from '../functions/api/inbox';
import { onRequestGet as getInfra } from '../functions/api/infra';
import { onRequestGet as getRequests } from '../functions/api/requests';
import { onRequestGet as getSignedUrl } from '../functions/api/signed-url';
import { onRequestGet as getStats } from '../functions/api/stats';
import { onRequestGet as getStream } from '../functions/api/stream/[id]';
import { onRequestGet as getRequest } from '../functions/api/[id]';
import { compareRoutes, type Route, type RouterEnv } from './router';

// The bindings of the dashboard Worker (wrangler.jsonc, cloudflare.config.ts).
export interface DashboardEnv extends RouterEnv {
  LOGGER: Fetcher;
  GATEWAY: Fetcher;
  BACKFILL_STATUS_URL: string;
  DASHBOARD_API_URL: string;
  // Only the browser checks set it, to point the infra view at a stub.
  CF_API_URL?: string;
  DASHBOARD_AUTH?: string;
  INTERNAL_API_KEY: string;
  DASHBOARD_API_KEY: string;
  BACKFILL_STATUS_KEY: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
}

// One entry per handler export in functions/, with the route that Pages
// derived from its file path (functions/api/articles/[itemId].ts is
// `/api/articles/:itemId`, mounted at `/api/articles`). A new function file
// is added here too; src/__tests__/router.test.ts fails until it is.
const TABLE: Route<DashboardEnv>[] = [
  { routePath: '/', mountPath: '/', modules: [], middlewares: [signIn] },
  { routePath: '/api/archive-content', mountPath: '/api', method: 'GET', modules: [getArchiveContent], middlewares: [] },
  { routePath: '/api/articles', mountPath: '/api', method: 'GET', modules: [getArticles], middlewares: [] },
  { routePath: '/api/articles/:itemId', mountPath: '/api/articles', method: 'GET', modules: [getArticle], middlewares: [] },
  {
    routePath: '/api/articles/:itemId/retry-full',
    mountPath: '/api/articles/:itemId',
    method: 'POST',
    modules: [postRetryFull],
    middlewares: [],
  },
  {
    routePath: '/api/articles/:itemId/retry-missing',
    mountPath: '/api/articles/:itemId',
    method: 'POST',
    modules: [postRetryMissing],
    middlewares: [],
  },
  {
    routePath: '/api/articles/:itemId/retry-step',
    mountPath: '/api/articles/:itemId',
    method: 'POST',
    modules: [postRetryStep],
    middlewares: [],
  },
  { routePath: '/api/backfill', mountPath: '/api', method: 'GET', modules: [getBackfill], middlewares: [] },
  { routePath: '/api/batch', mountPath: '/api', method: 'POST', modules: [postBatch], middlewares: [] },
  { routePath: '/api/begin', mountPath: '/api', method: 'POST', modules: [postBegin], middlewares: [] },
  { routePath: '/api/inbox', mountPath: '/api', method: 'GET', modules: [getInbox], middlewares: [] },
  { routePath: '/api/infra', mountPath: '/api', method: 'GET', modules: [getInfra], middlewares: [] },
  { routePath: '/api/requests', mountPath: '/api', method: 'GET', modules: [getRequests], middlewares: [] },
  { routePath: '/api/signed-url', mountPath: '/api', method: 'GET', modules: [getSignedUrl], middlewares: [] },
  { routePath: '/api/stats', mountPath: '/api', method: 'GET', modules: [getStats], middlewares: [] },
  { routePath: '/api/stream/:id', mountPath: '/api/stream', method: 'GET', modules: [getStream], middlewares: [] },
  { routePath: '/api/:id', mountPath: '/api', method: 'GET', modules: [getRequest], middlewares: [] },
];

// In the order Pages tries them.
export const ROUTES: readonly Route<DashboardEnv>[] = [...TABLE].sort(compareRoutes);
