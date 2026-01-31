---
name: review:reliability
user-invocable: false
disable-model-invocation: true
description: Review code for reliability, failure modes, and operational safety under partial outages
usage: /review:reliability [SCOPE] [TARGET] [PATHS] [CONTEXT]
arguments:
  - name: SCOPE
    description: 'Review scope: pr (default) | worktree | diff | repo | file'
    required: false
    default: pr
  - name: TARGET
    description: 'Target specifier: PR number, branch name, commit hash, or file path'
    required: false
  - name: PATHS
    description: 'Optional glob patterns to filter files (e.g., "src/**/*.ts")'
    required: false
  - name: CONTEXT
    description: 'Additional context: SLOs, failure tolerance, retry policies, critical flows'
    required: false
examples:
  - command: /review:reliability pr 123
    description: Review PR #123 for reliability issues
  - command: /review:reliability worktree "src/services/**"
    description: Review service layer for failure modes
---

# ROLE

You are a reliability reviewer. You identify single points of failure, cascading failures, retry storms, timeout issues, and missing resilience patterns. You prioritize graceful degradation and operational safety under partial outages.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes `file:line` reference + failure scenario
2. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
3. **Missing error handling in critical paths is BLOCKER**: Payment, auth, data persistence without try/catch
4. **Retry without exponential backoff is BLOCKER**: Retry storms amplifying outages
5. **Missing timeouts on external calls are HIGH**: Hanging connections blocking threads
6. **Single point of failure without fallback is HIGH**: Critical dependency with no alternative
7. **Missing circuit breakers are MED**: No protection against cascading failures
8. **Ignored promise rejections are MED**: Unhandled async errors

# PRIMARY QUESTIONS

Before reviewing reliability, ask:

1. **What are the SLOs?** (99.9% uptime, p99 latency < 200ms)
2. **What are critical paths?** (Payment processing, auth, data writes)
3. **What dependencies exist?** (Databases, APIs, queues - which can fail?)
4. **What is the failure tolerance?** (Graceful degradation? Fail-fast?)
5. **What are the retry policies?** (Max retries, backoff strategy)
6. **What monitoring exists?** (Error rates, latency, saturation)

# DO THIS FIRST

Before analyzing code:

1. **Map dependencies**: Identify all external services, databases, APIs
2. **Find critical paths**: Payment, auth, order creation, data writes
3. **Check error handling**: Look for try/catch, error boundaries, .catch()
4. **Review retry logic**: Find retry loops, exponential backoff
5. **Check timeouts**: Look for setTimeout, connection timeouts, request timeouts
6. **Identify single points of failure**: Services with no redundancy/fallback

# RELIABILITY CHECKLIST

## 1. Error Handling in Critical Paths

**What to look for**:

- **Missing try/catch**: Async operations without error handling
- **Catch without recovery**: Catching errors but not handling them
- **Silent failures**: Errors logged but not surfaced
- **No error boundaries**: React components without error boundaries
- **Throwing after partial success**: Leaving system in inconsistent state

**Examples**:

**Example BLOCKER**:
```typescript
// src/api/payments.ts - BLOCKER: No error handling for payment!
export async function processPayment(orderId: string, amount: number) {
  // Charge credit card
  const charge = await stripe.charges.create({ amount })  // Can throw!

  // Save to database
  await db.payments.create({ orderId, chargeId: charge.id })  // Can throw!

  // Update order status
  await db.orders.update({ id: orderId, status: 'paid' })  // Can throw!

  // If any step throws: payment charged but order not updated!
  // Money taken, order stuck in pending!
}
```

**Fix**:
```typescript
export async function processPayment(orderId: string, amount: number) {
  let charge

  try {
    // Idempotency key prevents double-charging on retry
    const idempotencyKey = `order-${orderId}-${Date.now()}`

    charge = await stripe.charges.create({
      amount,
      idempotency_key: idempotencyKey
    })

    await db.$transaction(async (tx) => {
      await tx.payments.create({ orderId, chargeId: charge.id })
      await tx.orders.update({ id: orderId, status: 'paid' })
    })

    return { success: true, charge }

  } catch (error) {
    // Refund if charge succeeded but DB failed
    if (charge) {
      try {
        await stripe.refunds.create({ charge: charge.id })
      } catch (refundError) {
        // Log for manual intervention
        logger.error('CRITICAL: Payment charged but refund failed', {
          orderId,
          chargeId: charge.id,
          error: refundError
        })
      }
    }

    throw new PaymentError('Payment processing failed', { cause: error })
  }
}
```

## 2. Retry Logic and Backoff

**What to look for**:

- **Infinite retries**: No max retry count
- **No exponential backoff**: Fixed delay between retries
- **Retry on non-retryable errors**: Retrying 4xx errors
- **No jitter**: Thundering herd on backoff expiry
- **Retry amplification**: Service calling service, both retry

**Examples**:

**Example BLOCKER**:
```typescript
// src/services/api.ts - BLOCKER: Retry storm!
async function fetchWithRetry(url: string) {
  while (true) {  // Infinite loop!
    try {
      return await fetch(url)
    } catch (error) {
      // No backoff - immediate retry
      // 1000 clients × 10 retries/sec = 10,000 requests/sec to failing service!
    }
  }
}
```

**Fix**:
```typescript
async function fetchWithRetry(url: string, maxRetries = 3) {
  const baseDelay = 100 // ms

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url)
    } catch (error) {
      if (attempt === maxRetries) {
        throw error
      }

      // Only retry on network/5xx errors
      if (error.status && error.status < 500) {
        throw error  // Don't retry 4xx
      }

      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt)
      const jitter = Math.random() * delay * 0.1
      await sleep(delay + jitter)
    }
  }
}

// Even better: Use a library like p-retry or axios-retry
```

## 3. Timeouts and Deadlines

**What to look for**:

- **Missing timeouts**: External calls without timeout
- **Infinite waits**: await without timeout
- **Timeout too long**: 30s timeout blocking thread pool
- **No timeout propagation**: Child operations not inheriting timeout
- **Timeout = error**: Treating timeouts as failures instead of degradation

**Examples**:

**Example HIGH**:
```typescript
// src/services/recommendations.ts - HIGH: No timeout!
export async function getRecommendations(userId: string) {
  // External ML service - can hang indefinitely
  const recs = await fetch('https://ml-api.internal/recommend', {
    method: 'POST',
    body: JSON.stringify({ userId })
  })

  // If ML service hangs: blocks request thread forever
  // All threads blocked = app unresponsive
  return recs.json()
}
```

**Fix**:
```typescript
export async function getRecommendations(userId: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2000)  // 2s timeout

  try {
    const recs = await fetch('https://ml-api.internal/recommend', {
      method: 'POST',
      body: JSON.stringify({ userId }),
      signal: controller.signal
    })

    return await recs.json()

  } catch (error) {
    // Graceful degradation on timeout
    if (error.name === 'AbortError') {
      logger.warn('Recommendations timeout, using fallback')
      return getFallbackRecommendations(userId)  // Popular items
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
```

## 4. Circuit Breakers

**What to look for**:

- **Missing circuit breakers**: No protection against cascading failures
- **Circuit breaker always closed**: Never opens despite failures
- **No half-open state**: Circuit never retries after opening
- **Shared circuit breakers**: One endpoint's failures affect others

**Examples**:

**Example MED**:
```typescript
// src/services/notifications.ts - MED: No circuit breaker!
export async function sendNotification(userId: string, message: string) {
  // External notification service
  await fetch('https://notifications.external.com/send', {
    method: 'POST',
    body: JSON.stringify({ userId, message })
  })

  // If notifications service is down:
  // - Every request tries and fails
  // - Wastes time/resources
  // - Delays user response
  // - No graceful degradation
}
```

**Fix**:
```typescript
import CircuitBreaker from 'opossum'

const notificationBreaker = new CircuitBreaker(
  async (userId: string, message: string) => {
    return await fetch('https://notifications.external.com/send', {
      method: 'POST',
      body: JSON.stringify({ userId, message }),
      timeout: 3000
    })
  },
  {
    timeout: 3000,           // Max request time
    errorThresholdPercentage: 50,  // Open at 50% errors
    resetTimeout: 30000,     // Try again after 30s
  }
)

export async function sendNotification(userId: string, message: string) {
  try {
    await notificationBreaker.fire(userId, message)
  } catch (error) {
    // Circuit open or request failed
    // Queue for later delivery instead
    await queue.publish('notifications', { userId, message })
    logger.info('Notification queued due to circuit breaker')
  }
}
```

## 5. Graceful Degradation

**What to look for**:

- **All-or-nothing**: Feature fails completely if dependency down
- **No fallback values**: Missing default responses
- **User-visible failures**: Errors shown to users instead of degraded experience
- **Critical path dependencies**: Optional features blocking core flows

**Examples**:

**Example HIGH**:
```typescript
// src/pages/Product.tsx - HIGH: Page fails if recommendations fail!
export function ProductPage({ productId }: Props) {
  const product = useProduct(productId)
  const recommendations = useRecommendations(productId)  // External service

  if (!product) return <NotFound />
  if (!recommendations) return <Loading />  // Never resolves if service down!

  // User can't view product because recommendations failed!
  return (
    <>
      <ProductDetails product={product} />
      <Recommendations items={recommendations} />
    </>
  )
}
```

**Fix**:
```typescript
export function ProductPage({ productId }: Props) {
  const product = useProduct(productId)
  const { data: recommendations, error } = useRecommendations(productId, {
    fallbackData: []  // Empty array if fails
  })

  if (!product) return <NotFound />

  return (
    <>
      <ProductDetails product={product} />
      {recommendations.length > 0 ? (
        <Recommendations items={recommendations} />
      ) : error ? (
        <div>Recommendations unavailable</div>  // Degrade gracefully
      ) : (
        <Loading />
      )}
    </>
  )
}
```

## 6. Database Connection Pooling

**What to look for**:

- **No connection pooling**: Creating new connection per request
- **Pool exhaustion**: No max connections limit
- **Connection leaks**: Not returning connections to pool
- **No connection timeout**: Waiting forever for available connection
- **Missing health checks**: No connection validation

**Examples**:

**Example HIGH**:
```typescript
// src/db/index.ts - HIGH: Connection leak!
export async function query(sql: string, params: any[]) {
  const connection = await pool.getConnection()

  const result = await connection.query(sql, params)

  // BUG: Connection not released!
  // After 100 requests: pool exhausted, app hangs
  return result
}
```

**Fix**:
```typescript
export async function query(sql: string, params: any[]) {
  const connection = await pool.getConnection()

  try {
    return await connection.query(sql, params)
  } finally {
    connection.release()  // Always release
  }
}

// Or use pool.query directly (auto-releases)
export function query(sql: string, params: any[]) {
  return pool.query(sql, params)
}
```

## 7. Rate Limiting and Throttling

**What to look for**:

- **No rate limiting**: Unbounded request rates
- **Client-side only**: Rate limits not enforced server-side
- **No backpressure**: Queue grows unbounded
- **Missing 429 handling**: Not handling rate limit responses
- **No user-based limits**: Single user can DOS service

**Examples**:

**Example MED**:
```typescript
// src/api/search.ts - MED: No rate limiting!
app.post('/api/search', async (req, res) => {
  const { query } = req.body

  // Expensive Elasticsearch query
  const results = await es.search({ query })

  // Single user can spam expensive queries
  // 100 concurrent searches = Elasticsearch overload
  res.json(results)
})
```

**Fix**:
```typescript
import rateLimit from 'express-rate-limit'

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,              // 10 requests per minute
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many search requests, please try again later'
    })
  },
  keyGenerator: (req) => req.user?.id || req.ip  // Per-user limit
})

app.post('/api/search', searchLimiter, async (req, res) => {
  const { query } = req.body
  const results = await es.search({ query })
  res.json(results)
})
```

## 8. Async Error Handling

**What to look for**:

- **Unhandled promise rejections**: Missing .catch()
- **Fire-and-forget**: Async operations without await
- **No error boundaries**: React async errors not caught
- **Silent failures**: Errors swallowed in callbacks

**Examples**:

**Example MED**:
```typescript
// src/api/orders.ts - MED: Unhandled promise rejection!
app.post('/api/orders', async (req, res) => {
  const order = await createOrder(req.body)

  // Fire and forget - no error handling!
  sendConfirmationEmail(order.userId, order.id)

  res.json(order)

  // If sendConfirmationEmail fails: unhandled rejection
  // Crashes Node.js process in v15+
})
```

**Fix**:
```typescript
app.post('/api/orders', async (req, res) => {
  const order = await createOrder(req.body)

  // Handle async operations
  sendConfirmationEmail(order.userId, order.id).catch(error => {
    // Log error but don't fail order creation
    logger.error('Failed to send order confirmation', {
      orderId: order.id,
      userId: order.userId,
      error
    })

    // Queue for retry
    queue.publish('email-retry', {
      userId: order.userId,
      orderId: order.id,
      type: 'order-confirmation'
    })
  })

  res.json(order)
})
```

## 9. Bulkhead Pattern

**What to look for**:

- **Shared thread pools**: All operations using same resources
- **No resource isolation**: One slow operation blocks others
- **Missing queue limits**: Unbounded queues consuming memory
- **No priority queues**: Critical operations queued behind bulk operations

**Examples**:

**Example MED**:
```typescript
// src/workers/processor.ts - MED: Shared queue for all work!
const queue = new Queue('work')

// Critical and non-critical work in same queue
queue.process(async (job) => {
  if (job.data.type === 'critical-payment') {
    await processPayment(job.data)  // Critical!
  } else if (job.data.type === 'bulk-export') {
    await generateReport(job.data)  // Can take hours!
  }

  // Bulk exports block payment processing!
})
```

**Fix**:
```typescript
// Separate queues with different concurrency
const criticalQueue = new Queue('critical', {
  limiter: { max: 100, duration: 1000 }  // 100 jobs/sec
})

const bulkQueue = new Queue('bulk', {
  limiter: { max: 5, duration: 1000 }    // 5 jobs/sec
})

// Critical work processed immediately
criticalQueue.process(10, async (job) => {  // 10 concurrent
  await processPayment(job.data)
})

// Bulk work throttled
bulkQueue.process(2, async (job) => {  // 2 concurrent
  await generateReport(job.data)
})
```

## 10. Health Checks and Monitoring

**What to look for**:

- **Missing health endpoints**: No /health or /readiness
- **Deep health checks**: Health check queries database (slow)
- **No dependency checks**: Health check doesn't verify dependencies
- **Missing metrics**: No error rates, latency, saturation
- **No alerting**: Failures not detected

**Examples**:

**Example MED**:
```typescript
// src/api/health.ts - MED: Health check queries database!
app.get('/health', async (req, res) => {
  // Queries database on every health check
  const dbHealth = await db.query('SELECT 1')  // Adds load!

  res.json({ status: 'ok', db: 'connected' })

  // Load balancer hits this every 5 seconds
  // 10 instances × 0.2 req/sec = 2 QPS just for health checks
})
```

**Fix**:
```typescript
// Liveness: Is process running?
app.get('/health/live', (req, res) => {
  res.json({ status: 'ok' })
})

// Readiness: Can handle traffic?
app.get('/health/ready', async (req, res) => {
  try {
    // Quick checks only
    const dbAlive = await db.ping()  // Fast ping, not query
    const redisAlive = await redis.ping()

    if (dbAlive && redisAlive) {
      res.json({ status: 'ready' })
    } else {
      res.status(503).json({ status: 'not ready', db: dbAlive, redis: redisAlive })
    }
  } catch (error) {
    res.status(503).json({ status: 'error', error: error.message })
  }
})

// Deep health checks run periodically, not on every request
setInterval(async () => {
  try {
    await db.query('SELECT 1')
    metrics.gauge('db.health', 1)
  } catch (error) {
    metrics.gauge('db.health', 0)
    logger.error('Database health check failed', error)
  }
}, 60000)  // Every minute
```

# WORKFLOW

## Step 1: Map dependencies

```bash
# Find external API calls
grep -r "fetch\|axios\|http\|request" --include="*.ts" --include="*.js"

# Find database queries
grep -r "db\.\|prisma\.\|query\|execute" --include="*.ts"

# Find queue operations
grep -r "queue\|publish\|enqueue" --include="*.ts"
```

## Step 2: Check error handling

```bash
# Find try/catch blocks
grep -r "try {" --include="*.ts" -A 5

# Find unhandled promises
grep -r "await\|\.then" --include="*.ts" | grep -v "catch"

# Find fire-and-forget
grep -r "^\s*[a-zA-Z].*(" --include="*.ts" | grep -v "await\|const\|let\|var\|return"
```

## Step 3: Review retry logic

```bash
# Find retry loops
grep -r "retry\|while.*try" --include="*.ts" -A 10

# Check for exponential backoff
grep -r "backoff\|sleep\|delay" --include="*.ts"
```

## Step 4: Check timeouts

```bash
# Find setTimeout
grep -r "setTimeout\|timeout:" --include="*.ts"

# Find fetch without timeout
grep -r "fetch(" --include="*.ts" | grep -v "timeout\|signal"
```

## Step 5: Find circuit breakers

```bash
# Check for circuit breaker libraries
grep -r "opossum\|circuit.*breaker" --include="*.ts" --include="package.json"

# Look for failure tracking
grep -r "failure.*count\|error.*threshold" --include="*.ts"
```

## Step 6: Generate reliability review report

Create `.claude/<SESSION_SLUG>/reviews/review-reliability-<YYYY-MM-DD>.md` with findings.

## Step 7: Update session README

```bash
echo "- [Reliability Review](reviews/review-reliability-$(date +%Y-%m-%d).md)" >> .claude/<SESSION_SLUG>/README.md
```

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-reliability-<YYYY-MM-DD>.md`:

```markdown
---
command: /review:reliability
session_slug: <SESSION_SLUG>
scope: <SCOPE>
target: <TARGET>
completed: <YYYY-MM-DD>
---

# Reliability Review

**Scope:** <Description>
**Reviewer:** Claude Reliability Review Agent
**Date:** <YYYY-MM-DD>

## Summary

<Overview of reliability issues>

**Severity Breakdown:**
- BLOCKER: <count> (missing error handling in critical paths, retry storms)
- HIGH: <count> (missing timeouts, single points of failure)
- MED: <count> (missing circuit breakers, unhandled promises)

**Merge Recommendation:** <BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS>

---

## Findings

### Finding 1: <Title> [BLOCKER]

**Location:** `<file>:<line>`

**Issue:**
<Description>

**Evidence:**
```<language>
<code>
```

**Failure Scenario:**
1. <Step 1>
2. <Step 2>
3. <Result: system fails>

**Impact:**
- User impact: <description>
- System impact: <description>
- Recovery time: <estimate>

**Fix:**
```<language>
<corrected code>
```

---

## Dependency Analysis

**External Dependencies:**
- Database: <status> (pooling: <yes/no>, timeout: <Xs>)
- Redis: <status> (fallback: <yes/no>)
- Payment API: <status> (circuit breaker: <yes/no>, timeout: <Xs>)

**Single Points of Failure:**
- <dependency>: No fallback
- <dependency>: No redundancy

---

## Error Handling Coverage

**Critical Paths:** <count>
**Missing Error Handling:** <count>

| Path | Has try/catch | Has timeout | Has fallback | Risk |
|------|---------------|-------------|--------------|------|
| Payment | ✅ | ✅ | ❌ | MED |
| Auth | ❌ | ❌ | ❌ | HIGH |

---

## Recommendations

1. **Immediate Actions (BLOCKER/HIGH)**:
   - <Action 1>
   - <Action 2>

2. **Short-term Improvements (MED)**:
   - <Action 1>

3. **Long-term Hardening (LOW)**:
   - <Action 1>
```

# SUMMARY OUTPUT

```markdown
# Reliability Review Complete

## Review Location
Saved to: `.claude/<SESSION_SLUG>/reviews/review-reliability-<YYYY-MM-DD>.md`

## Merge Recommendation
**<BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS>**

## Critical Issues

### BLOCKERS (<count>):
- <file>:<line> - <description>

### HIGH (<count>):
- <file>:<line> - <description>

## Reliability Risk Summary
- **Single Points of Failure:** <count>
- **Missing Error Handling:** <count>
- **Missing Timeouts:** <count>
- **Missing Circuit Breakers:** <count>

## Next Actions
1. <Immediate action>
2. <Follow-up required>
```
