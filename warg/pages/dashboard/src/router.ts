import { compileRoute, type PathParams } from './path-match';

// The Pages Functions router, run inside the dashboard Worker so the handlers
// in functions/ keep their `onRequest(context)` shape unchanged.
//
// This is a port of the router Pages itself runs: wrangler's
// templates/pages-template-worker.ts (wrangler 4.148.0), with the route
// order of its generateConfigFromFileTree/compareRoutes, and a path matcher
// (path-match.ts) that matches as the path-to-regexp 6.3.0 Pages bundles:
//   - `[name]` in a file name is the param `:name`; it matches one segment,
//     case-insensitively, with an optional trailing `/`;
//   - every middleware whose route is a prefix of the path runs first,
//     outermost (shortest route) first;
//   - then the first route (in compareRoutes order) that matches the whole
//     path and the method runs; a route with no method matches every method;
//   - when nothing is left, the request goes to the static assets.

export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

// The env every handler sees: the Worker's bindings plus ASSETS, which Pages
// gives every function and this Worker binds to its static assets.
export interface RouterEnv {
  ASSETS: Fetcher;
}

// A function file's handler. Each handler declares only the bindings it
// reads, so the table holds them at the widest env; the router passes the
// Worker's env through as it is.
export type RouteHandler<Env> = PagesFunction<Env, string, Record<string, unknown>>;

export interface Route<Env> {
  // `/api/articles/:itemId`, as wrangler derives it from the file path.
  routePath: string;
  // The route's folder, e.g. `/api/articles` (`/` for the root).
  mountPath: string;
  // Absent for `onRequest`, which serves every method.
  method?: RouteMethod;
  modules: RouteHandler<Env>[];
  middlewares: RouteHandler<Env>[];
}

export interface MatchedHandler<Env> {
  handler: RouteHandler<Env>;
  params: PathParams;
  path: string;
}

function segments(routePath: string): string[] {
  return routePath.slice(1).split('/').filter(Boolean);
}

// wrangler's compareRoutes: more segments first; at the first difference a
// static segment beats a param and a param beats a catch-all; a route with a
// method beats one without; then alphabetical.
export function compareRoutes<Env>(a: Route<Env>, b: Route<Env>): number {
  const segmentsA = segments(a.routePath);
  const segmentsB = segments(b.routePath);
  if (segmentsA.length !== segmentsB.length) return segmentsB.length - segmentsA.length;
  for (let i = 0; i < segmentsA.length; i++) {
    const segA = segmentsA[i] ?? '';
    const segB = segmentsB[i] ?? '';
    const isWildcardA = segA.includes('*');
    const isWildcardB = segB.includes('*');
    const isParamA = segA.includes(':');
    const isParamB = segB.includes(':');
    if (isWildcardA && !isWildcardB) return 1;
    if (!isWildcardA && isWildcardB) return -1;
    if (isParamA && !isParamB) return 1;
    if (!isParamA && isParamB) return -1;
  }
  if (a.method && !b.method) return -1;
  if (!a.method && b.method) return 1;
  return a.routePath.localeCompare(b.routePath);
}

// The handlers a request runs, in order: the matching middlewares, then the
// first matching route's modules. `routes` must be in compareRoutes order.
export function* matchHandlers<Env>(
  routes: readonly Route<Env>[],
  method: string,
  requestPath: string,
): Generator<MatchedHandler<Env>> {
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== method) continue;
    const matchResult = compileRoute(route.routePath, false)(requestPath);
    const mountMatchResult = compileRoute(route.mountPath, false)(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares) {
        yield { handler, params: matchResult.params, path: mountMatchResult.path };
      }
    }
  }

  for (const route of routes) {
    if (route.method && route.method !== method) continue;
    const matchResult = compileRoute(route.routePath, true)(requestPath);
    const mountMatchResult = compileRoute(route.mountPath, false)(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules) {
        yield { handler, params: matchResult.params, path: matchResult.path };
      }
      break;
    }
  }
}

// Makes a Response mutable, as Pages does with every handler's answer.
function cloneResponse(response: Response): Response {
  return new Response([101, 204, 205, 304].includes(response.status) ? null : response.body, response);
}

// Runs one request through the routes the way Pages does: each handler gets a
// Pages context, and `context.next()` moves to the next handler, then to the
// static assets.
export async function handleRequest<Env extends RouterEnv>(
  routes: readonly Route<Env>[],
  originalRequest: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let request = originalRequest;
  const handlerIterator = matchHandlers(routes, request.method, new URL(request.url).pathname);
  let data: Record<string, unknown> = {};
  let isFailOpen = false;

  const next = async (input?: Request | string, init?: RequestInit): Promise<Response> => {
    if (input !== undefined) {
      const url = typeof input === 'string' ? new URL(input, request.url).toString() : input;
      request = new Request(url, init);
    }

    const result = handlerIterator.next();
    if (result.done === false) {
      const { handler, params, path } = result.value;
      const context: EventContext<Env, string, Record<string, unknown>> = {
        request: new Request(request.clone()),
        functionPath: path,
        next,
        params,
        get data() {
          return data;
        },
        set data(value) {
          if (typeof value !== 'object' || value === null) {
            throw new Error('context.data must be an object');
          }
          data = value;
        },
        env,
        waitUntil: ctx.waitUntil.bind(ctx),
        passThroughOnException: () => {
          isFailOpen = true;
        },
      };
      const response = await handler(context);
      if (!(response instanceof Response)) {
        throw new Error('Your Pages function should return a Response');
      }
      return cloneResponse(response);
    }
    // No handler left: the static assets answer, as on Pages.
    return cloneResponse(await env.ASSETS.fetch(request));
  };

  try {
    return await next();
  } catch (error) {
    if (isFailOpen) return cloneResponse(await env.ASSETS.fetch(request));
    throw error;
  }
}
