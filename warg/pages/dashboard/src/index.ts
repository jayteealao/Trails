import { handleRequest } from './router';
import { ROUTES, type DashboardEnv } from './routes';

// The dashboard Worker. The assets config sets run_worker_first, so every
// request, static files included, comes here first and passes the sign-in
// middleware before a handler or the static assets answer it.
export default {
  fetch(request, env, ctx) {
    return handleRequest(ROUTES, request, env, ctx);
  },
} satisfies ExportedHandler<DashboardEnv>;
