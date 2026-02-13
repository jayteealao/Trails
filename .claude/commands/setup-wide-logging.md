---
name: setup-wide-logging
description: Set up wide-event logging with tail sampling to replace scattered logs with canonical log lines
usage: /setup-wide-logging [FRAMEWORK] [LOGGER]
arguments:
  - name: FRAMEWORK
    description: 'Web framework: express | koa | fastify | nextjs | auto-detect'
    required: false
    default: auto-detect
  - name: LOGGER
    description: 'Logger library: pino | winston | bunyan | console | auto-detect'
    required: false
    default: auto-detect
examples:
  - command: /setup-wide-logging
    description: Auto-detect framework and logger, set up wide-event logging
  - command: /setup-wide-logging express pino
    description: Set up wide-event logging for Express with Pino
  - command: /setup-wide-logging fastify winston
    description: Set up wide-event logging for Fastify with Winston
---

# Setup Wide-Event Logging

You are an observability architect implementing **wide events / canonical log lines** with **tail sampling** following the philosophy from **loggingsucks.com**.

## Core Philosophy

**Traditional logging is broken:**
1. **Optimized for writing, not querying** - scattered logs create noise, not insight
2. **Missing business context** - logs lack user tier, feature flags, cart value, account age
3. **String search inadequacy** - grep can't correlate events across services
4. **Multi-search debugging nightmare** - requires multiple searches to understand one request

**The Solution**: Emit **ONE comprehensive event per request per service** containing:
- Technical metadata (timestamps, IDs, duration)
- Business context (user subscription, cart value, feature flags)
- Error details when applicable
- Complete request context in a single queryable event

## Step 1: Detect Current Environment

### 1.1 Detect Web Framework

Scan project files to identify the web framework:

```bash
# Check package.json for dependencies
cat package.json | grep -E '"(express|koa|fastify|next)"'

# Check for framework imports
grep -r "from 'express'" src/
grep -r "from 'koa'" src/
grep -r "from 'fastify'" src/
grep -r "from 'next'" src/
```

Common patterns:
- **Express**: `import express from 'express'`, `app.get()`, `app.post()`
- **Koa**: `import Koa from 'koa'`, `app.use(async (ctx, next) => {})`
- **Fastify**: `import fastify from 'fastify'`, `fastify.get()`, `fastify.post()`
- **Next.js**: `pages/api/`, `app/api/`, `getServerSideProps`

Set `FRAMEWORK` to detected value.

### 1.2 Detect Logger

Scan project files to identify the logger:

```bash
# Check package.json
cat package.json | grep -E '"(pino|winston|bunyan)"'

# Check for logger imports
grep -r "from 'pino'" src/
grep -r "from 'winston'" src/
grep -r "from 'bunyan'" src/
grep -r "console.log" src/
```

Common patterns:
- **Pino**: `import pino from 'pino'`, `logger.info({ ... }, 'message')`
- **Winston**: `import winston from 'winston'`, `logger.info('message', { ... })`
- **Bunyan**: `import bunyan from 'bunyan'`, `logger.info({ ... }, 'message')`
- **Console**: `console.log()`, `console.error()`

Set `LOGGER` to detected value.

### 1.3 Analyze Current Logging Approach

Search for existing log statements:

```bash
# Find all log statements
grep -r "logger\.\(info\|error\|debug\|warn\)" src/
grep -r "console\.\(log\|error\|info\)" src/

# Count log statements per file
grep -r "logger\.info" src/ | cut -d: -f1 | sort | uniq -c | sort -nr

# Look for scattered logging patterns (RED FLAG)
grep -B5 -A5 "logger\.info.*started" src/
grep -B5 -A5 "logger\.info.*completed" src/
```

**Identify anti-patterns:**
- Multiple log statements per request handler (diary logging)
- Log statements at start, middle, end of function
- Missing correlation IDs
- Logging primitive values instead of structured objects
- Secrets or PII in logs

## Step 2: Design Wide Event Schema

Based on the detected framework and application type, design a TypeScript interface for wide events.

### 2.1 Base Wide Event Schema

```typescript
// src/observability/wideEvent.ts

/**
 * Wide Event Schema - ONE event per request with full context
 * Philosophy: https://loggingsucks.com/
 */
export interface WideEvent {
  // ===== Correlation & Identity =====
  timestamp: string;              // ISO 8601
  request_id: string;             // Correlation across services
  trace_id?: string;              // Distributed tracing (OpenTelemetry)
  span_id?: string;               // Current span ID
  parent_span_id?: string;        // Parent span ID

  // ===== Service Context =====
  service: string;                // "checkout-api"
  version: string;                // "2.1.0"
  deployment_id: string;          // "deploy_abc123"
  region: string;                 // "us-east-1"
  environment: string;            // "production" | "staging" | "development"
  hostname: string;               // Container/instance ID

  // ===== Request Details =====
  method: string;                 // "POST"
  path: string;                   // "/api/checkout"
  route?: string;                 // "/api/checkout/:id" (route pattern)
  status_code?: number;           // 200
  duration_ms?: number;           // 245
  outcome?: 'success' | 'error';  // High-level outcome

  // ===== User Context (HIGH VALUE) =====
  user?: {
    id: string;
    subscription?: 'free' | 'premium' | 'enterprise';
    account_age_days?: number;
    lifetime_value_cents?: number;
    cohort?: string;              // A/B test cohort
    is_internal?: boolean;        // Internal user/employee
  };

  // ===== Request Context =====
  client?: {
    ip?: string;                  // Client IP (or hash for privacy)
    user_agent?: string;
    country?: string;             // GeoIP
    device_type?: 'mobile' | 'tablet' | 'desktop';
  };

  // ===== Feature Flags (for rollout debugging) =====
  feature_flags?: Record<string, boolean | string>;

  // ===== Performance =====
  performance?: {
    db_query_count?: number;
    db_duration_ms?: number;
    cache_hit?: boolean;
    external_api_calls?: number;
    external_api_duration_ms?: number;
  };

  // ===== Error Details (when applicable) =====
  error?: {
    type: string;                 // "PaymentDeclinedError"
    code: string;                 // "card_declined"
    message: string;
    stack?: string;               // Stack trace (redacted in production)
    retriable: boolean;
    provider_code?: string;       // Third-party error code
  };

  // ===== Domain-Specific Context =====
  // Add fields specific to your domain
  [key: string]: any;
}
```

### 2.2 Domain-Specific Extensions

Add fields based on application type:

**E-commerce:**
```typescript
export interface EcommerceWideEvent extends WideEvent {
  cart?: {
    total_cents: number;
    item_count: number;
    currency: string;
    coupon_applied?: string;
  };

  payment?: {
    provider: 'stripe' | 'paypal' | 'square';
    method: 'card' | 'bank' | 'wallet';
    latency_ms: number;
    attempt: number;
    decline_reason?: string;
  };

  order?: {
    id: string;
    total_cents: number;
    items: number;
    shipping_method?: string;
  };
}
```

**SaaS Application:**
```typescript
export interface SaaSWideEvent extends WideEvent {
  workspace?: {
    id: string;
    plan: 'free' | 'pro' | 'enterprise';
    seat_count: number;
    mrr_cents: number;
  };

  usage?: {
    api_calls_today: number;
    quota_limit: number;
    quota_remaining: number;
  };
}
```

**Content Platform:**
```typescript
export interface ContentWideEvent extends WideEvent {
  content?: {
    type: 'post' | 'video' | 'image';
    id: string;
    author_id: string;
    visibility: 'public' | 'private' | 'unlisted';
  };

  engagement?: {
    view_count: number;
    like_count: number;
    comment_count: number;
  };
}
```

## Step 3: Implement Tail Sampling

Create sampling logic that keeps signal, discards noise.

### 3.1 Tail Sampling Decision Function

```typescript
// src/observability/tailSampling.ts

/**
 * Tail Sampling - Decide AFTER request completes
 *
 * ALWAYS keep:
 * - Errors (100%)
 * - Slow requests (p99+)
 * - VIPs / high-value users
 * - Feature-flagged traffic (for rollout debugging)
 *
 * Sample the rest (1-5%)
 */
export function shouldSample(event: WideEvent): boolean {
  // ===== ALWAYS KEEP: Errors =====
  if (event.status_code && event.status_code >= 500) {
    return true; // Server errors
  }

  if (event.error) {
    return true; // Any error
  }

  if (event.status_code && event.status_code >= 400 && event.status_code < 500) {
    // Sample 10% of 4xx errors (keep more errors than success)
    return Math.random() < 0.10;
  }

  // ===== ALWAYS KEEP: Slow requests (tune to your p99) =====
  if (event.duration_ms && event.duration_ms > 2000) {
    return true; // Requests slower than 2s
  }

  if (event.duration_ms && event.duration_ms > 1000) {
    // Sample 50% of requests between 1-2s
    return Math.random() < 0.50;
  }

  // ===== ALWAYS KEEP: VIPs / high-value users =====
  if (event.user?.subscription === 'enterprise') {
    return true; // All enterprise users
  }

  if (event.user?.lifetime_value_cents && event.user.lifetime_value_cents > 10000_00) {
    return true; // Users with LTV > $10,000
  }

  if (event.user?.is_internal) {
    return true; // Internal users / employees
  }

  // ===== ALWAYS KEEP: Feature-flagged traffic =====
  if (event.feature_flags && Object.keys(event.feature_flags).length > 0) {
    return true; // Any active feature flags
  }

  // ===== ALWAYS KEEP: New users (for onboarding debugging) =====
  if (event.user?.account_age_days !== undefined && event.user.account_age_days < 7) {
    return true; // Users < 7 days old
  }

  // ===== ALWAYS KEEP: Critical paths (add your critical routes) =====
  const criticalPaths = [
    '/api/checkout',
    '/api/payment',
    '/api/auth/login',
    '/api/auth/signup',
  ];

  if (event.path && criticalPaths.some(path => event.path.startsWith(path))) {
    return Math.random() < 0.20; // Sample 20% of critical paths
  }

  // ===== SAMPLE: Everything else (success, fast, regular users) =====
  return Math.random() < 0.05; // 5% base sampling
}

/**
 * Configurable sampling strategy
 */
export interface SamplingConfig {
  // Base sampling rate (0.0 - 1.0)
  baseSampleRate: number;

  // Always sample these status codes
  alwaysSampleStatusCodes: number[];

  // Latency thresholds (ms)
  alwaysSampleSlowerThan: number;
  sampleSlowRequestsRate: number;
  slowRequestThreshold: number;

  // User-based sampling
  alwaysSampleSubscriptions: string[];
  alwaysSampleMinLtvCents: number;
  alwaysSampleInternalUsers: boolean;
  alwaysSampleNewUsersDays: number;

  // Feature flags
  alwaysSampleFeatureFlagged: boolean;

  // Critical paths
  criticalPaths: { path: string; sampleRate: number }[];
}

export const defaultSamplingConfig: SamplingConfig = {
  baseSampleRate: 0.05, // 5%
  alwaysSampleStatusCodes: [500, 501, 502, 503, 504],
  alwaysSampleSlowerThan: 2000, // 2s
  sampleSlowRequestsRate: 0.50, // 50%
  slowRequestThreshold: 1000, // 1s
  alwaysSampleSubscriptions: ['enterprise'],
  alwaysSampleMinLtvCents: 10000_00, // $10,000
  alwaysSampleInternalUsers: true,
  alwaysSampleNewUsersDays: 7,
  alwaysSampleFeatureFlagged: true,
  criticalPaths: [
    { path: '/api/checkout', sampleRate: 0.20 },
    { path: '/api/payment', sampleRate: 0.20 },
    { path: '/api/auth', sampleRate: 0.10 },
  ],
};

export function shouldSampleWithConfig(
  event: WideEvent,
  config: SamplingConfig = defaultSamplingConfig
): boolean {
  // Errors
  if (event.status_code && config.alwaysSampleStatusCodes.includes(event.status_code)) {
    return true;
  }

  if (event.error) {
    return true;
  }

  // Slow requests
  if (event.duration_ms && event.duration_ms > config.alwaysSampleSlowerThan) {
    return true;
  }

  if (event.duration_ms && event.duration_ms > config.slowRequestThreshold) {
    return Math.random() < config.sampleSlowRequestsRate;
  }

  // VIPs
  if (event.user?.subscription && config.alwaysSampleSubscriptions.includes(event.user.subscription)) {
    return true;
  }

  if (event.user?.lifetime_value_cents && event.user.lifetime_value_cents >= config.alwaysSampleMinLtvCents) {
    return true;
  }

  if (config.alwaysSampleInternalUsers && event.user?.is_internal) {
    return true;
  }

  // New users
  if (event.user?.account_age_days !== undefined &&
      event.user.account_age_days < config.alwaysSampleNewUsersDays) {
    return true;
  }

  // Feature flags
  if (config.alwaysSampleFeatureFlagged &&
      event.feature_flags &&
      Object.keys(event.feature_flags).length > 0) {
    return true;
  }

  // Critical paths
  for (const { path, sampleRate } of config.criticalPaths) {
    if (event.path && event.path.startsWith(path)) {
      return Math.random() < sampleRate;
    }
  }

  // Base sampling
  return Math.random() < config.baseSampleRate;
}
```

## Step 4: Implement Wide Event Middleware (Framework-Specific)

### 4.1 Express Middleware

```typescript
// src/observability/middleware/express.ts

import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { WideEvent } from '../wideEvent';
import { shouldSample } from '../tailSampling';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      wideEvent: WideEvent;
    }
  }
}

function getOrCreateRequestId(req: Request): string {
  const existing = req.header('x-request-id') || req.header('x-amzn-requestid');
  return existing ?? crypto.randomUUID();
}

export interface WideEventMiddlewareOptions {
  logger: {
    info: (obj: any, msg?: string) => void;
    error: (obj: any, msg?: string) => void;
  };
  serviceName?: string;
  version?: string;
  deploymentId?: string;
  region?: string;
  environment?: string;
  enrichEvent?: (event: WideEvent, req: Request, res: Response) => void;
}

export function wideEventMiddleware(options: WideEventMiddlewareOptions) {
  const {
    logger,
    serviceName = process.env.SERVICE_NAME || 'unknown',
    version = process.env.SERVICE_VERSION || process.env.npm_package_version || '0.0.0',
    deploymentId = process.env.DEPLOYMENT_ID || process.env.HEROKU_SLUG_COMMIT || 'local',
    region = process.env.AWS_REGION || process.env.REGION || 'local',
    environment = process.env.NODE_ENV || 'development',
    enrichEvent,
  } = options;

  return function (req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const request_id = getOrCreateRequestId(req);

    // Build initial event
    const event: WideEvent = {
      timestamp: new Date().toISOString(),
      request_id,
      service: serviceName,
      version,
      deployment_id: deploymentId,
      region,
      environment,
      hostname: process.env.HOSTNAME || require('os').hostname(),
      method: req.method,
      path: req.path,
      route: req.route?.path, // Will be set after route matching
      client: {
        ip: req.ip || req.socket.remoteAddress,
        user_agent: req.header('user-agent'),
      },
    };

    // Extract trace context (OpenTelemetry)
    const traceParent = req.header('traceparent');
    if (traceParent) {
      const parts = traceParent.split('-');
      if (parts.length === 4) {
        event.trace_id = parts[1];
        event.parent_span_id = parts[2];
      }
    }

    // Attach to request for handlers to enrich
    req.wideEvent = event;

    // Include request id in response headers
    res.setHeader('x-request-id', request_id);

    // Track query count (if using SQL)
    let queryCount = 0;
    let queryDuration = 0;

    // Monkey-patch to track DB queries (example for pg)
    // You'll need to adapt this to your DB client
    // const originalQuery = req.app.locals.db?.query;
    // if (originalQuery) {
    //   req.app.locals.db.query = async (...args: any[]) => {
    //     const queryStart = Date.now();
    //     try {
    //       return await originalQuery.apply(req.app.locals.db, args);
    //     } finally {
    //       queryCount++;
    //       queryDuration += Date.now() - queryStart;
    //       event.performance = {
    //         ...event.performance,
    //         db_query_count: queryCount,
    //         db_duration_ms: queryDuration,
    //       };
    //     }
    //   };
    // }

    // Emit event when response finishes
    res.on('finish', () => {
      event.status_code = res.statusCode;
      event.duration_ms = Date.now() - start;
      event.outcome = res.statusCode >= 500 ? 'error' : 'success';

      // Set route if available (Express sets req.route after middleware)
      if (req.route) {
        event.route = req.route.path;
      }

      // Custom enrichment hook
      if (enrichEvent) {
        try {
          enrichEvent(event, req, res);
        } catch (err) {
          logger.error({ error: err }, 'Failed to enrich wide event');
        }
      }

      // Tail sampling decision
      if (shouldSample(event)) {
        if (event.error || res.statusCode >= 500) {
          logger.error(event, 'request_complete');
        } else {
          logger.info(event, 'request_complete');
        }
      }
    });

    next();
  };
}

/**
 * Error handler middleware to capture errors in wide events
 */
export function wideEventErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Add error to wide event
  if (req.wideEvent) {
    req.wideEvent.error = {
      type: err.name || 'Error',
      code: err.code || 'unknown',
      message: err.message || String(err),
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
      retriable: err.retriable ?? false,
      provider_code: err.providerCode,
    };
  }

  next(err);
}
```

### 4.2 Fastify Plugin

```typescript
// src/observability/plugins/fastify.ts

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import crypto from 'crypto';
import { WideEvent } from '../wideEvent';
import { shouldSample } from '../tailSampling';

declare module 'fastify' {
  interface FastifyRequest {
    wideEvent: WideEvent;
  }
}

export interface WideEventPluginOptions {
  serviceName?: string;
  version?: string;
  deploymentId?: string;
  region?: string;
  environment?: string;
  enrichEvent?: (event: WideEvent, request: FastifyRequest, reply: FastifyReply) => void;
}

async function wideEventPlugin(
  fastify: FastifyInstance,
  options: WideEventPluginOptions
) {
  const {
    serviceName = process.env.SERVICE_NAME || 'unknown',
    version = process.env.SERVICE_VERSION || '0.0.0',
    deploymentId = process.env.DEPLOYMENT_ID || 'local',
    region = process.env.AWS_REGION || 'local',
    environment = process.env.NODE_ENV || 'development',
    enrichEvent,
  } = options;

  // Hook: before request processing
  fastify.addHook('onRequest', async (request, reply) => {
    const request_id =
      request.headers['x-request-id'] as string ||
      crypto.randomUUID();

    const event: WideEvent = {
      timestamp: new Date().toISOString(),
      request_id,
      service: serviceName,
      version,
      deployment_id: deploymentId,
      region,
      environment,
      hostname: process.env.HOSTNAME || require('os').hostname(),
      method: request.method,
      path: request.url,
      route: request.routerPath, // Fastify provides this
      client: {
        ip: request.ip,
        user_agent: request.headers['user-agent'],
      },
    };

    // Extract trace context
    const traceParent = request.headers['traceparent'] as string;
    if (traceParent) {
      const parts = traceParent.split('-');
      if (parts.length === 4) {
        event.trace_id = parts[1];
        event.parent_span_id = parts[2];
      }
    }

    request.wideEvent = event;
    reply.header('x-request-id', request_id);
  });

  // Hook: after response sent
  fastify.addHook('onResponse', async (request, reply) => {
    const event = request.wideEvent;
    if (!event) return;

    event.status_code = reply.statusCode;
    event.duration_ms = reply.getResponseTime();
    event.outcome = reply.statusCode >= 500 ? 'error' : 'success';

    // Custom enrichment
    if (enrichEvent) {
      try {
        enrichEvent(event, request, reply);
      } catch (err) {
        fastify.log.error({ error: err }, 'Failed to enrich wide event');
      }
    }

    // Tail sampling
    if (shouldSample(event)) {
      if (event.error || reply.statusCode >= 500) {
        fastify.log.error(event, 'request_complete');
      } else {
        fastify.log.info(event, 'request_complete');
      }
    }
  });

  // Hook: on error
  fastify.addHook('onError', async (request, reply, error) => {
    if (request.wideEvent) {
      request.wideEvent.error = {
        type: error.name || 'Error',
        code: (error as any).code || 'unknown',
        message: error.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
        retriable: (error as any).retriable ?? false,
      };
    }
  });
}

export default fp(wideEventPlugin, {
  name: 'wide-event-logging',
  fastify: '4.x',
});
```

### 4.3 Koa Middleware

```typescript
// src/observability/middleware/koa.ts

import type { Context, Next } from 'koa';
import crypto from 'crypto';
import { WideEvent } from '../wideEvent';
import { shouldSample } from '../tailSampling';

declare module 'koa' {
  interface Context {
    wideEvent: WideEvent;
  }
}

export interface KoaWideEventOptions {
  logger: {
    info: (obj: any, msg?: string) => void;
    error: (obj: any, msg?: string) => void;
  };
  serviceName?: string;
  version?: string;
  deploymentId?: string;
  region?: string;
  environment?: string;
  enrichEvent?: (event: WideEvent, ctx: Context) => void;
}

export function wideEventMiddleware(options: KoaWideEventOptions) {
  const {
    logger,
    serviceName = process.env.SERVICE_NAME || 'unknown',
    version = process.env.SERVICE_VERSION || '0.0.0',
    deploymentId = process.env.DEPLOYMENT_ID || 'local',
    region = process.env.AWS_REGION || 'local',
    environment = process.env.NODE_ENV || 'development',
    enrichEvent,
  } = options;

  return async function (ctx: Context, next: Next) {
    const start = Date.now();
    const request_id =
      ctx.request.header['x-request-id'] as string ||
      crypto.randomUUID();

    const event: WideEvent = {
      timestamp: new Date().toISOString(),
      request_id,
      service: serviceName,
      version,
      deployment_id: deploymentId,
      region,
      environment,
      hostname: process.env.HOSTNAME || require('os').hostname(),
      method: ctx.method,
      path: ctx.path,
      route: ctx._matchedRoute, // Koa-router sets this
      client: {
        ip: ctx.ip,
        user_agent: ctx.header['user-agent'],
      },
    };

    // Extract trace context
    const traceParent = ctx.header['traceparent'] as string;
    if (traceParent) {
      const parts = traceParent.split('-');
      if (parts.length === 4) {
        event.trace_id = parts[1];
        event.parent_span_id = parts[2];
      }
    }

    ctx.wideEvent = event;
    ctx.set('x-request-id', request_id);

    try {
      await next();
    } catch (err: any) {
      // Capture error
      event.error = {
        type: err.name || 'Error',
        code: err.code || 'unknown',
        message: err.message || String(err),
        stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
        retriable: err.retriable ?? false,
      };
      throw err;
    } finally {
      // Emit event after response
      event.status_code = ctx.status;
      event.duration_ms = Date.now() - start;
      event.outcome = ctx.status >= 500 ? 'error' : 'success';

      // Custom enrichment
      if (enrichEvent) {
        try {
          enrichEvent(event, ctx);
        } catch (err) {
          logger.error({ error: err }, 'Failed to enrich wide event');
        }
      }

      // Tail sampling
      if (shouldSample(event)) {
        if (event.error || ctx.status >= 500) {
          logger.error(event, 'request_complete');
        } else {
          logger.info(event, 'request_complete');
        }
      }
    }
  };
}
```

### 4.4 Next.js Middleware

```typescript
// src/middleware.ts (Next.js 13+ App Router)

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { WideEvent } from './observability/wideEvent';
import { shouldSample } from './observability/tailSampling';
import logger from './observability/logger';

export async function middleware(request: NextRequest) {
  const start = Date.now();
  const request_id =
    request.headers.get('x-request-id') ||
    crypto.randomUUID();

  const event: WideEvent = {
    timestamp: new Date().toISOString(),
    request_id,
    service: process.env.SERVICE_NAME || 'nextjs-app',
    version: process.env.NEXT_PUBLIC_VERSION || '0.0.0',
    deployment_id: process.env.VERCEL_DEPLOYMENT_ID || 'local',
    region: process.env.VERCEL_REGION || 'local',
    environment: process.env.NODE_ENV || 'development',
    hostname: process.env.HOSTNAME || 'unknown',
    method: request.method,
    path: request.nextUrl.pathname,
    client: {
      ip: request.ip,
      user_agent: request.headers.get('user-agent') || undefined,
    },
  };

  // Store event in headers to access in API routes
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', request_id);
  requestHeaders.set('x-wide-event', JSON.stringify(event));

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set('x-request-id', request_id);

  // Emit event (in API route or edge function, use different approach)
  // For now, log in middleware (consider edge runtime limitations)
  const duration_ms = Date.now() - start;
  event.duration_ms = duration_ms;
  event.status_code = response.status;
  event.outcome = response.status >= 500 ? 'error' : 'success';

  if (shouldSample(event)) {
    logger.info(event, 'request_complete');
  }

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
```

## Step 5: Enrich Wide Events in Route Handlers

Show examples of enriching events with business context in route handlers.

### 5.1 Express Handler with Business Context

```typescript
// src/api/checkout.ts (Express)

import express from 'express';
import { authenticateUser } from '../middleware/auth';
import { getFeatureFlags } from '../services/featureFlags';
import { getCart, processPayment } from '../services/checkout';

const router = express.Router();

router.post('/api/checkout', authenticateUser, async (req, res) => {
  const event = req.wideEvent;

  try {
    // ===== 1. Add user context =====
    const user = req.user; // From auth middleware
    event.user = {
      id: user.id,
      subscription: user.subscription,
      account_age_days: Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
      lifetime_value_cents: user.lifetimeValueCents,
      is_internal: user.email.endsWith('@company.com'),
    };

    // ===== 2. Add feature flags =====
    const flags = await getFeatureFlags(user.id);
    event.feature_flags = flags;

    // ===== 3. Add business context: cart =====
    const cart = await getCart(user.id);
    event.cart = {
      total_cents: cart.totalCents,
      item_count: cart.items.length,
      currency: cart.currency,
      coupon_applied: cart.couponCode,
    };

    // ===== 4. Process payment with timing =====
    const paymentStart = Date.now();
    const payment = await processPayment(cart, user);
    const paymentDuration = Date.now() - paymentStart;

    // ===== 5. Add payment context =====
    event.payment = {
      provider: payment.provider,
      method: payment.method,
      latency_ms: paymentDuration,
      attempt: payment.attempt || 1,
    };

    // ===== 6. Add order context =====
    event.order = {
      id: payment.orderId,
      total_cents: payment.amountCents,
      items: cart.items.length,
      shipping_method: cart.shippingMethod,
    };

    res.json({
      success: true,
      orderId: payment.orderId,
      requestId: event.request_id,
    });

  } catch (err: any) {
    // ===== 7. Add error context =====
    event.error = {
      type: err.name,
      code: err.code || 'unknown',
      message: err.message,
      retriable: err.retriable ?? false,
      provider_code: err.providerCode,
    };

    // If payment provider error, add decline reason
    if (err.providerCode) {
      event.payment = {
        ...event.payment,
        decline_reason: err.declineReason,
      } as any;
    }

    res.status(err.statusCode || 500).json({
      error: err.code,
      message: err.userMessage || 'Payment failed',
      requestId: event.request_id,
    });
  }

  // Event automatically emitted in middleware's res.on('finish')
});

export default router;
```

### 5.2 Before and After Comparison

**❌ BEFORE: Scattered logging (diary logs)**

```typescript
router.post('/api/checkout', authenticateUser, async (req, res) => {
  const user = req.user;

  logger.info('Checkout started', { userId: user.id });
  logger.info('User tier', { subscription: user.subscription });

  const cart = await getCart(user.id);
  logger.info('Cart retrieved', {
    cartTotal: cart.totalCents,
    items: cart.items.length
  });

  try {
    logger.info('Processing payment', { provider: 'stripe' });
    const payment = await processPayment(cart);
    logger.info('Payment successful', {
      orderId: payment.orderId,
      amount: payment.amountCents,
    });

    res.json({ success: true, orderId: payment.orderId });
  } catch (err) {
    logger.error('Payment failed', {
      error: err.message,
      userId: user.id,
      cartTotal: cart.totalCents,
    });
    res.status(500).json({ error: 'Payment failed' });
  }
});
```

**Problems with scattered logging:**
- 6+ log lines per request (noise)
- Missing correlation ID (can't correlate logs across services)
- Missing request duration, status code
- Logging at different times makes correlation hard
- No sampling (logs everything, 100x more expensive)
- Can't query "show me all failed checkouts for premium users with new payment flow"

**✅ AFTER: Wide event (single canonical log line)**

```typescript
router.post('/api/checkout', authenticateUser, async (req, res) => {
  const event = req.wideEvent;
  const user = req.user;

  // Add context to event (no logging yet)
  event.user = {
    id: user.id,
    subscription: user.subscription,
    account_age_days: daysSince(user.createdAt),
    lifetime_value_cents: user.lifetimeValueCents,
  };

  const cart = await getCart(user.id);
  event.cart = {
    total_cents: cart.totalCents,
    item_count: cart.items.length,
    currency: cart.currency,
  };

  try {
    const payment = await processPayment(cart);
    event.payment = {
      provider: payment.provider,
      latency_ms: payment.duration,
      attempt: 1,
    };

    res.json({ success: true, orderId: payment.orderId });
  } catch (err: any) {
    event.error = {
      type: err.name,
      code: err.code,
      message: err.message,
      retriable: err.retriable,
    };

    res.status(500).json({ error: 'Payment failed' });
  }

  // ONE log line emitted automatically in middleware
  // Contains: user context, cart, payment, error, duration, status, etc.
});
```

**Benefits:**
- ONE log line per request (90% less noise with tail sampling)
- Full context in single event (all fields queryable)
- Automatic correlation ID, duration, status
- Tail sampling keeps errors, slow requests, VIPs (keeps signal, discards noise)
- Can query: `WHERE outcome='error' AND user.subscription='premium' AND feature_flags.new_payment_flow=true`

## Step 6: Configure Logger with Redaction

Set up logger to redact sensitive fields automatically.

### 6.1 Pino Logger Configuration

```typescript
// src/observability/logger.ts

import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',

  // Format for local development
  ...(process.env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'SYS:HH:MM:ss',
      },
    },
  }),

  // Structured JSON for production
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      hostname: bindings.hostname,
    }),
  },

  // ===== CRITICAL: Redact sensitive fields =====
  redact: {
    paths: [
      // Auth & secrets
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'apiKey',
      'api_key',
      'secret',
      'authorization',
      'cookie',
      'session',

      // Payment
      'creditCard',
      'credit_card',
      'cardNumber',
      'card_number',
      'cvv',
      'ssn',
      'bankAccount',
      'bank_account',

      // PII
      'email', // Hash instead if needed
      'phone',
      'address',
      'ip', // Consider hashing

      // Nested paths
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'error.stack', // Redact stack in production
      'user.email', // If not needed
    ],
    remove: true, // Remove fields entirely (vs replacing with '[Redacted]')
  },

  // Serializers for common objects
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      headers: {
        host: req.headers.host,
        'user-agent': req.headers['user-agent'],
        // Don't include authorization, cookie
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
    err: pino.stdSerializers.err,
  },
});

export default logger;
```

### 6.2 Winston Logger Configuration

```typescript
// src/observability/logger.ts

import winston from 'winston';

const redactFields = [
  'password',
  'token',
  'apiKey',
  'secret',
  'creditCard',
  'ssn',
  'authorization',
  'cookie',
];

function redactSensitive(info: any): any {
  const redacted = { ...info };

  function redactObject(obj: any) {
    for (const key in obj) {
      if (redactFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        redactObject(obj[key]);
      }
    }
  }

  redactObject(redacted);
  return redacted;
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format((info) => redactSensitive(info))(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'development'
        ? winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        : winston.format.json(),
    }),
  ],
});

export default logger;
```

## Step 7: Migrate Existing Log Statements

Search and replace scattered logs with wide event enrichment.

### 7.1 Migration Strategy

**DO NOT** migrate all at once. Follow this phased approach:

**Phase 1: Add middleware (Week 1)**
- Add wide event middleware
- Dual logging (keep existing logs + new wide events)
- Verify events in logs
- Test tail sampling

**Phase 2: Enrich critical paths (Week 2)**
- Add business context to top 5 endpoints
- Add user context, feature flags
- Add domain-specific fields (cart, payment, etc.)

**Phase 3: Remove scattered logs (Week 3)**
- Remove redundant log statements in migrated endpoints
- Keep infrastructure logs (startup, shutdown, health)
- Update runbooks to use wide event queries

**Phase 4: Tune sampling (Week 4)**
- Monitor sampling rates
- Adjust thresholds (latency, LTV, etc.)
- Optimize for cost vs signal

### 7.2 Log Statement Migration Patterns

**Pattern 1: "Started" / "Completed" logs → Wide event**

```typescript
// ❌ BEFORE
logger.info('Payment processing started', { userId, amount });
const result = await processPayment();
logger.info('Payment processing completed', { userId, duration: Date.now() - start });

// ✅ AFTER
event.payment = { provider: 'stripe', amount_cents: amount };
const result = await processPayment();
// Duration automatically tracked by middleware
```

**Pattern 2: Error logs → event.error**

```typescript
// ❌ BEFORE
try {
  await processPayment();
} catch (err) {
  logger.error('Payment failed', { error: err.message, userId, amount });
  throw err;
}

// ✅ AFTER
try {
  await processPayment();
} catch (err: any) {
  event.error = {
    type: err.name,
    code: err.code,
    message: err.message,
    retriable: err.retriable,
  };
  throw err;
}
```

**Pattern 3: Debug logs → Remove or conditional**

```typescript
// ❌ BEFORE
logger.debug('Retrieved cart', { cartId, items: cart.items });

// ✅ AFTER
event.cart = { item_count: cart.items.length, total_cents: cart.total };
// No need for intermediate debug log
```

**Pattern 4: Multiple context logs → Single enrichment**

```typescript
// ❌ BEFORE
logger.info('User info', { userId, subscription });
logger.info('Cart info', { cartTotal, items });
logger.info('Payment info', { provider, method });

// ✅ AFTER
event.user = { id: userId, subscription };
event.cart = { total_cents: cartTotal, item_count: items };
event.payment = { provider, method };
// All logged together in one event
```

## Step 8: Document Query Examples

Create documentation showing how to query wide events.

### 8.1 Query Examples (CloudWatch Insights / Datadog / Elastic)

```sql
-- ===== Example 1: Checkout failures for premium users with feature flag =====
SELECT
  error.code,
  COUNT(*) as failure_count,
  AVG(duration_ms) as avg_duration_ms,
  AVG(cart.total_cents) as avg_cart_value_cents
FROM logs
WHERE
  path = '/api/checkout'
  AND outcome = 'error'
  AND user.subscription = 'premium'
  AND feature_flags.new_checkout_flow = true
  AND @timestamp > ago(1h)
GROUP BY error.code
ORDER BY failure_count DESC

-- ===== Example 2: Payment latency by provider and region =====
SELECT
  payment.provider,
  region,
  PERCENTILE(payment.latency_ms, 50) as p50,
  PERCENTILE(payment.latency_ms, 95) as p95,
  PERCENTILE(payment.latency_ms, 99) as p99
FROM logs
WHERE
  path = '/api/checkout'
  AND payment.provider IS NOT NULL
  AND @timestamp > ago(24h)
GROUP BY payment.provider, region
ORDER BY p95 DESC

-- ===== Example 3: Feature flag rollout impact =====
SELECT
  feature_flags.new_checkout_flow as has_new_flow,
  COUNT(*) as request_count,
  SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) / COUNT(*) as error_rate,
  AVG(duration_ms) as avg_latency_ms,
  PERCENTILE(duration_ms, 95) as p95_latency_ms
FROM logs
WHERE
  path = '/api/checkout'
  AND @timestamp > ago(1h)
GROUP BY has_new_flow

-- ===== Example 4: High-value user journey (full context) =====
SELECT *
FROM logs
WHERE
  request_id = 'req_abc123'
ORDER BY @timestamp

-- ===== Example 5: Slow requests with business context =====
SELECT
  path,
  user.subscription,
  user.lifetime_value_cents,
  cart.total_cents,
  duration_ms,
  error.code
FROM logs
WHERE
  duration_ms > 2000
  AND @timestamp > ago(1h)
ORDER BY duration_ms DESC
LIMIT 100

-- ===== Example 6: Error rate by user cohort =====
SELECT
  user.subscription,
  user.account_age_days,
  COUNT(*) as total_requests,
  SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) as errors,
  SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) / COUNT(*) as error_rate
FROM logs
WHERE
  @timestamp > ago(24h)
GROUP BY user.subscription, user.account_age_days
ORDER BY error_rate DESC
```

### 8.2 Dashboard Examples

**Dashboard 1: Checkout Funnel Health**
```
Metrics:
- Checkout success rate (overall, by subscription tier)
- p95 checkout latency (overall, by payment provider)
- Error breakdown (by error.code)
- Feature flag comparison (new vs old flow)

Queries:
WHERE path='/api/checkout' AND @timestamp > ago(15m)
GROUP BY user.subscription, payment.provider, feature_flags.new_checkout_flow
```

**Dashboard 2: VIP User Experience**
```
Metrics:
- Request count for enterprise users
- Error rate for high-LTV users
- Latency distribution for VIPs
- Payment success rate by user tier

Queries:
WHERE user.subscription='enterprise' OR user.lifetime_value_cents > 10000_00
```

**Dashboard 3: Feature Rollout**
```
Metrics:
- Traffic split (feature flag on vs off)
- Error rate comparison
- Latency comparison
- Conversion rate comparison

Queries:
WHERE @timestamp > ago(1h)
GROUP BY feature_flags.new_checkout_flow
```

## Step 9: Create Verification Tests

Write tests to verify wide events contain expected fields.

### 9.1 Middleware Test

```typescript
// tests/observability/wideEvent.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { wideEventMiddleware } from '../src/observability/middleware/express';

describe('Wide Event Middleware', () => {
  let app: express.Application;
  let mockLogger: any;
  let capturedEvents: any[];

  beforeEach(() => {
    capturedEvents = [];
    mockLogger = {
      info: vi.fn((event) => capturedEvents.push(event)),
      error: vi.fn((event) => capturedEvents.push(event)),
    };

    app = express();
    app.use(express.json());
    app.use(wideEventMiddleware({
      logger: mockLogger,
      serviceName: 'test-service',
      version: '1.0.0',
    }));
  });

  it('should create wide event with base fields', async () => {
    app.get('/test', (req, res) => {
      res.json({ ok: true });
    });

    await request(app).get('/test');

    expect(capturedEvents).toHaveLength(1);
    const event = capturedEvents[0];

    // Base fields
    expect(event).toHaveProperty('timestamp');
    expect(event).toHaveProperty('request_id');
    expect(event).toHaveProperty('service', 'test-service');
    expect(event).toHaveProperty('version', '1.0.0');
    expect(event).toHaveProperty('method', 'GET');
    expect(event).toHaveProperty('path', '/test');
    expect(event).toHaveProperty('status_code', 200);
    expect(event).toHaveProperty('duration_ms');
    expect(event).toHaveProperty('outcome', 'success');
  });

  it('should enrich event with business context', async () => {
    app.get('/checkout', (req, res) => {
      // Enrich event
      req.wideEvent.user = {
        id: 'user_123',
        subscription: 'premium',
        account_age_days: 30,
        lifetime_value_cents: 50000,
      };

      req.wideEvent.cart = {
        total_cents: 9999,
        item_count: 3,
        currency: 'USD',
      };

      res.json({ ok: true });
    });

    await request(app).get('/checkout');

    const event = capturedEvents[0];
    expect(event.user).toEqual({
      id: 'user_123',
      subscription: 'premium',
      account_age_days: 30,
      lifetime_value_cents: 50000,
    });
    expect(event.cart).toEqual({
      total_cents: 9999,
      item_count: 3,
      currency: 'USD',
    });
  });

  it('should capture errors in event', async () => {
    app.get('/error', (req, res) => {
      throw new Error('Test error');
    });

    app.use((err: any, req: Request, res: Response, next: any) => {
      if (req.wideEvent) {
        req.wideEvent.error = {
          type: err.name,
          code: 'test_error',
          message: err.message,
          retriable: false,
        };
      }
      res.status(500).json({ error: err.message });
    });

    await request(app).get('/error').expect(500);

    const event = capturedEvents[0];
    expect(event.outcome).toBe('error');
    expect(event.status_code).toBe(500);
    expect(event.error).toEqual({
      type: 'Error',
      code: 'test_error',
      message: 'Test error',
      retriable: false,
    });
  });

  it('should respect tail sampling for success', async () => {
    // Mock Math.random to control sampling
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // > 0.05, should NOT sample

    app.get('/test', (req, res) => {
      res.json({ ok: true });
    });

    await request(app).get('/test');

    // Should not log (sampled out)
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('should always sample errors', async () => {
    app.get('/error', (req, res) => {
      res.status(500).json({ error: 'Server error' });
    });

    await request(app).get('/error');

    // Should always log errors
    expect(mockLogger.error).toHaveBeenCalled();
    const event = capturedEvents[0];
    expect(event.status_code).toBe(500);
  });

  it('should always sample slow requests', async () => {
    app.get('/slow', async (req, res) => {
      await new Promise(resolve => setTimeout(resolve, 2100)); // > 2000ms
      res.json({ ok: true });
    });

    await request(app).get('/slow');

    // Should always log slow requests
    expect(mockLogger.info).toHaveBeenCalled();
    const event = capturedEvents[0];
    expect(event.duration_ms).toBeGreaterThan(2000);
  });

  it('should always sample VIP users', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // Normally would not sample

    app.get('/test', (req, res) => {
      req.wideEvent.user = {
        id: 'user_vip',
        subscription: 'enterprise', // VIP tier
        account_age_days: 100,
        lifetime_value_cents: 100000,
      };
      res.json({ ok: true });
    });

    await request(app).get('/test');

    // Should sample VIP users
    expect(mockLogger.info).toHaveBeenCalled();
  });
});
```

## Step 10: Create Runbook for You

Document how to use wide events for debugging.

### 10.1 Debugging Guide

```markdown
# Debugging with Wide Events

## Quick Start

Instead of grepping logs for scattered statements, query structured wide events.

### Example 1: "Why did checkout fail for user X?"

**Before (grep):**
```bash
# Multiple searches needed
grep "user_123" logs/*.log | grep checkout
grep "payment" logs/*.log | grep "user_123"
grep "error" logs/*.log | grep "user_123"
# Then manually correlate timestamps...
```

**After (query):**
```sql
SELECT *
FROM logs
WHERE user.id = 'user_123'
  AND path = '/api/checkout'
  AND @timestamp > ago(1h)
ORDER BY @timestamp DESC
LIMIT 10
```

Result: ONE query shows full context (cart, payment, error, duration, flags).

### Example 2: "Is the new checkout flow causing more errors?"

**Query:**
```sql
SELECT
  feature_flags.new_checkout_flow as new_flow,
  COUNT(*) as requests,
  SUM(CASE WHEN outcome='error' THEN 1 ELSE 0 END) / COUNT(*) as error_rate
FROM logs
WHERE path = '/api/checkout'
  AND @timestamp > ago(24h)
GROUP BY new_flow
```

### Example 3: "Which payment provider is slowest?"

**Query:**
```sql
SELECT
  payment.provider,
  PERCENTILE(payment.latency_ms, 95) as p95_latency
FROM logs
WHERE payment.provider IS NOT NULL
  AND @timestamp > ago(1h)
GROUP BY payment.provider
ORDER BY p95_latency DESC
```

## Field Reference

Every wide event contains:

**Always present:**
- `timestamp`, `request_id`, `service`, `version`
- `method`, `path`, `status_code`, `duration_ms`, `outcome`

**When available:**
- `user.id`, `user.subscription`, `user.lifetime_value_cents`
- `feature_flags.*`
- `error.code`, `error.message`, `error.retriable`
- `cart.*`, `payment.*`, `order.*` (domain-specific)

## Common Queries

See documentation/wide-event-queries.md
```

## Deliverables

At the end of this command, you should have:

1. **Wide Event Schema** (TypeScript interface)
2. **Tail Sampling Logic** (shouldSample function)
3. **Framework Middleware** (Express/Fastify/Koa/Next.js)
4. **Logger Configuration** (with redaction)
5. **Migration Examples** (before/after code)
6. **Query Examples** (SQL for CloudWatch/Datadog/Elastic)
7. **Tests** (middleware and sampling tests)
8. **Runbook** (debugging guide saved)

## Success Metrics

Track these to measure improvement:

1. **Log Volume Reduction**: 80-90% reduction with tail sampling
2. **MTTR (Mean Time to Resolution)**: Faster debugging with full context
3. **Query Simplicity**: Multi-step grep → single structured query
4. **Context Completeness**: % of events with business fields populated

## References

- [Logging Sucks](https://loggingsucks.com/) - Core philosophy
- [OpenTelemetry](https://opentelemetry.io/) - Trace context integration
- [Pino](https://getpino.io/) - High-performance logger
- Wide Event Observability Skill - Full philosophy and examples
