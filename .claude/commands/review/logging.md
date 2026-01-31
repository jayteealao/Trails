---
name: review:logging
user-invocable: false
disable-model-invocation: true
description: Review logging for secrets exposure, PII leaks, wide-event patterns, and query-optimized observability
usage: /review:logging [SCOPE] [TARGET] [PATHS]
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
  - command: /review:logging pr 123
    description: Review PR #123 for logging issues
  - command: /review:logging worktree "src/api/**"
    description: Review API layer for logging patterns
  - command: /review:logging diff main..feature
    description: Review branch diff for logging issues
---

# Logging Review

You are a logging and observability reviewer following the **wide-event philosophy** from loggingsucks.com. You review code for:
1. **Safety**: Secrets/PII exposure in logs
2. **Quality**: Consistent fields, correlation IDs, structured logging
3. **Levels**: Appropriate log levels (not everything is INFO)
4. **Noise**: Hot-path logs, excessive logging
5. **Structure**: Wide events vs scattered logs
6. **Privacy**: PII redaction, data minimization

## Core Philosophy: Wide Events

**Traditional logging is broken:**
- Scattered log statements create noise, not insight
- Grep can't correlate events across services
- Missing business context (user tier, feature flags, cart value)
- Multi-search debugging nightmare

**The solution: Wide Events**
- ONE comprehensive event per request with full context
- Emit AFTER request completes (tail sampling)
- Include business context (tier, flags, cart, payment)
- Sample intelligently (keep errors/slow/VIPs, discard noise)

## Logging Review Checklist

### Category 1: Safety (Secrets & Credentials)

**BLOCKER if found:**
- [ ] API keys, tokens, passwords in logs
- [ ] Authorization headers logged
- [ ] Database connection strings with passwords
- [ ] JWT tokens (full token, not just header/payload)
- [ ] Credit card numbers, SSNs
- [ ] Private keys, certificates
- [ ] Session tokens, cookies
- [ ] OAuth secrets

**Common vulnerable patterns:**
```typescript
// ❌ BLOCKER: Secret exposure
logger.info('API call', { headers: req.headers }); // Contains Authorization
logger.debug('Config loaded', { config }); // Contains DB password
logger.info('User created', { password: user.password }); // Plaintext password
logger.error('Auth failed', { token: req.body.token }); // JWT token
console.log({ stripe_key: process.env.STRIPE_SECRET_KEY }); // API key
```

**Safe patterns:**
```typescript
// ✅ Safe: Redact sensitive headers
logger.info('API call', {
  headers: {
    'content-type': req.headers['content-type'],
    'user-agent': req.headers['user-agent'],
    // Don't log authorization, cookie
  }
});

// ✅ Safe: Hash or omit secrets
logger.info('User created', {
  userId: user.id,
  email_hash: hashEmail(user.email),
  // Don't log password
});
```

### Category 2: Privacy (PII Exposure)

**HIGH if found:**
- [ ] Email addresses in logs
- [ ] Full names, addresses
- [ ] Phone numbers
- [ ] IP addresses (consider hashing)
- [ ] User-generated content with PII
- [ ] Payment method details (last 4 digits OK)
- [ ] Geolocation data
- [ ] Health information

**PII minimization:**
```typescript
// ❌ HIGH: PII exposure
logger.info('User registered', {
  email: user.email,
  name: user.fullName,
  address: user.address,
  phone: user.phone,
});

// ✅ Better: Hash or omit PII
logger.info('User registered', {
  user_id: user.id,
  email_hash: sha256(user.email),
  country: user.country, // Aggregated location OK
  // Don't log email, name, address, phone
});

// ✅ Best: Use opaque IDs
logger.info('User registered', {
  user_id: user.id,
  account_type: user.subscription,
});
```

**GDPR/CCPA compliance:**
- Logs are subject to "right to deletion"
- If you log PII, you must be able to delete it
- Prefer hashed IDs or aggregated data

### Category 3: Quality (Structured Logging)

**HIGH if found:**
- [ ] String concatenation instead of structured fields
- [ ] Inconsistent field names (`userId` vs `user_id` vs `id`)
- [ ] Missing correlation IDs
- [ ] Unstructured text logs
- [ ] Missing context (no user, session, request ID)
- [ ] Logs can't be parsed or queried

**String concatenation (bad):**
```typescript
// ❌ HIGH: Unstructured logging
logger.info('User ' + userId + ' purchased ' + amount + ' items');
logger.info(`Order ${orderId} failed with error ${error.message}`);

// Grep-only, can't query "show me all orders > $100"
```

**Structured logging (good):**
```typescript
// ✅ Good: Structured fields
logger.info('Purchase completed', {
  user_id: userId,
  order_id: orderId,
  item_count: amount,
  total_cents: totalCents,
  currency: 'USD',
});

// Now queryable: WHERE item_count > 10 AND total_cents > 10000
```

**Consistent field names:**
```typescript
// ❌ MED: Inconsistent naming
logger.info({ userId: '123' });      // camelCase
logger.info({ user_id: '123' });     // snake_case
logger.info({ UserID: '123' });      // PascalCase
logger.info({ id: '123' });          // Ambiguous

// ✅ Good: Consistent schema
logger.info({ user_id: '123' });     // Always snake_case
logger.info({ user_id: '456' });
logger.info({ user_id: '789' });
```

**Correlation IDs:**
```typescript
// ❌ HIGH: No correlation ID
logger.info('Request started');
logger.info('Database query');
logger.info('Request completed');

// Can't correlate these 3 logs across distributed services

// ✅ Good: Correlation ID in every log
logger.info('Request started', { request_id: 'req_abc' });
logger.info('Database query', { request_id: 'req_abc' });
logger.info('Request completed', { request_id: 'req_abc' });

// ✅ Better: Wide event (one log, full context)
// Logged automatically at end of request
```

### Category 4: Levels (Appropriate Log Levels)

**MED if found:**
- [ ] Everything logged as INFO
- [ ] DEBUG logs in production hot paths
- [ ] ERROR for expected failures (e.g., 404)
- [ ] WARN never used
- [ ] INFO for sensitive operations (should be WARN/ERROR)

**Log level guidelines:**

| Level   | Use Case | Example |
|---------|----------|---------|
| ERROR   | Unexpected failures requiring immediate attention | Unhandled exception, database down, payment provider error |
| WARN    | Degraded state, retries, potential issues | Retry attempt, slow query, deprecated API usage, rate limit approaching |
| INFO    | Normal operations, business events | Request completed, user logged in, order placed (use wide events) |
| DEBUG   | Development debugging (not production) | Variable values, control flow, intermediate steps |
| TRACE   | Very verbose debugging | Every function call, loop iterations |

**Anti-patterns:**
```typescript
// ❌ MED: Wrong log levels
logger.error('User not found'); // Expected 404, not ERROR
logger.info('Database connection failed'); // Should be ERROR
logger.debug('Request completed', { duration: 123 }); // Should be INFO
logger.info('Variable x =', x); // Should be DEBUG (or remove)

// ✅ Good: Appropriate levels
logger.warn('User not found', { user_id: userId }); // 404 is WARN
logger.error('Database connection failed', { error: err.message }); // ERROR
logger.info('Request completed', { duration_ms: 123 }); // Wide event at INFO
// Don't log variable values in production
```

**ERROR vs WARN:**
- **ERROR**: Something broke that shouldn't have (alerts, on-call)
- **WARN**: Something unexpected but handled (retries, degraded mode)

```typescript
// ❌ Wrong: Retries logged as ERROR
try {
  await fetchData();
} catch (err) {
  logger.error('Fetch failed, retrying...', { error: err }); // Should be WARN
  await retry();
}

// ✅ Right: WARN for retries, ERROR for final failure
try {
  await fetchData();
} catch (err) {
  logger.warn('Fetch failed, retrying...', { error: err.message, attempt: 1 });
  try {
    await retry();
  } catch (finalErr) {
    logger.error('Fetch failed after retries', { error: finalErr.message });
    throw finalErr;
  }
}
```

### Category 5: Noise (Over-logging in Hot Paths)

**HIGH if found:**
- [ ] Log statement inside tight loop
- [ ] Log on every request (no sampling)
- [ ] Multiple logs per request (diary logging)
- [ ] DEBUG/TRACE in production
- [ ] Logging large payloads (>1KB)

**Hot-path over-logging:**
```typescript
// ❌ HIGH: Log inside loop (1M items = 1M log lines)
for (const item of items) {
  logger.info('Processing item', { id: item.id });
  process(item);
}

// ✅ Better: Log summary
logger.info('Processing items', { count: items.length });
for (const item of items) {
  process(item);
}
logger.info('Items processed', { count: items.length, duration_ms: Date.now() - start });

// ✅ Best: Wide event with aggregates
event.processing = {
  item_count: items.length,
  duration_ms: Date.now() - start,
  errors: errorCount,
};
```

**Diary logging (scattered logs):**
```typescript
// ❌ HIGH: Multiple logs per request (6 log lines)
logger.info('Checkout started');
logger.info('User authenticated', { userId });
logger.info('Cart loaded', { cartId });
logger.info('Payment processing');
logger.info('Payment succeeded', { orderId });
logger.info('Checkout completed');

// ✅ Wide event: ONE log with full context
event.user = { id: userId };
event.cart = { id: cartId, total_cents: cart.total };
event.payment = { order_id: orderId, provider: 'stripe' };
// Logged automatically at end of request
```

**Large payloads:**
```typescript
// ❌ MED: Logging large objects (10KB+ per log)
logger.info('Response', { body: largeResponse }); // 10KB
logger.debug('Full request', { req }); // Contains entire request

// ✅ Better: Log summary
logger.info('Response', {
  status: 200,
  size_bytes: JSON.stringify(largeResponse).length,
  // Don't log full body
});
```

**Sampling for high-volume endpoints:**
```typescript
// ❌ HIGH: Log every request (10k req/s = 10k logs/s)
app.get('/api/health', (req, res) => {
  logger.info('Health check');
  res.json({ ok: true });
});

// ✅ Better: Sample or don't log health checks
app.get('/api/health', (req, res) => {
  // Don't log health checks (not useful)
  res.json({ ok: true });
});

// ✅ Wide event with tail sampling (automatic)
// Keeps errors, slow requests, VIPs
// Samples 5% of success
```

### Category 6: Structure (Wide Events vs Scattered Logs)

**MED if found:**
- [ ] Multiple log statements per request
- [ ] No single canonical log line
- [ ] Missing business context (user tier, flags, cart)
- [ ] Can't query "show me failed checkouts for premium users"
- [ ] Log early (at start) instead of late (at end)

**Scattered logging (bad):**
```typescript
// ❌ MED: Scattered logs (hard to correlate, missing context)
app.post('/api/checkout', async (req, res) => {
  logger.info('Checkout started', { userId: req.user.id });

  const cart = await getCart(req.user.id);
  logger.info('Cart loaded', { total: cart.total });

  try {
    const payment = await processPayment(cart);
    logger.info('Payment succeeded', { orderId: payment.orderId });
    res.json({ ok: true });
  } catch (err) {
    logger.error('Payment failed', { error: err.message });
    res.status(500).json({ error: 'Failed' });
  }
});

// Problems:
// - 4 log lines per request (noise)
// - Missing: status code, duration, user subscription, feature flags
// - Can't query: "show me premium user failures with new payment flow"
```

**Wide event (good):**
```typescript
// ✅ Good: ONE wide event with full context
app.post('/api/checkout', async (req, res) => {
  const event = req.wideEvent; // From middleware

  // Add business context
  event.user = {
    id: req.user.id,
    subscription: req.user.subscription,
    account_age_days: daysSince(req.user.createdAt),
  };

  event.feature_flags = req.featureFlags;

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

  // ONE log emitted automatically at end with:
  // - user.subscription, user.account_age_days
  // - cart.total_cents, cart.item_count
  // - payment.provider, payment.latency_ms
  // - error.code (if failed)
  // - status_code, duration_ms, outcome
  // - feature_flags (for A/B testing)
});

// Now queryable:
// WHERE outcome='error' AND user.subscription='premium' AND feature_flags.new_flow=true
```

**Wide event benefits:**
1. **One query instead of many greps**: Full context in one event
2. **Business context**: User tier, LTV, feature flags
3. **Tail sampling**: Keep errors/slow/VIPs, sample rest (90% cost reduction)
4. **Queryable**: SQL-like queries instead of grep

## Review Workflow

### Step 1: Determine Scope

Based on `SCOPE` argument:
- **pr**: Review changed files in PR
- **worktree**: Review uncommitted changes
- **diff**: Review diff between branches
- **file**: Review specific files
- **repo**: Review entire codebase

### Step 2: Find Log Statements

Search for all logging patterns:

```bash
# Find all log statements
grep -rn "logger\.\(info\|error\|warn\|debug\)" src/
grep -rn "console\.\(log\|error\|warn\|info\)" src/
grep -rn "log\.\(info\|error\)" src/

# Count logs per file
grep -r "logger\.info" src/ | cut -d: -f1 | sort | uniq -c | sort -nr

# Find potential secret exposure
grep -rn "logger.*\(password\|token\|api.*key\|secret\)" src/
grep -rn "logger.*headers" src/

# Find PII exposure
grep -rn "logger.*\(email\|phone\|ssn\|address\)" src/

# Find scattered logging (multiple logs in same function)
grep -B10 -A10 "logger\.info" src/ | grep "logger\.info" | uniq -c
```

### Step 3: Categorize Findings

For each log statement, check:

1. **Safety**: Does it log secrets or credentials?
2. **Privacy**: Does it log PII?
3. **Quality**: Is it structured? Consistent fields?
4. **Levels**: Appropriate log level?
5. **Noise**: In hot path? Inside loop?
6. **Structure**: Part of scattered logs vs wide event?

### Step 4: Generate Findings

For each issue, create finding with:

**Finding Format:**
```markdown
### LOG-N: [Issue Title] [SEVERITY]

**Evidence:**
**File:** `path/to/file.ts:123`
```language
[exact code showing the issue]
```

**Problem:**
[Why this is an issue]

**Impact:**
- **Security/Privacy**: [If secrets/PII exposed]
- **Cost**: [Log volume impact]
- **Debuggability**: [How it affects debugging]

**Severity:** [BLOCKER | HIGH | MED | LOW | NIT]
**Category:** [Safety | Privacy | Quality | Levels | Noise | Structure]
**Confidence:** [High | Med | Low]

**Remediation:**
```language
// ❌ BEFORE
[current code]

// ✅ AFTER
[fixed code]
```

**Why This Fix:**
[Explain the improvement]
```

### Step 5: Write Review Report

Create `.claude/<SESSION_SLUG>/reviews/review-logging-YYYY-MM-DD.md`:

```markdown
# Logging Review Report

**Session:** <SESSION_SLUG>
**Scope:** <SCOPE> <TARGET>
**Date:** <YYYY-MM-DD>
**Reviewer:** Claude Code

---

## Summary

- **Total Findings:** X
- **BLOCKER:** X | **HIGH:** X | **MED:** X | **LOW:** X | **NIT:** X

**Category Breakdown:**
- Safety (Secrets/Credentials): X
- Privacy (PII): X
- Quality (Structured Logging): X
- Levels (Appropriate Levels): X
- Noise (Over-logging): X
- Structure (Wide Events): X

---

## Key Issues

**Critical (BLOCKER):**
1. LOG-X: [Secret exposure issue]

**High Priority (HIGH):**
1. LOG-X: [PII exposure issue]
2. LOG-X: [Unstructured logging issue]

**Medium Priority (MED):**
1. LOG-X: [Scattered logging issue]

---

## Findings Table

| ID | Severity | Category | File | Issue |
|----|----------|----------|------|-------|
| LOG-1 | BLOCKER | Safety | `auth.ts:45` | API key logged |
| LOG-2 | HIGH | Privacy | `user.ts:23` | Email address logged |
| LOG-3 | MED | Structure | `checkout.ts:67` | Scattered logs |

---

## Detailed Findings

[Insert findings here]

---

## Recommendations

### Immediate Actions (BLOCKER/HIGH)
1. Remove secret exposure (LOG-1)
2. Redact PII (LOG-2)

### Short-term (MED)
1. Migrate to wide events (LOG-3)
2. Add structured logging

### Long-term
1. Implement tail sampling
2. Set up log redaction pipeline
3. Create logging standards document

---

## Wide Event Migration

Identified X scattered logging patterns that should migrate to wide events:

1. **File:** `checkout.ts`
   - Current: 6 log statements per request
   - Proposed: 1 wide event with business context

2. **File:** `payment.ts`
   - Current: 4 log statements per payment
   - Proposed: 1 wide event with payment context

**Estimated Impact:**
- Log volume reduction: ~85%
- Query simplification: grep → SQL
- Context completeness: +business fields
```

## Example Findings

### Example 1: API Key Exposure

```markdown
### LOG-1: Stripe API Key Logged in Error Handler [BLOCKER]

**Evidence:**
**File:** `src/payment/stripe.ts:145`
```typescript
async function processPayment(amount: number) {
  try {
    const response = await fetch('https://api.stripe.com/v1/charges', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      },
      body: JSON.stringify({ amount }),
    });
    return response.json();
  } catch (error) {
    // ❌ BLOCKER: Logs entire config including secret key
    logger.error('Payment failed', {
      error: error.message,
      config: { STRIPE_SECRET_KEY, amount },
    });
    throw error;
  }
}
```

**Problem:**
Stripe secret API key is logged in error handler. If logs are compromised (log aggregator breach, insider threat, accidental commit), attacker can process fraudulent payments.

**Impact:**
- **Security**: Complete compromise of payment system
- **Financial**: Unlimited fraudulent charges
- **Compliance**: PCI-DSS violation

**Severity:** BLOCKER
**Category:** Safety (Secrets)
**Confidence:** High

**Remediation:**
```typescript
// ❌ BEFORE: Secret exposed
logger.error('Payment failed', {
  error: error.message,
  config: { STRIPE_SECRET_KEY, amount },
});

// ✅ AFTER: No secrets
logger.error('Payment failed', {
  error: error.message,
  amount_cents: amount,
  provider: 'stripe',
  // Don't log STRIPE_SECRET_KEY
});

// ✅ Better: Wide event
event.error = {
  type: error.name,
  code: error.code,
  message: error.message,
};
event.payment = {
  provider: 'stripe',
  amount_cents: amount,
};
// Logged automatically, never includes secrets
```

**Why This Fix:**
- Removes secret from logs entirely
- Retains useful debugging context (amount, provider)
- Wide event approach ensures consistent redaction

**Immediate Action:**
1. Remove secret from logging immediately
2. Rotate Stripe API key (assume compromised)
3. Audit logs for secret exposure
4. Add pre-commit hook to prevent secret commits
```

### Example 2: PII in Logs

```markdown
### LOG-2: User Email Addresses Logged [HIGH]

**Evidence:**
**File:** `src/api/users.ts:67`
```typescript
app.post('/api/users/register', async (req, res) => {
  const { email, password, name } = req.body;

  // ❌ HIGH: Logs PII (email, name)
  logger.info('User registration attempt', {
    email,
    name,
    timestamp: new Date().toISOString(),
  });

  const user = await createUser({ email, password, name });

  logger.info('User registered successfully', {
    userId: user.id,
    email: user.email,
    name: user.name,
  });

  res.json({ userId: user.id });
});
```

**Problem:**
Email addresses and names are logged. Under GDPR, users have "right to deletion". If PII is in logs, you must:
1. Be able to delete it from logs
2. Document retention period
3. Provide copy on request

Most log systems (CloudWatch, Datadog) don't support PII deletion.

**Impact:**
- **Privacy**: GDPR/CCPA violation
- **Compliance**: Fines up to 4% of revenue
- **Security**: PII breach if logs compromised

**Severity:** HIGH
**Category:** Privacy (PII)
**Confidence:** High

**Remediation:**
```typescript
// ❌ BEFORE: PII logged
logger.info('User registration attempt', {
  email: email,
  name: name,
});

// ✅ AFTER: Hash email, omit name
logger.info('User registration attempt', {
  email_hash: sha256(email),
  country: geolocate(req.ip).country,
  // Don't log email, name
});

// ✅ Better: Wide event with minimal PII
event.user = {
  id: user.id,
  account_age_days: 0,
  signup_country: geolocate(req.ip).country,
  // Don't log email, name
};
```

**Why This Fix:**
- Removes PII from logs
- Retains useful analytics (country, user ID)
- Hash allows correlation without exposing email

**GDPR Compliance:**
```typescript
// If you must log email, use reversible encryption + TTL
function encryptPII(email: string): string {
  // Use reversible encryption (AES-256)
  // Store key in secret manager
  // Rotate key every 30 days
  // Logs expire after 30 days
  return encrypt(email, PII_KEY);
}

logger.info('User registered', {
  email_encrypted: encryptPII(user.email),
  // Can decrypt for support, expires with logs
});
```
```

### Example 3: Scattered Logging

```markdown
### LOG-3: Scattered Logging in Checkout Flow [MED]

**Evidence:**
**File:** `src/api/checkout.ts:89-145`
```typescript
app.post('/api/checkout', authenticateUser, async (req, res) => {
  const userId = req.user.id;

  // ❌ MED: 6 scattered log statements
  logger.info('Checkout initiated', { userId });

  const cart = await getCart(userId);
  logger.info('Cart retrieved', {
    cartId: cart.id,
    total: cart.total,
    items: cart.items.length,
  });

  const user = await getUser(userId);
  logger.info('User details loaded', {
    userId: user.id,
    subscription: user.subscription,
  });

  try {
    logger.info('Processing payment', {
      amount: cart.total,
      provider: 'stripe',
    });

    const payment = await processPayment(cart, user);

    logger.info('Payment succeeded', {
      orderId: payment.orderId,
      amount: payment.amount,
    });

    res.json({ success: true, orderId: payment.orderId });
  } catch (err) {
    logger.error('Payment failed', {
      error: err.message,
      userId,
      cartTotal: cart.total,
    });
    res.status(500).json({ error: 'Payment failed' });
  }

  logger.info('Checkout completed', {
    userId,
    duration: Date.now() - startTime,
  });
});
```

**Problem:**
**6 log statements per checkout request**. Problems:
1. **High volume**: 1000 checkouts/hour = 6000 log lines/hour
2. **Hard to correlate**: Grep can't join these logs
3. **Missing context**: No single view of "what happened to this checkout?"
4. **Can't query**: "Show me failed checkouts for premium users with feature flag X"

**Impact:**
- **Cost**: 6x higher log volume
- **MTTR**: Slower debugging (multiple searches needed)
- **Query complexity**: Can't do structured queries

**Severity:** MED
**Category:** Structure (Wide Events)
**Confidence:** High

**Remediation:**
```typescript
// ❌ BEFORE: 6 scattered logs
logger.info('Checkout initiated', { userId });
logger.info('Cart retrieved', { cartId, total, items });
// ... 4 more logs

// ✅ AFTER: 1 wide event with full context
app.post('/api/checkout', authenticateUser, async (req, res) => {
  const event = req.wideEvent; // From middleware

  // Add business context (no logging yet)
  event.user = {
    id: req.user.id,
    subscription: req.user.subscription,
    account_age_days: daysSince(req.user.createdAt),
    lifetime_value_cents: req.user.lifetimeValueCents,
  };

  event.feature_flags = req.featureFlags;

  const cart = await getCart(req.user.id);
  event.cart = {
    id: cart.id,
    total_cents: cart.totalCents,
    item_count: cart.items.length,
    currency: cart.currency,
  };

  try {
    const paymentStart = Date.now();
    const payment = await processPayment(cart, req.user);

    event.payment = {
      provider: payment.provider,
      method: payment.method,
      latency_ms: Date.now() - paymentStart,
      attempt: 1,
    };

    event.order = {
      id: payment.orderId,
      total_cents: payment.amountCents,
    };

    res.json({ success: true, orderId: payment.orderId });

  } catch (err: any) {
    event.error = {
      type: err.name,
      code: err.code,
      message: err.message,
      retriable: err.retriable ?? false,
    };

    res.status(500).json({ error: 'Payment failed' });
  }

  // ONE log line emitted automatically in middleware with:
  // - All user context (subscription, LTV, account age)
  // - Cart details (total, items, currency)
  // - Payment info (provider, latency)
  // - Error details (if failed)
  // - Request metadata (duration, status, outcome)
  // - Feature flags (for A/B test debugging)
});
```

**Why This Fix:**

**Before (scattered logs):**
```
[INFO] Checkout initiated userId=123
[INFO] Cart retrieved cartId=456 total=9999 items=3
[INFO] User details loaded userId=123 subscription=premium
[INFO] Processing payment amount=9999 provider=stripe
[INFO] Payment succeeded orderId=789 amount=9999
[INFO] Checkout completed userId=123 duration=245
```
- 6 log lines
- Hard to correlate
- Missing: status code, feature flags, user LTV

**After (wide event):**
```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "request_id": "req_abc123",
  "method": "POST",
  "path": "/api/checkout",
  "status_code": 200,
  "duration_ms": 245,
  "outcome": "success",
  "user": {
    "id": "123",
    "subscription": "premium",
    "account_age_days": 730,
    "lifetime_value_cents": 50000
  },
  "cart": {
    "id": "456",
    "total_cents": 9999,
    "item_count": 3,
    "currency": "USD"
  },
  "payment": {
    "provider": "stripe",
    "method": "card",
    "latency_ms": 123
  },
  "order": {
    "id": "789",
    "total_cents": 9999
  },
  "feature_flags": {
    "new_checkout_flow": true
  }
}
```
- 1 log line (6x reduction)
- All context in one place
- Queryable: `WHERE user.subscription='premium' AND feature_flags.new_checkout_flow=true`

**Query Examples:**

Before (grep):
```bash
# Find all premium user failures
grep "userId=123" logs/*.log | grep "Payment failed"
grep "subscription=premium" logs/*.log | grep "failed"
# Manual correlation needed
```

After (SQL):
```sql
SELECT *
FROM logs
WHERE outcome = 'error'
  AND user.subscription = 'premium'
  AND path = '/api/checkout'
  AND @timestamp > ago(1h)
ORDER BY @timestamp DESC
```

**Impact:**
- **Log volume**: 6 lines → 1 line (83% reduction)
- **Query time**: 30 seconds of grepping → 2 second query
- **Context**: Partial → Complete (all business fields)
- **Cost**: With tail sampling, 90% reduction
```

### Example 4: Log Level Misuse

```markdown
### LOG-4: 404 Errors Logged as ERROR Level [MED]

**Evidence:**
**File:** `src/api/users.ts:34`
```typescript
app.get('/api/users/:id', async (req, res) => {
  const userId = req.params.id;

  const user = await db.findUser(userId);

  if (!user) {
    // ❌ MED: 404 logged as ERROR (expected failure)
    logger.error('User not found', { userId });
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(user);
});
```

**Problem:**
404 "User not found" is an **expected failure** (user doesn't exist), not an error requiring attention. Logging as ERROR causes:
1. **Alert fatigue**: Oncall gets paged for expected 404s
2. **False positives**: Error dashboards show high error rate
3. **Noise**: Real errors buried in 404s

**Impact:**
- **Oncall fatigue**: False alerts
- **MTTR**: Harder to find real errors
- **Monitoring**: Error rate metric inflated

**Severity:** MED
**Category:** Levels (Appropriate Levels)
**Confidence:** High

**Remediation:**
```typescript
// ❌ BEFORE: 404 as ERROR
if (!user) {
  logger.error('User not found', { userId });
  return res.status(404).json({ error: 'User not found' });
}

// ✅ AFTER: 404 as WARN (or don't log at all)
if (!user) {
  // Option 1: Log as WARN
  logger.warn('User not found', { user_id: userId });

  // Option 2: Don't log (404 is expected, tracked in wide event)
  // event.status_code = 404 (logged automatically)

  return res.status(404).json({ error: 'User not found' });
}

// ✅ Better: Wide event captures 404 automatically
// No manual logging needed
return res.status(404).json({ error: 'User not found' });
// Wide event includes status_code=404, outcome='success' (not error)
```

**Why This Fix:**

**Log levels:**
- **ERROR**: Unexpected failures (database down, unhandled exception)
- **WARN**: Expected failures or degraded state (404, retry, slow query)
- **INFO**: Normal operations (request completed)

**Before:**
```
[ERROR] User not found userId=123
[ERROR] User not found userId=456
[ERROR] User not found userId=789
// Looks like a crisis (3 ERRORS)
```

**After:**
```
[WARN] User not found user_id=123
// Or no log (wide event captures status_code=404)
```

**Wide event approach:**
```json
{
  "status_code": 404,
  "outcome": "success",
  "path": "/api/users/123",
  // No error field (404 is expected)
}
```

**Monitoring impact:**

Before:
- Error rate: 15% (includes 404s)
- Oncall alerts: Every 10 minutes

After:
- Error rate: 0.5% (only 5xx errors)
- Oncall alerts: Only real errors
```

### Example 5: Debug Logs in Production

```markdown
### LOG-5: DEBUG Logs in Production Hot Path [HIGH]

**Evidence:**
**File:** `src/api/orders.ts:123`
```typescript
app.get('/api/orders', async (req, res) => {
  // ❌ HIGH: DEBUG log in production (high-volume endpoint)
  logger.debug('Fetching orders', {
    userId: req.user.id,
    query: req.query,
    headers: req.headers,
  });

  const orders = await db.getOrders(req.user.id, req.query);

  // ❌ HIGH: DEBUG log inside loop
  for (const order of orders) {
    logger.debug('Processing order', {
      orderId: order.id,
      total: order.total,
      items: order.items,
    });
  }

  logger.debug('Orders fetched', {
    count: orders.length,
    duration: Date.now() - start,
  });

  res.json(orders);
});
```

**Problem:**
DEBUG logs in production on high-volume endpoint (/api/orders gets 10k req/s):
1. **Volume**: 10k req/s × 3 debug logs = 30k log lines/sec
2. **Cost**: Debug logs are noise in production
3. **Performance**: Logging overhead slows hot path

**Impact:**
- **Cost**: ~$5000/month in log ingestion (at scale)
- **Performance**: 10ms+ added latency per request
- **Noise**: 30k log lines/sec (99% useless)

**Severity:** HIGH
**Category:** Noise (Over-logging)
**Confidence:** High

**Remediation:**
```typescript
// ❌ BEFORE: DEBUG in production
logger.debug('Fetching orders', { userId, query, headers });
for (const order of orders) {
  logger.debug('Processing order', { orderId: order.id });
}
logger.debug('Orders fetched', { count: orders.length });

// ✅ AFTER: Remove debug logs
app.get('/api/orders', async (req, res) => {
  const event = req.wideEvent;

  event.user = { id: req.user.id };

  const orders = await db.getOrders(req.user.id, req.query);

  event.query = {
    order_count: orders.length,
  };

  res.json(orders);

  // Wide event logged automatically with:
  // - user.id
  // - query.order_count
  // - duration_ms, status_code
  // Tail-sampled (keeps errors/slow, samples 5% of success)
});
```

**Why This Fix:**

**Before:**
```
[DEBUG] Fetching orders userId=123 query={...} headers={...}
[DEBUG] Processing order orderId=1
[DEBUG] Processing order orderId=2
[DEBUG] Processing order orderId=3
[DEBUG] Orders fetched count=3 duration=45
// 5 log lines per request × 10k req/s = 50k lines/sec
```

**After:**
```json
{
  "path": "/api/orders",
  "user": { "id": "123" },
  "query": { "order_count": 3 },
  "duration_ms": 45,
  "status_code": 200
}
// 1 log line per request (sampled 5% = 500 lines/sec)
// 100x reduction
```

**Performance impact:**

Before:
- 5 log calls per request
- 10ms logging overhead
- 50k log lines/sec
- $5000/month log costs

After:
- 1 log call per request (at end)
- 2ms logging overhead
- 500 log lines/sec (tail sampled)
- $50/month log costs (100x cheaper)
```

## Summary Output

After review, print summary:

```markdown
# Logging Review Complete

## Review Summary
- **Scope**: {SCOPE} {TARGET}
- **Files Reviewed**: X
- **Log Statements Found**: X

## Findings
- **BLOCKER**: X (must fix immediately)
- **HIGH**: X (fix before release)
- **MED**: X (should fix)
- **LOW**: X (nice to have)

## Category Breakdown
- **Safety** (Secrets): X
- **Privacy** (PII): X
- **Quality** (Structured): X
- **Levels**: X
- **Noise**: X
- **Structure** (Wide Events): X

## Immediate Actions
1. {BLOCKER finding}
2. {HIGH finding}

## Wide Event Migration Opportunities
Found X endpoints with scattered logging that should migrate to wide events:
- {File}: {Current log count} → 1 wide event
- {File}: {Current log count} → 1 wide event

**Estimated Impact:**
- Log volume reduction: ~{X}%
- Cost savings: ~${X}/month
- Query simplification: grep → SQL

## Report Location
Full report: `.claude/{SESSION_SLUG}/reviews/review-logging-{DATE}.md`
```

## References

- [Logging Sucks](https://loggingsucks.com/) - Wide event philosophy
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- Wide Event Observability Skill - Implementation guide
