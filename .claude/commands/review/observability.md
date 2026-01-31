---
name: review:observability
user-invocable: false
disable-model-invocation: true
description: Review observability completeness - logs, metrics, tracing, error reporting, alertability, and runbook hooks
usage: /review:observability [SCOPE] [TARGET] [PATHS]
arguments:
  - name: SCOPE
    description: 'Review scope: pr | worktree | diff | file | repo'
    required: false
    default: pr
  - name: TARGET
    description: 'Target: PR number, branch, commit hash, or file path'
    required: false
  - name: PATHS
    description: 'Optional glob patterns (e.g., "src/**/*.ts")'
    required: false
examples:
  - command: /review:observability pr 123
    description: Review PR #123 for observability completeness
  - command: /review:observability worktree "src/services/**"
    description: Review service layer for observability gaps
  - command: /review:observability diff main..feature
    description: Review branch diff for observability patterns
---

# Observability Review

You are an observability and production-readiness reviewer following the **wide-event philosophy** from loggingsucks.com. You review code for:

1. **Logs**: Wide events with business context
2. **Metrics**: Golden signals, cardinality management
3. **Tracing**: Distributed tracing with business context
4. **Error Reporting**: Grouping, context, actionability
5. **Alertability**: Can we detect failures automatically?
6. **Runbook Hooks**: Links to debugging playbooks

## Core Philosophy

**Observability = Ability to answer "WHY is this happening?"**

Good observability means:
- **Logs with business context**: Not just "request failed", but "premium user checkout failed with new payment flow"
- **Metrics that matter**: Golden signals (latency, traffic, errors, saturation), not vanity metrics
- **Traces with context**: Not just technical spans, but business operations with user tier
- **Actionable errors**: Grouped, deduplicated, with context to fix
- **Proactive alerts**: Detect issues before users complain
- **Runbook links**: Every alert links to "how to fix this"

## Observability Review Checklist

### Category 1: Logs (Wide Events with Business Context)

**HIGH if missing:**
- [ ] ONE canonical log line per request with full context
- [ ] Business context (user tier, feature flags, cart value, LTV)
- [ ] Correlation IDs (request_id, trace_id)
- [ ] Tail sampling (keep errors/slow/VIPs, sample rest)
- [ ] Queryable structure (not grep-only)

**Anti-patterns:**
- Multiple scattered log statements per request
- Missing business context (can't query by user tier)
- No correlation ID (can't trace across services)
- Logging 100% of traffic (expensive, noisy)
- Unstructured logs (grep-only, not queryable)

**Good patterns:**
```typescript
// ✅ Wide event with business context
app.post('/api/checkout', async (req, res) => {
  const event = req.wideEvent;

  // Business context
  event.user = {
    id: req.user.id,
    subscription: req.user.subscription, // ← Can query by tier
    account_age_days: daysSince(req.user.createdAt),
    lifetime_value_cents: req.user.lifetimeValueCents,
  };

  event.feature_flags = req.featureFlags; // ← Can query by flag

  const cart = await getCart(req.user.id);
  event.cart = {
    total_cents: cart.totalCents,
    item_count: cart.items.length,
  };

  try {
    const payment = await processPayment(cart);
    event.payment = {
      provider: payment.provider,
      latency_ms: payment.duration,
    };
    res.json({ ok: true });
  } catch (err: any) {
    event.error = {
      type: err.name,
      code: err.code,
      message: err.message,
    };
    res.status(500).json({ error: 'Failed' });
  }

  // ONE log emitted automatically with:
  // - user.subscription, user.lifetime_value_cents
  // - cart.total_cents
  // - payment.provider, payment.latency_ms
  // - error (if failed)
  // - status_code, duration_ms, outcome
});
```

**Query examples:**
```sql
-- Show me failed checkouts for premium users with new payment flow
SELECT *
FROM logs
WHERE outcome = 'error'
  AND user.subscription = 'premium'
  AND feature_flags.new_checkout_flow = true
  AND @timestamp > ago(1h)

-- Payment latency by provider and user tier
SELECT
  payment.provider,
  user.subscription,
  PERCENTILE(payment.latency_ms, 95) as p95
FROM logs
WHERE payment.provider IS NOT NULL
GROUP BY payment.provider, user.subscription
```

### Category 2: Metrics (Golden Signals + Cardinality)

**HIGH if missing:**
- [ ] **Latency**: Request duration (p50, p95, p99)
- [ ] **Traffic**: Requests per second
- [ ] **Errors**: Error rate (% of requests)
- [ ] **Saturation**: Resource usage (CPU, memory, queue depth)
- [ ] Cardinality management (avoid unbounded labels)

**Golden Signals (Google SRE):**

| Signal | Metric | Example |
|--------|--------|---------|
| Latency | Request duration | `http_request_duration_ms{endpoint="/api/checkout", status="200"}` |
| Traffic | Requests/sec | `http_requests_total{endpoint="/api/checkout"}` |
| Errors | Error rate | `http_requests_total{endpoint="/api/checkout", status="500"}` |
| Saturation | Resource usage | `node_memory_usage_bytes`, `queue_depth` |

**Anti-patterns:**
```typescript
// ❌ HIGH: Missing metrics (can't detect latency spikes)
app.post('/api/checkout', async (req, res) => {
  const payment = await processPayment();
  res.json({ ok: true });
});

// ❌ BLOCKER: Unbounded cardinality (user_id is unbounded)
metrics.increment('checkout_success', {
  user_id: req.user.id, // ← Millions of unique values
  cart_total: cart.total, // ← Infinite values
});

// ❌ HIGH: Vanity metrics (not actionable)
metrics.increment('button_clicks'); // So what?
metrics.gauge('server_uptime_days'); // Not useful
```

**Good patterns:**
```typescript
// ✅ Golden signals with bounded cardinality
app.post('/api/checkout', async (req, res) => {
  const start = Date.now();

  try {
    const payment = await processPayment();

    // Latency (bounded labels)
    metrics.histogram('checkout_duration_ms', Date.now() - start, {
      endpoint: '/api/checkout',
      subscription: req.user.subscription, // ← Bounded (3-5 tiers)
      payment_provider: payment.provider, // ← Bounded (3-5 providers)
      status: 'success',
    });

    // Traffic
    metrics.increment('checkout_requests_total', {
      endpoint: '/api/checkout',
      subscription: req.user.subscription,
      status: 'success',
    });

    res.json({ ok: true });

  } catch (err: any) {
    // Errors (with error type, not message)
    metrics.increment('checkout_errors_total', {
      endpoint: '/api/checkout',
      error_type: err.name, // ← Bounded (10-20 error types)
      subscription: req.user.subscription,
    });

    // Latency for errors
    metrics.histogram('checkout_duration_ms', Date.now() - start, {
      endpoint: '/api/checkout',
      subscription: req.user.subscription,
      status: 'error',
    });

    res.status(500).json({ error: 'Failed' });
  }
});

// Saturation metrics (background job)
setInterval(() => {
  metrics.gauge('queue_depth', queue.length, {
    queue_name: 'payment_processing',
  });

  metrics.gauge('node_memory_usage_bytes', process.memoryUsage().heapUsed);
  metrics.gauge('node_cpu_usage_percent', process.cpuUsage().user / 1000000);
}, 10000); // Every 10s
```

**Cardinality rules:**
- **DON'T** use user IDs, request IDs, timestamps as labels
- **DO** use bounded values: endpoint, status, subscription tier, error type
- **Rule**: Total unique combinations < 1000 (ideally < 100)

**Cardinality explosion example:**
```typescript
// ❌ BLOCKER: Infinite cardinality
{
  user_id: "user_123",        // 1M unique users
  cart_total: "99.99",        // Infinite values
  timestamp: "2024-01-15...", // Infinite values
}
// Total combinations: 1M × ∞ × ∞ = Metrics DB explodes

// ✅ Good: Bounded cardinality
{
  endpoint: "/api/checkout",      // 50 endpoints
  subscription: "premium",        // 5 tiers
  payment_provider: "stripe",     // 3 providers
  status: "success",              // 2 values
}
// Total combinations: 50 × 5 × 3 × 2 = 1,500 (OK)
```

### Category 3: Tracing (Distributed Tracing with Business Context)

**MED if missing:**
- [ ] Distributed tracing (OpenTelemetry, Jaeger, Zipkin)
- [ ] Spans for critical operations (DB queries, API calls)
- [ ] Business context in spans (user tier, feature flags)
- [ ] Trace sampling (head-based or tail-based)

**Anti-patterns:**
```typescript
// ❌ MED: No tracing (can't debug cross-service latency)
app.post('/api/checkout', async (req, res) => {
  const cart = await cartService.getCart(req.user.id); // 500ms?
  const payment = await paymentService.charge(cart); // 2000ms?
  const order = await orderService.create(payment); // 1000ms?
  res.json({ ok: true });
});
// Total latency: 3.5s, but which service is slow?

// ❌ MED: Tracing without business context
const span = trace.startSpan('checkout');
// Missing: user tier, cart value, feature flags
span.end();
```

**Good patterns:**
```typescript
// ✅ Distributed tracing with business context
import { trace } from '@opentelemetry/api';

app.post('/api/checkout', async (req, res) => {
  const tracer = trace.getTracer('checkout-service');

  // Create span for checkout operation
  const span = tracer.startSpan('checkout.process', {
    attributes: {
      // Technical context
      'http.method': 'POST',
      'http.route': '/api/checkout',

      // Business context (HIGH VALUE)
      'user.id': req.user.id,
      'user.subscription': req.user.subscription,
      'user.account_age_days': daysSince(req.user.createdAt),

      // Feature flags
      'feature_flags.new_checkout_flow': req.featureFlags.newCheckoutFlow,

      // Cart context
      'cart.total_cents': cart.totalCents,
      'cart.item_count': cart.items.length,
    },
  });

  try {
    // Child span for cart service
    const cartSpan = tracer.startSpan('cart.get', { parent: span });
    const cart = await cartService.getCart(req.user.id);
    cartSpan.setAttributes({
      'cart.total_cents': cart.totalCents,
      'cart.item_count': cart.items.length,
    });
    cartSpan.end();

    // Child span for payment service
    const paymentSpan = tracer.startSpan('payment.charge', { parent: span });
    paymentSpan.setAttributes({
      'payment.provider': 'stripe',
      'payment.amount_cents': cart.totalCents,
    });
    const payment = await paymentService.charge(cart);
    paymentSpan.setAttributes({
      'payment.latency_ms': payment.duration,
      'payment.attempt': payment.attempt,
    });
    paymentSpan.end();

    // Child span for order service
    const orderSpan = tracer.startSpan('order.create', { parent: span });
    const order = await orderService.create(payment);
    orderSpan.setAttributes({
      'order.id': order.id,
    });
    orderSpan.end();

    span.setStatus({ code: SpanStatusCode.OK });
    res.json({ ok: true });

  } catch (err: any) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err.message,
    });
    span.recordException(err);
    res.status(500).json({ error: 'Failed' });

  } finally {
    span.end();
  }
});
```

**Trace sampling:**
```typescript
// Tail-based sampling (sample AFTER request completes)
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

const sampler = new TraceIdRatioBasedSampler(0.05); // 5% base

// Custom sampler (keep errors, slow, VIPs)
class TailSampler implements Sampler {
  shouldSample(context: Context, traceId: string, spanName: string, spanKind: SpanKind, attributes: Attributes) {
    // Always sample errors
    if (attributes['http.status_code'] >= 500) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }

    // Always sample slow requests
    if (attributes['http.duration_ms'] > 2000) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }

    // Always sample VIPs
    if (attributes['user.subscription'] === 'enterprise') {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }

    // Sample 5% of the rest
    return Math.random() < 0.05
      ? { decision: SamplingDecision.RECORD_AND_SAMPLED }
      : { decision: SamplingDecision.NOT_RECORD };
  }
}
```

### Category 4: Error Reporting (Grouping & Context)

**HIGH if missing:**
- [ ] Error reporting service (Sentry, Bugsnag, Rollbar)
- [ ] Error grouping (by type, message, stack fingerprint)
- [ ] User context (ID, subscription, affected users count)
- [ ] Breadcrumbs (user actions leading to error)
- [ ] Release tracking (which deploy introduced error)

**Anti-patterns:**
```typescript
// ❌ HIGH: No error reporting (errors vanish)
try {
  await processPayment();
} catch (err) {
  console.error(err); // Lost in logs, no alerting
}

// ❌ HIGH: Error without context
Sentry.captureException(err); // No user, no breadcrumbs, can't reproduce

// ❌ MED: Poor error grouping (every error unique)
throw new Error(`Payment failed for user ${userId} at ${Date.now()}`);
// Every error has different message → 1000 unique errors
```

**Good patterns:**
```typescript
// ✅ Error reporting with full context
import * as Sentry from '@sentry/node';

app.post('/api/checkout', async (req, res) => {
  // Set user context
  Sentry.setUser({
    id: req.user.id,
    email: req.user.email,
    subscription: req.user.subscription,
  });

  // Set tags for grouping
  Sentry.setTags({
    endpoint: '/api/checkout',
    subscription: req.user.subscription,
    payment_provider: 'stripe',
  });

  // Add breadcrumb
  Sentry.addBreadcrumb({
    category: 'checkout',
    message: 'Cart loaded',
    level: 'info',
    data: {
      cart_total: cart.totalCents,
      item_count: cart.items.length,
    },
  });

  try {
    const payment = await processPayment(cart);

    Sentry.addBreadcrumb({
      category: 'payment',
      message: 'Payment processed',
      level: 'info',
      data: {
        provider: payment.provider,
        attempt: payment.attempt,
      },
    });

    res.json({ ok: true });

  } catch (err: any) {
    // Enrich error with context
    Sentry.setContext('cart', {
      total_cents: cart.totalCents,
      item_count: cart.items.length,
      currency: cart.currency,
    });

    Sentry.setContext('payment', {
      provider: 'stripe',
      attempt: payment?.attempt || 1,
      decline_code: err.declineCode,
    });

    // Set fingerprint for grouping (not user-specific)
    Sentry.setFingerprint([
      'checkout-error',
      err.code, // e.g., "card_declined"
      // Don't include user ID (would create unique groups)
    ]);

    // Capture with full context
    Sentry.captureException(err);

    res.status(500).json({ error: 'Failed' });
  }
});
```

**Error grouping:**
```typescript
// ✅ Good: Errors grouped by code (not message)
class PaymentError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PaymentError';
    this.code = code; // ← Use for grouping
  }
}

throw new PaymentError('card_declined', `Card declined for user ${userId}`);

// Sentry groups by:
// - Error type: PaymentError
// - Fingerprint: ['checkout-error', 'card_declined']
// Result: All card_declined errors grouped together
```

### Category 5: Alertability (Detect Issues Automatically)

**HIGH if missing:**
- [ ] Alerts for error rate spikes
- [ ] Alerts for latency regressions (p95, p99)
- [ ] Alerts for saturation (CPU, memory, queue depth)
- [ ] Alerts for business metrics (checkout drop-off, payment success rate)
- [ ] Runbook links in alerts

**Anti-patterns:**
```typescript
// ❌ HIGH: No alerts (rely on users to report issues)
// "We didn't know checkout was broken for 2 hours"

// ❌ MED: Alert on everything (alert fatigue)
if (request.duration > 100ms) {
  alert('Slow request'); // Fires 1000 times/day
}

// ❌ MED: Alert without context
alert('Payment service error'); // Which endpoint? Which user tier?
```

**Good patterns:**
```yaml
# ✅ Alert on error rate spike (Prometheus/Grafana)
groups:
  - name: checkout_alerts
    interval: 1m
    rules:
      # Error rate > 5% for 5 minutes
      - alert: CheckoutErrorRateHigh
        expr: |
          (
            sum(rate(checkout_requests_total{status="error"}[5m]))
            /
            sum(rate(checkout_requests_total[5m]))
          ) > 0.05
        for: 5m
        labels:
          severity: critical
          team: payments
        annotations:
          summary: "Checkout error rate > 5% for 5 minutes"
          description: |
            Current error rate: {{ $value | humanizePercentage }}
            Endpoint: /api/checkout
            Affected users: Premium, Enterprise

            Runbook: https://wiki.company.com/runbooks/checkout-errors
          dashboard: https://grafana.company.com/d/checkout

      # p95 latency > 2s for 5 minutes
      - alert: CheckoutLatencyHigh
        expr: |
          histogram_quantile(0.95,
            sum(rate(checkout_duration_ms_bucket[5m])) by (le)
          ) > 2000
        for: 5m
        labels:
          severity: warning
          team: payments
        annotations:
          summary: "Checkout p95 latency > 2s"
          description: |
            Current p95: {{ $value }}ms
            Threshold: 2000ms

            Check:
            - Payment provider latency
            - Database query performance
            - External API calls

            Runbook: https://wiki.company.com/runbooks/checkout-slow

      # Queue depth > 1000 (saturation)
      - alert: PaymentQueueSaturated
        expr: queue_depth{queue_name="payment_processing"} > 1000
        for: 2m
        labels:
          severity: warning
          team: payments
        annotations:
          summary: "Payment queue depth > 1000"
          description: |
            Current depth: {{ $value }}
            Consumers may be slow or crashed

            Runbook: https://wiki.company.com/runbooks/queue-saturation

      # Business metric: Payment success rate < 95%
      - alert: PaymentSuccessRateLow
        expr: |
          (
            sum(rate(checkout_requests_total{status="success"}[10m]))
            /
            sum(rate(checkout_requests_total[10m]))
          ) < 0.95
        for: 10m
        labels:
          severity: critical
          team: payments
        annotations:
          summary: "Payment success rate < 95%"
          description: |
            Current success rate: {{ $value | humanizePercentage }}
            Expected: > 95%

            Possible causes:
            - Payment provider outage
            - Increased fraud
            - Bug in payment flow

            Runbook: https://wiki.company.com/runbooks/payment-success-rate
```

**Alert design principles:**
1. **Actionable**: Alert → Runbook → Fix
2. **Not noisy**: Should fire < 5 times/week
3. **Not silent**: Should catch real issues
4. **With context**: Link to dashboard, runbook, affected users

### Category 6: Runbook Hooks (Links to Debugging Playbooks)

**MED if missing:**
- [ ] Runbook links in alerts
- [ ] Runbook links in error messages
- [ ] Debugging queries documented
- [ ] Common failure modes documented

**Anti-patterns:**
```typescript
// ❌ MED: Error without runbook
throw new Error('Payment failed');
// Oncall: "Now what? How do I debug this?"

// ❌ MED: Alert without runbook
alert('High error rate');
// Oncall: "What do I check first?"
```

**Good patterns:**
```typescript
// ✅ Error with runbook link
class PaymentError extends Error {
  code: string;
  runbook: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.runbook = `https://wiki.company.com/runbooks/payment-errors#${code}`;
  }
}

throw new PaymentError(
  'card_declined',
  'Card declined. See runbook: https://wiki.company.com/runbooks/payment-errors#card_declined'
);

// ✅ Alert with runbook
alert('High checkout error rate', {
  runbook: 'https://wiki.company.com/runbooks/checkout-errors',
  dashboard: 'https://grafana.company.com/d/checkout',
  queries: [
    'SELECT * FROM logs WHERE outcome="error" AND path="/api/checkout" AND @timestamp > ago(1h)',
  ],
});
```

**Runbook template:**
```markdown
# Runbook: Checkout Errors

## Symptoms
- High error rate on /api/checkout
- Users reporting "payment failed" errors
- Alert: CheckoutErrorRateHigh

## Impact
- Revenue loss (customers can't checkout)
- User frustration

## Diagnosis

### Step 1: Check error breakdown
```sql
SELECT
  error.code,
  COUNT(*) as count
FROM logs
WHERE
  outcome = 'error'
  AND path = '/api/checkout'
  AND @timestamp > ago(1h)
GROUP BY error.code
ORDER BY count DESC
```

### Step 2: Check payment provider status
- Stripe: https://status.stripe.com/
- PayPal: https://status.paypal.com/

### Step 3: Check recent deploys
```bash
kubectl rollout history deployment/checkout-service
```

### Step 4: Check affected user tiers
```sql
SELECT
  user.subscription,
  COUNT(*) as affected_users
FROM logs
WHERE
  outcome = 'error'
  AND path = '/api/checkout'
  AND @timestamp > ago(1h)
GROUP BY user.subscription
```

## Remediation

### If payment provider outage:
1. Enable fallback provider: `kubectl set env deployment/checkout-service FALLBACK_PROVIDER=paypal`
2. Notify users via status page

### If recent deploy:
1. Check diff: `git diff <previous-sha> <current-sha>`
2. Rollback if needed: `kubectl rollout undo deployment/checkout-service`

### If database slow:
1. Check slow queries: `SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10`
2. Add missing indexes
3. Scale up read replicas

## Prevention
- Add end-to-end tests for checkout flow
- Add canary deployment (5% → 50% → 100%)
- Add circuit breaker for payment provider

## Related
- Dashboard: https://grafana.company.com/d/checkout
- Past incidents: https://wiki.company.com/incidents/checkout
```

## Review Workflow

### Step 1: Scan for Observability Patterns

Search codebase for observability instrumentation:

```bash
# Logging
grep -rn "logger\.\(info\|error\)" src/
grep -rn "wideEvent" src/

# Metrics
grep -rn "metrics\.\(increment\|histogram\|gauge\)" src/
grep -rn "prometheus" src/

# Tracing
grep -rn "trace\.\(startSpan\|getTracer\)" src/
grep -rn "@opentelemetry" src/

# Error reporting
grep -rn "Sentry\.\(captureException\|setUser\)" src/
grep -rn "Bugsnag" src/

# Alerts
find . -name "*.yaml" -o -name "*.yml" | xargs grep -l "alert"
```

### Step 2: Identify Critical Paths

Focus on high-value, user-facing endpoints:

**Critical paths to check:**
- Authentication (login, signup, password reset)
- Payments (checkout, subscriptions, refunds)
- User data (CRUD operations on critical data)
- External integrations (third-party APIs)
- Background jobs (queue consumers, cron jobs)

### Step 3: Check Observability Completeness

For each critical path, verify:

| Category | Check | Example |
|----------|-------|---------|
| **Logs** | Wide event with business context? | `event.user.subscription`, `event.cart.total_cents` |
| **Metrics** | Golden signals (latency, errors, traffic)? | `checkout_duration_ms`, `checkout_errors_total` |
| **Tracing** | Spans for operations? | `cart.get`, `payment.charge` spans |
| **Errors** | Error reporting with context? | `Sentry.captureException(err)` with user context |
| **Alerts** | Detects failures automatically? | Alert on error rate > 5% |
| **Runbooks** | Link to debugging guide? | `https://wiki.company.com/runbooks/checkout` |

### Step 4: Generate Findings

For each observability gap, create a finding:

**Finding Format:**
```markdown
### OBS-N: [Issue Title] [SEVERITY]

**Evidence:**
**File:** `path/to/file.ts:123`
```language
[code showing the gap]
```

**Observability Gap:**
[What's missing]

**Impact:**
- **MTTR**: [How long to debug without this?]
- **Detection**: [Can we detect failures automatically?]
- **Context**: [Do we have enough info to debug?]

**Severity:** [BLOCKER | HIGH | MED | LOW | NIT]
**Category:** [Logs | Metrics | Tracing | Errors | Alerts | Runbooks]
**Confidence:** [High | Med | Low]

**Remediation:**
```language
// ❌ BEFORE (observability gap)
[current code]

// ✅ AFTER (complete observability)
[code with logs, metrics, tracing, error reporting]
```

**Why This Fix:**
[Explain the observability improvement]
```

### Step 5: Write Review Report

Create `.claude/<SESSION_SLUG>/reviews/review-observability-YYYY-MM-DD.md`:

```markdown
# Observability Review Report

**Session:** <SESSION_SLUG>
**Scope:** <SCOPE> <TARGET>
**Date:** <YYYY-MM-DD>
**Reviewer:** Claude Code

---

## Summary

- **Total Findings:** X
- **BLOCKER:** X | **HIGH:** X | **MED:** X | **LOW:** X | **NIT:** X

**Category Breakdown:**
- Logs (Wide Events): X
- Metrics (Golden Signals): X
- Tracing (Distributed): X
- Error Reporting: X
- Alertability: X
- Runbooks: X

---

## Observability Posture

### Critical Paths Reviewed
- `/api/checkout` (payment flow)
- `/api/auth/login` (authentication)
- `/api/users/:id` (user data)

### Observability Matrix

| Endpoint | Logs | Metrics | Tracing | Errors | Alerts | Runbooks |
|----------|------|---------|---------|--------|--------|----------|
| `/api/checkout` | ✅ | ✅ | ⚠️ | ✅ | ❌ | ❌ |
| `/api/auth/login` | ⚠️ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `/api/users/:id` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Legend:**
- ✅ Complete
- ⚠️ Partial
- ❌ Missing

---

## Key Gaps

**Critical (BLOCKER/HIGH):**
1. OBS-X: No metrics for checkout endpoint (can't detect latency spikes)
2. OBS-X: No alerts for payment errors (rely on users to report)
3. OBS-X: Missing business context in logs (can't query by user tier)

**Medium Priority (MED):**
1. OBS-X: No distributed tracing (hard to debug cross-service latency)
2. OBS-X: No runbook for checkout errors

---

## Findings

[Insert detailed findings]

---

## Recommendations

### Immediate Actions (BLOCKER/HIGH)
1. Add golden signals metrics for critical endpoints
2. Set up alerts for error rate and latency
3. Add business context to wide events

### Short-term (MED)
1. Implement distributed tracing
2. Create runbooks for common failures
3. Add error grouping with Sentry

### Long-term
1. Implement tail sampling for logs and traces
2. Create SLO dashboards
3. Set up automated canary analysis

---

## Observability Checklist (Use for Future PRs)

Before merging code that touches critical paths:

**Logs:**
- [ ] Wide event with business context (user tier, flags, cart)
- [ ] Correlation ID (request_id, trace_id)
- [ ] Tail sampling (keep errors/slow/VIPs, sample rest)

**Metrics:**
- [ ] Latency histogram (p50, p95, p99)
- [ ] Error counter (by endpoint, subscription, error type)
- [ ] Traffic counter (requests/sec)
- [ ] Saturation gauge (queue depth, CPU, memory)

**Tracing:**
- [ ] Spans for DB queries, API calls, business operations
- [ ] Business context in span attributes
- [ ] Trace sampling configured

**Error Reporting:**
- [ ] Error reporting service integrated
- [ ] User context attached
- [ ] Breadcrumbs for user actions
- [ ] Error grouping by code (not message)

**Alerts:**
- [ ] Alert on error rate spike (> 5% for 5min)
- [ ] Alert on latency regression (p95 > threshold)
- [ ] Alert on saturation (queue depth, CPU, memory)
- [ ] Runbook link in alert

**Runbooks:**
- [ ] Runbook created or updated
- [ ] Debugging queries documented
- [ ] Common failure modes documented
- [ ] Remediation steps documented
```

## Example Findings

### Example 1: Missing Business Context in Logs

```markdown
### OBS-1: Checkout Logs Missing Business Context (User Tier, Feature Flags) [HIGH]

**Evidence:**
**File:** `src/api/checkout.ts:45`
```typescript
app.post('/api/checkout', async (req, res) => {
  logger.info('Checkout started', { userId: req.user.id });

  try {
    const payment = await processPayment();
    logger.info('Checkout completed', { orderId: payment.orderId });
    res.json({ ok: true });
  } catch (err) {
    logger.error('Checkout failed', { error: err.message });
    res.status(500).json({ error: 'Failed' });
  }
});
```

**Observability Gap:**
Logs are missing critical business context:
- **User tier** (free vs premium vs enterprise)
- **Feature flags** (which A/B test variant)
- **Cart value** (how much revenue at risk)
- **Lifetime value** (is this a VIP user)

**Can't answer:**
- "Are premium users more affected than free users?"
- "Is the new checkout flow causing more errors?"
- "What's the revenue impact of these failures?"
- "Are errors correlated with cart value?"

**Impact:**
- **MTTR**: 30+ minutes to correlate logs with user data
- **Detection**: Can't detect tier-specific issues
- **Context**: Missing "why" this matters

**Severity:** HIGH
**Category:** Logs (Wide Events)
**Confidence:** High

**Remediation:**
```typescript
// ❌ BEFORE: Missing business context
logger.info('Checkout started', { userId: req.user.id });

// ✅ AFTER: Wide event with business context
app.post('/api/checkout', async (req, res) => {
  const event = req.wideEvent;

  // Add business context
  event.user = {
    id: req.user.id,
    subscription: req.user.subscription, // ← Can query by tier
    account_age_days: daysSince(req.user.createdAt),
    lifetime_value_cents: req.user.lifetimeValueCents,
  };

  event.feature_flags = req.featureFlags; // ← Can query by A/B test

  const cart = await getCart(req.user.id);
  event.cart = {
    total_cents: cart.totalCents, // ← Revenue at risk
    item_count: cart.items.length,
    currency: cart.currency,
  };

  try {
    const payment = await processPayment(cart);
    event.payment = {
      provider: payment.provider,
      latency_ms: payment.duration,
    };
    res.json({ ok: true });
  } catch (err: any) {
    event.error = {
      type: err.name,
      code: err.code,
      message: err.message,
    };
    res.status(500).json({ error: 'Failed' });
  }

  // ONE log emitted automatically with full context
});
```

**Why This Fix:**

**Before (can't answer questions):**
```
[INFO] Checkout started userId=123
[ERROR] Checkout failed error="Payment declined"
```

Can't query:
- ❌ "Show me premium user failures"
- ❌ "Show me failures with new checkout flow"
- ❌ "Show me high-value cart failures"

**After (queryable):**
```json
{
  "path": "/api/checkout",
  "outcome": "error",
  "user": {
    "id": "123",
    "subscription": "premium",
    "lifetime_value_cents": 50000
  },
  "cart": {
    "total_cents": 29999,
    "item_count": 5
  },
  "feature_flags": {
    "new_checkout_flow": true
  },
  "error": {
    "code": "card_declined"
  }
}
```

Can query:
- ✅ `WHERE user.subscription='premium' AND outcome='error'`
- ✅ `WHERE feature_flags.new_checkout_flow=true AND outcome='error'`
- ✅ `WHERE cart.total_cents > 10000 AND outcome='error'`

**Query examples:**
```sql
-- Premium user failures
SELECT *
FROM logs
WHERE user.subscription = 'premium'
  AND outcome = 'error'
  AND path = '/api/checkout'
  AND @timestamp > ago(1h)

-- Feature flag impact
SELECT
  feature_flags.new_checkout_flow as new_flow,
  COUNT(*) as requests,
  SUM(CASE WHEN outcome='error' THEN 1 ELSE 0 END) / COUNT(*) as error_rate
FROM logs
WHERE path = '/api/checkout'
GROUP BY new_flow

-- High-value failures (revenue at risk)
SELECT
  SUM(cart.total_cents) as total_revenue_at_risk_cents
FROM logs
WHERE outcome = 'error'
  AND path = '/api/checkout'
  AND @timestamp > ago(24h)
```
```

### Example 2: Missing Metrics (Can't Detect Latency Spikes)

```markdown
### OBS-2: No Metrics for Checkout Endpoint (Can't Detect Latency Spikes) [HIGH]

**Evidence:**
**File:** `src/api/checkout.ts:45`
```typescript
app.post('/api/checkout', async (req, res) => {
  // ❌ No metrics tracked
  const payment = await processPayment();
  res.json({ ok: true });
});
```

**Observability Gap:**
No metrics tracked for checkout endpoint:
- **No latency histogram** (can't see p95, p99)
- **No error counter** (can't see error rate)
- **No traffic counter** (can't see requests/sec)

**Can't answer:**
- "Is checkout getting slower?"
- "What's the error rate?"
- "Are we handling more traffic than usual?"
- "Which user tier has the highest latency?"

**Impact:**
- **Detection**: Can't detect latency regressions automatically
- **Alerting**: No alerts for performance degradation
- **Dashboards**: No visibility into checkout health

**Severity:** HIGH
**Category:** Metrics (Golden Signals)
**Confidence:** High

**Remediation:**
```typescript
// ❌ BEFORE: No metrics
app.post('/api/checkout', async (req, res) => {
  const payment = await processPayment();
  res.json({ ok: true });
});

// ✅ AFTER: Golden signals metrics
import { metrics } from './observability/metrics';

app.post('/api/checkout', async (req, res) => {
  const start = Date.now();

  try {
    const payment = await processPayment();

    // Latency histogram
    metrics.histogram('checkout_duration_ms', Date.now() - start, {
      endpoint: '/api/checkout',
      subscription: req.user.subscription, // ← Can alert per tier
      payment_provider: payment.provider,
      status: 'success',
    });

    // Traffic counter
    metrics.increment('checkout_requests_total', {
      endpoint: '/api/checkout',
      subscription: req.user.subscription,
      status: 'success',
    });

    res.json({ ok: true });

  } catch (err: any) {
    // Error counter
    metrics.increment('checkout_errors_total', {
      endpoint: '/api/checkout',
      error_type: err.name, // ← Grouped by type
      subscription: req.user.subscription,
    });

    // Latency for errors
    metrics.histogram('checkout_duration_ms', Date.now() - start, {
      endpoint: '/api/checkout',
      subscription: req.user.subscription,
      status: 'error',
    });

    res.status(500).json({ error: 'Failed' });
  }
});
```

**Why This Fix:**

**Metrics enable:**

1. **Latency monitoring:**
```promql
# p95 latency by subscription tier
histogram_quantile(0.95,
  sum(rate(checkout_duration_ms_bucket[5m])) by (le, subscription)
)
```

2. **Error rate monitoring:**
```promql
# Error rate (%)
sum(rate(checkout_errors_total[5m]))
/
sum(rate(checkout_requests_total[5m]))
```

3. **Traffic monitoring:**
```promql
# Requests per second
sum(rate(checkout_requests_total[5m]))
```

**Alerting examples:**
```yaml
# Alert on p95 latency > 2s
- alert: CheckoutLatencySlow
  expr: |
    histogram_quantile(0.95,
      sum(rate(checkout_duration_ms_bucket[5m])) by (le)
    ) > 2000
  for: 5m

# Alert on error rate > 5%
- alert: CheckoutErrorRateHigh
  expr: |
    sum(rate(checkout_errors_total[5m]))
    /
    sum(rate(checkout_requests_total[5m]))
    > 0.05
  for: 5m
```

**Dashboard:**
```
┌─────────────────────────────────────┐
│ Checkout Health                     │
├─────────────────────────────────────┤
│ Requests/sec:     124               │
│ Error rate:       0.8%              │
│ p50 latency:      156ms             │
│ p95 latency:      487ms             │
│ p99 latency:      1.2s              │
│                                     │
│ By subscription tier:               │
│ - Free:      p95 = 450ms, 1.2% err │
│ - Premium:   p95 = 520ms, 0.5% err │
│ - Enterprise: p95 = 380ms, 0.1% err│
└─────────────────────────────────────┘
```
```

### Example 3: No Alerts (Can't Detect Failures Automatically)

```markdown
### OBS-3: No Alerts for Checkout Errors (Rely on Users to Report Issues) [HIGH]

**Evidence:**
**Files:** No alert configuration found for checkout endpoint

```bash
$ find . -name "*.yaml" -o -name "*.yml" | xargs grep -l "alert"
# No results for checkout alerts
```

**Observability Gap:**
No automated alerting for checkout failures:
- **No error rate alert** (don't know when error rate spikes)
- **No latency alert** (don't know when checkout gets slow)
- **No saturation alert** (don't know when system overloaded)

**Current state:**
- Wait for users to complain
- Check logs manually
- React hours after issue starts

**Impact:**
- **MTTR**: Hours (wait for user reports)
- **Revenue loss**: Prolonged outages
- **User experience**: Customers leave after failed checkout

**Severity:** HIGH
**Category:** Alertability
**Confidence:** High

**Remediation:**

Create `monitoring/alerts/checkout.yaml`:

```yaml
# ✅ Checkout alerts
groups:
  - name: checkout_alerts
    interval: 1m
    rules:
      # Error rate > 5% for 5 minutes
      - alert: CheckoutErrorRateHigh
        expr: |
          (
            sum(rate(checkout_requests_total{status="error"}[5m]))
            /
            sum(rate(checkout_requests_total[5m]))
          ) > 0.05
        for: 5m
        labels:
          severity: critical
          team: payments
        annotations:
          summary: "Checkout error rate > 5%"
          description: |
            Current error rate: {{ $value | humanizePercentage }}

            **Impact:**
            - Users cannot complete checkout
            - Revenue loss

            **Check:**
            - Payment provider status
            - Recent deploys
            - Database performance

            **Runbook:**
            https://wiki.company.com/runbooks/checkout-errors

            **Dashboard:**
            https://grafana.company.com/d/checkout

            **Query:**
            ```sql
            SELECT error.code, COUNT(*) as count
            FROM logs
            WHERE outcome='error' AND path='/api/checkout' AND @timestamp > ago(1h)
            GROUP BY error.code
            ```

      # p95 latency > 2s for 5 minutes
      - alert: CheckoutLatencyHigh
        expr: |
          histogram_quantile(0.95,
            sum(rate(checkout_duration_ms_bucket[5m])) by (le)
          ) > 2000
        for: 5m
        labels:
          severity: warning
          team: payments
        annotations:
          summary: "Checkout p95 latency > 2s"
          description: |
            Current p95: {{ $value }}ms
            Threshold: 2000ms

            **Impact:**
            - Slow checkout experience
            - Users may abandon

            **Check:**
            - Payment provider latency
            - Database slow queries
            - CPU/memory usage

            **Runbook:**
            https://wiki.company.com/runbooks/checkout-slow

      # Payment success rate < 95% for 10 minutes (business metric)
      - alert: PaymentSuccessRateLow
        expr: |
          (
            sum(rate(checkout_requests_total{status="success"}[10m]))
            /
            sum(rate(checkout_requests_total[10m]))
          ) < 0.95
        for: 10m
        labels:
          severity: critical
          team: payments
        annotations:
          summary: "Payment success rate < 95%"
          description: |
            Current success rate: {{ $value | humanizePercentage }}
            Expected: > 95%

            **Impact:**
            - 5%+ of checkouts failing
            - Significant revenue loss

            **Possible causes:**
            - Payment provider outage
            - Fraud spike
            - Bug in payment flow

            **Runbook:**
            https://wiki.company.com/runbooks/payment-success-rate
```

**Why This Fix:**

**Before (reactive):**
```
09:00 - Issue starts (checkout error rate spikes to 20%)
09:30 - First user complaint
10:00 - Support escalates to engineering
10:15 - Engineer starts investigating
11:00 - Issue identified and fixed
---
Total: 2 hours of downtime
Revenue loss: Significant
```

**After (proactive):**
```
09:00 - Issue starts (checkout error rate spikes to 20%)
09:05 - Alert fires: "Checkout error rate > 5%"
09:06 - Oncall opens runbook
09:10 - Runbook query identifies payment provider outage
09:12 - Enable fallback provider
09:15 - Error rate back to normal
---
Total: 15 minutes of downtime
Revenue loss: Minimal
```

**Alert benefits:**
1. **Detection**: Automated, < 5 minutes
2. **Context**: Alert includes affected endpoint, user tier, error rate
3. **Actionability**: Runbook link with debugging steps
4. **Dashboard**: Link to metrics dashboard
```

### Example 4: No Distributed Tracing (Hard to Debug Cross-Service Latency)

```markdown
### OBS-4: No Distributed Tracing for Checkout Flow (Hard to Debug Latency) [MED]

**Evidence:**
**File:** `src/api/checkout.ts:45`
```typescript
app.post('/api/checkout', async (req, res) => {
  // ❌ No tracing
  const cart = await cartService.getCart(req.user.id); // How long?
  const user = await userService.getUser(req.user.id); // How long?
  const payment = await paymentService.charge(cart, user); // How long?
  const order = await orderService.create(payment); // How long?
  res.json({ ok: true });
});
```

**Observability Gap:**
No distributed tracing:
- Can see total latency (3.5s)
- **Can't see** which service is slow:
  - cartService.getCart() = ?ms
  - userService.getUser() = ?ms
  - paymentService.charge() = ?ms (suspect this is slow)
  - orderService.create() = ?ms

**Impact:**
- **MTTR**: Hours spent debugging wrong service
- **Optimization**: Can't identify actual bottleneck
- **Cross-service**: Can't trace request across services

**Severity:** MED
**Category:** Tracing (Distributed)
**Confidence:** High

**Remediation:**
```typescript
// ❌ BEFORE: No tracing
const cart = await cartService.getCart(req.user.id);
const payment = await paymentService.charge(cart);

// ✅ AFTER: Distributed tracing with OpenTelemetry
import { trace } from '@opentelemetry/api';

app.post('/api/checkout', async (req, res) => {
  const tracer = trace.getTracer('checkout-service');

  const span = tracer.startSpan('checkout.process', {
    attributes: {
      'http.method': 'POST',
      'http.route': '/api/checkout',
      'user.id': req.user.id,
      'user.subscription': req.user.subscription, // ← Business context
    },
  });

  try {
    // Cart service span
    const cartSpan = tracer.startSpan('cart.get', { parent: span });
    const cart = await cartService.getCart(req.user.id);
    cartSpan.setAttributes({
      'cart.total_cents': cart.totalCents,
      'cart.item_count': cart.items.length,
    });
    cartSpan.end(); // Duration automatically tracked

    // User service span
    const userSpan = tracer.startSpan('user.get', { parent: span });
    const user = await userService.getUser(req.user.id);
    userSpan.end();

    // Payment service span (this is the slow one)
    const paymentSpan = tracer.startSpan('payment.charge', { parent: span });
    paymentSpan.setAttributes({
      'payment.provider': 'stripe',
      'payment.amount_cents': cart.totalCents,
    });
    const payment = await paymentService.charge(cart, user);
    paymentSpan.setAttributes({
      'payment.latency_ms': payment.duration,
      'payment.attempt': payment.attempt,
    });
    paymentSpan.end();

    // Order service span
    const orderSpan = tracer.startSpan('order.create', { parent: span });
    const order = await orderService.create(payment);
    orderSpan.setAttributes({
      'order.id': order.id,
    });
    orderSpan.end();

    span.setStatus({ code: SpanStatusCode.OK });
    res.json({ ok: true });

  } catch (err: any) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err.message,
    });
    span.recordException(err);
    res.status(500).json({ error: 'Failed' });

  } finally {
    span.end();
  }
});
```

**Why This Fix:**

**Before (no visibility):**
```
Total latency: 3500ms
Which service is slow? Unknown.
```

**After (trace breakdown):**
```
checkout.process [3500ms]
├─ cart.get        [50ms]  ← Fast
├─ user.get        [30ms]  ← Fast
├─ payment.charge  [3200ms] ← SLOW (found the bottleneck!)
└─ order.create    [220ms] ← Fast
```

**Trace visualization (Jaeger/Zipkin):**
```
┌────────────────────────────────────────────┐
│ checkout.process              [3500ms]     │
│ ├─ cart.get        [50ms]                  │
│ ├─ user.get        [30ms]                  │
│ ├─ payment.charge  [3200ms] ████████████   │ ← Slow!
│ │  ├─ stripe.api.call [3100ms]             │
│ │  └─ db.save_payment [100ms]              │
│ └─ order.create    [220ms]                 │
└────────────────────────────────────────────┘
```

**Insights:**
- Payment service is the bottleneck (3.2s of 3.5s)
- Specifically, Stripe API call (3.1s)
- Suggests: Stripe API is slow, not our code

**Optimization:**
1. Contact Stripe support (their API is slow)
2. Add timeout to Stripe call (fail fast at 2s)
3. Consider alternative payment provider
```

### Example 5: Missing Runbook

```markdown
### OBS-5: No Runbook for Checkout Errors (Oncall Doesn't Know What to Do) [MED]

**Evidence:**
- Alert fires: "Checkout error rate > 5%"
- No runbook link
- Oncall: "What do I check?"

**Observability Gap:**
No runbook for common checkout failures:
- No debugging steps
- No common failure modes documented
- No remediation actions

**Impact:**
- **MTTR**: Oncall wastes time figuring out what to check
- **Context**: No documented past incidents
- **Remediation**: No clear "how to fix this"

**Severity:** MED
**Category:** Runbooks
**Confidence:** High

**Remediation:**

Create `docs/runbooks/checkout-errors.md`:

```markdown
# Runbook: Checkout Errors

**Alert:** CheckoutErrorRateHigh
**Severity:** Critical
**Team:** Payments

## Symptoms
- Alert: "Checkout error rate > 5%"
- Users reporting "payment failed" errors
- Dashboard shows spike in checkout errors

## Impact
- Revenue loss (customers can't checkout)
- User frustration
- Brand damage

## Diagnosis

### Step 1: Check error breakdown (5 minutes)

Run this query to see which errors are most common:

```sql
SELECT
  error.code,
  COUNT(*) as count,
  COUNT(*) / SUM(COUNT(*)) OVER () as percentage
FROM logs
WHERE
  outcome = 'error'
  AND path = '/api/checkout'
  AND @timestamp > ago(1h)
GROUP BY error.code
ORDER BY count DESC
```

**Common error codes:**
- `card_declined` (50%+) → User issue, not system issue
- `payment_timeout` (30%+) → Payment provider slow/down
- `insufficient_funds` (10%+) → User issue
- `internal_error` (5%+) → Our bug

### Step 2: Check payment provider status (2 minutes)

- Stripe: https://status.stripe.com/
- PayPal: https://status.paypal.com/
- Square: https://status.squareup.com/

If provider down → See "Payment Provider Outage" remediation

### Step 3: Check recent deploys (3 minutes)

```bash
# Check last 5 deploys
kubectl rollout history deployment/checkout-service --limit=5

# Check current version
kubectl get deployment checkout-service -o jsonpath='{.spec.template.spec.containers[0].image}'
```

If recent deploy → See "Recent Deploy" remediation

### Step 4: Check affected user tiers (3 minutes)

```sql
SELECT
  user.subscription,
  COUNT(*) as affected_users,
  COUNT(*) / SUM(COUNT(*)) OVER () as percentage
FROM logs
WHERE
  outcome = 'error'
  AND path = '/api/checkout'
  AND @timestamp > ago(1h)
GROUP BY user.subscription
```

If only one tier affected → See "Tier-Specific Issue" remediation

### Step 5: Check database performance (5 minutes)

```sql
-- Check slow queries
SELECT
  query,
  mean_exec_time,
  calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10
```

If database slow → See "Database Slow" remediation

## Remediation

### Payment Provider Outage

**Diagnosis:** Status page shows outage, `payment_timeout` errors spike

**Action:**
1. Enable fallback provider (5 minutes):
   ```bash
   kubectl set env deployment/checkout-service FALLBACK_PROVIDER=paypal
   kubectl rollout status deployment/checkout-service
   ```

2. Notify users via status page (2 minutes)

3. Monitor error rate (should drop to < 2%)

4. Wait for provider to recover

5. Switch back to primary provider:
   ```bash
   kubectl set env deployment/checkout-service FALLBACK_PROVIDER=stripe
   ```

### Recent Deploy

**Diagnosis:** Error spike correlates with recent deploy

**Action:**
1. Check diff (5 minutes):
   ```bash
   git diff <previous-sha> <current-sha> -- src/api/checkout.ts
   ```

2. If bug obvious → Fix forward (if < 10 minutes)

3. If bug not obvious → Rollback (2 minutes):
   ```bash
   kubectl rollout undo deployment/checkout-service
   kubectl rollout status deployment/checkout-service
   ```

4. Verify error rate drops

5. Debug in staging, redeploy when fixed

### Database Slow

**Diagnosis:** `mean_exec_time` > 1000ms for checkout queries

**Action:**
1. Check missing indexes (2 minutes):
   ```sql
   SELECT
     schemaname,
     tablename,
     attname
   FROM pg_stats
   WHERE schemaname = 'public'
     AND tablename IN ('orders', 'payments', 'carts')
     AND n_distinct > 100
     AND NOT EXISTS (
       SELECT 1 FROM pg_indexes
       WHERE tablename = pg_stats.tablename
         AND indexdef LIKE '%' || attname || '%'
     )
   ```

2. Add missing indexes (5 minutes)

3. Scale up read replicas (if needed):
   ```bash
   kubectl scale deployment/checkout-service-db-read --replicas=5
   ```

### Tier-Specific Issue

**Diagnosis:** Only premium users affected

**Action:**
1. Check feature flags (2 minutes):
   ```sql
   SELECT
     feature_flags,
     COUNT(*) as errors
   FROM logs
   WHERE outcome='error' AND user.subscription='premium'
   GROUP BY feature_flags
   ```

2. If feature flag correlated → Disable flag:
   ```bash
   # In feature flag admin UI
   # Or via API:
   curl -X POST https://flags.company.com/api/flags/new_checkout_flow \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"enabled": false}'
   ```

3. Monitor error rate

## Prevention

1. **End-to-end tests:** Add tests for checkout flow
2. **Canary deployment:** Roll out to 5% → 50% → 100%
3. **Circuit breaker:** Add circuit breaker for payment provider
4. **Retries:** Add retry logic with exponential backoff
5. **Fallback:** Implement fallback payment provider

## Related

- **Dashboard:** https://grafana.company.com/d/checkout
- **Past Incidents:**
  - 2024-01-10: Stripe outage (2 hours downtime)
  - 2023-12-15: Database index missing (30 min degradation)
- **Code:** https://github.com/company/api/blob/main/src/api/checkout.ts
- **Alerts:** https://github.com/company/monitoring/blob/main/alerts/checkout.yaml
```

**Why This Fix:**

**Before (no runbook):**
```
09:05 - Alert fires
09:06 - Oncall wakes up
09:08 - "What do I check?"
09:15 - Checks logs manually
09:30 - Googles "how to debug checkout errors"
09:45 - Calls teammate for help
10:00 - Finally identifies payment provider outage
10:15 - Googles "how to enable fallback provider"
10:30 - Issue resolved
---
Total: 85 minutes
```

**After (with runbook):**
```
09:05 - Alert fires with runbook link
09:06 - Oncall opens runbook
09:08 - Runs Step 1 query: "payment_timeout" errors
09:10 - Runs Step 2: Stripe status page shows outage
09:12 - Follows "Payment Provider Outage" remediation
09:15 - Enables fallback provider
09:17 - Monitors error rate → drops to 1%
09:20 - Notifies users via status page
---
Total: 15 minutes (5.6x faster)
```

**Runbook benefits:**
1. **MTTR**: 85min → 15min (5.6x faster)
2. **Confidence**: Clear steps, no guessing
3. **Knowledge**: Captures past incidents
4. **Consistency**: Every oncall follows same process
```

## Summary Output

After review, print summary:

```markdown
# Observability Review Complete

## Review Summary
- **Scope**: {SCOPE} {TARGET}
- **Files Reviewed**: X
- **Critical Paths**: X

## Findings
- **BLOCKER**: X
- **HIGH**: X
- **MED**: X
- **LOW**: X

## Category Breakdown
- **Logs** (Wide Events): X
- **Metrics** (Golden Signals): X
- **Tracing** (Distributed): X
- **Error Reporting**: X
- **Alertability**: X
- **Runbooks**: X

## Observability Posture

### Critical Paths

| Endpoint | Logs | Metrics | Tracing | Errors | Alerts | Runbooks |
|----------|------|---------|---------|--------|--------|----------|
| `/api/checkout` | ✅ | ⚠️ | ❌ | ✅ | ❌ | ❌ |
| `/api/auth/login` | ⚠️ | ❌ | ❌ | ✅ | ❌ | ❌ |

**Legend:**
- ✅ Complete (has business context, golden signals, etc.)
- ⚠️ Partial (missing business context or key signals)
- ❌ Missing (no instrumentation)

## Key Gaps
1. {Finding}: {Impact}
2. {Finding}: {Impact}

## Immediate Actions
1. {BLOCKER/HIGH finding}
2. {BLOCKER/HIGH finding}

## Report Location
Full report: `.claude/{SESSION_SLUG}/reviews/review-observability-{DATE}.md`

## Observability Checklist (Use for Future PRs)

Before merging code that touches critical paths:

**Logs:**
- [ ] Wide event with business context
- [ ] Correlation IDs
- [ ] Tail sampling

**Metrics:**
- [ ] Latency histogram
- [ ] Error counter
- [ ] Traffic counter
- [ ] Saturation gauge

**Tracing:**
- [ ] Spans for operations
- [ ] Business context in spans
- [ ] Trace sampling

**Error Reporting:**
- [ ] Error reporting integrated
- [ ] User context attached
- [ ] Error grouping

**Alerts:**
- [ ] Error rate alert
- [ ] Latency alert
- [ ] Runbook link

**Runbooks:**
- [ ] Runbook created/updated
- [ ] Debugging queries
- [ ] Remediation steps
```

## References

- [Logging Sucks](https://loggingsucks.com/) - Wide event philosophy
- [Google SRE Book - Monitoring](https://sre.google/sre-book/monitoring-distributed-systems/)
- [OpenTelemetry](https://opentelemetry.io/) - Distributed tracing standard
- Wide Event Observability Skill - Implementation guide
