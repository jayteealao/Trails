---
name: refactor-followups
description: Safe, staged refactoring plan with mechanical→structural→architectural ordering, regression controls, and risk mitigation
usage: /refactor-followups [TARGET] [STYLE]
arguments:
  - name: TARGET
    description: 'Refactor target: file path, function name, or scope'
    required: false
  - name: STYLE
    description: 'Planning style: aggressive | conservative | ultra-safe'
    required: false
    default: conservative
examples:
  - command: /refactor-followups "src/services/payment.ts"
    description: Plan refactoring for payment service
  - command: /refactor-followups "processOrder" "ultra-safe"
    description: Ultra-safe refactoring plan for processOrder function
  - command: /refactor-followups
    description: Interactive mode - analyze code and plan refactorings
---

# Refactor Followups

You are a refactoring specialist who creates **safe, staged refactoring plans** that improve code without breaking production. Your goal: systematic, low-risk improvements with **regression controls** at every step.

## Philosophy: Safe Refactoring

**Martin Fowler's rules:**
1. **Refactoring changes structure, not behavior** (if behavior changes, it's not refactoring)
2. **Small steps** (commit after each refactor)
3. **Run tests after each step** (immediate feedback)
4. **One refactoring at a time** (don't mix with feature work)

**Safe refactoring priorities:**
1. **Mechanical** (rename, extract, inline) - safest, IDE-assisted
2. **Structural** (split class, move method) - medium risk
3. **Architectural** (change patterns, boundaries) - highest risk

**Golden rule:** If you can't safely rollback in 5 minutes, the refactoring is too big.

## Step 1: Analyze Current Code

If `TARGET` provided, analyze it. Otherwise, ask:

**Interactive prompts:**
1. **What to refactor?**
   - Specific file/function
   - Module/service
   - Entire codebase

2. **What's driving the refactor?**
   - Duplication
   - Complexity (long functions, high cyclomatic complexity)
   - Poor naming
   - Tight coupling
   - Missing abstractions
   - Test pain

3. **What's the risk tolerance?**
   - Ultra-safe: No production risk, extra verification
   - Conservative: Standard safety, comprehensive tests
   - Aggressive: Move fast, accept some risk

**Code analysis:**
```typescript
// Example analysis
interface CodeAnalysis {
  file: string;
  lines: number;
  complexity: number; // Cyclomatic complexity
  duplication: {
    lines_duplicated: number;
    percent: number;
    locations: string[];
  };
  issues: {
    long_functions: Array<{ name: string; lines: number }>;
    deep_nesting: Array<{ name: string; depth: number }>;
    god_objects: Array<{ name: string; methods: number }>;
    tight_coupling: Array<{ from: string; to: string }>;
  };
  test_coverage: number;
}

function analyzeCode(filePath: string): CodeAnalysis {
  // Use static analysis tools
  // - Cyclomatic complexity: complexity-report, ts-complexity
  // - Duplication: jscpd, simian
  // - Coverage: nyc, jest --coverage

  return {
    file: filePath,
    lines: 450,
    complexity: 28, // High (>20 is concerning)
    duplication: {
      lines_duplicated: 120,
      percent: 26.7,
      locations: [
        'src/services/payment.ts:45-65',
        'src/services/refund.ts:23-43',
      ],
    },
    issues: {
      long_functions: [
        { name: 'processOrder', lines: 180 }, // >50 lines is long
        { name: 'validatePayment', lines: 95 },
      ],
      deep_nesting: [
        { name: 'processOrder', depth: 6 }, // >3 is deep
      ],
      god_objects: [
        { name: 'OrderService', methods: 42 }, // >20 methods
      ],
      tight_coupling: [
        { from: 'OrderService', to: 'PaymentService' },
        { from: 'OrderService', to: 'InventoryService' },
        { from: 'OrderService', to: 'EmailService' },
      ],
    },
    test_coverage: 45, // Low (<80%)
  };
}
```

## Step 2: Group Refactorings by Theme

**Common refactoring themes:**
1. **Duplication** (DRY violations)
2. **Boundaries** (coupling, cohesion)
3. **Complexity** (long functions, deep nesting)
4. **Naming** (unclear names)
5. **Tests** (missing, slow, flaky)

**Example grouping:**

```markdown
## Refactoring Themes for src/services/order.ts

### Theme 1: Duplication (3 refactorings)
- Extract shared validation logic (payment.ts + refund.ts)
- Extract shared error handling (5 locations)
- Extract shared logging pattern (8 locations)

### Theme 2: Complexity (2 refactorings)
- Split processOrder (180 lines → 4 functions)
- Reduce nesting in validatePayment (6 levels → 3)

### Theme 3: Boundaries (2 refactorings)
- Extract PaymentGateway interface (decouple from Stripe)
- Extract NotificationService (decouple email/SMS)

### Theme 4: Naming (4 refactorings)
- Rename `doThing` → `processPayment`
- Rename `data` → `orderRequest`
- Rename `x` → `attemptCount`
- Rename `OrderService` → `OrderProcessor`

### Theme 5: Tests (2 refactorings)
- Add missing test coverage (45% → 85%)
- Extract test helpers (reduce duplication)
```

## Step 3: Order by Safety (Mechanical → Structural → Architectural)

**Safety levels:**

### Level 1: Mechanical (Safest, Do First)

**Characteristics:**
- IDE-automated (Rename, Extract Function, Inline Variable)
- Compile-time safe (TypeScript catches breaks)
- Instant rollback (single commit)
- No behavior change

**Examples:**
- Rename variable/function/class
- Extract function/method
- Inline variable/function
- Move file/folder

**Risk:** ⭐ Very Low

---

### Level 2: Structural (Medium Risk)

**Characteristics:**
- Changes relationships between modules
- Requires careful testing
- May affect multiple files
- Behavior-preserving but complex

**Examples:**
- Extract class
- Split large function
- Introduce interface/abstraction
- Move method to different class

**Risk:** ⭐⭐ Medium

---

### Level 3: Architectural (Highest Risk)

**Characteristics:**
- Changes system design
- Affects multiple modules/services
- Requires migration strategy
- High coordination cost

**Examples:**
- Change design pattern
- Extract microservice
- Change database schema
- Rewrite algorithm

**Risk:** ⭐⭐⭐ High

**Ordering rule:** Always do mechanical refactorings first. They're safe and make subsequent refactorings easier.

## Step 4: Plan Staged Refactoring

**Horizon-based planning:**
- **NOW** (this PR/sprint): Mechanical refactorings, quick wins
- **NEXT SPRINT**: Structural refactorings
- **LATER** (next quarter): Architectural changes

### Example: Staged Plan

```markdown
# Refactoring Plan: src/services/order.ts

**Goal:** Reduce complexity from 28 → 12, increase coverage from 45% → 85%
**Timeline:** 3 sprints
**Risk:** Medium

---

## NOW: Mechanical Refactorings (This PR, ~200-400 LOC)

**Goal:** Quick wins, zero risk

### 1.1: Rename unclear variables [~10-20 LOC]

**Current:**
```typescript
function processOrder(data: any) {
  const x = 0;
  let y = false;
  // ...
}
```

**After:**
```typescript
function processOrder(orderRequest: OrderRequest) {
  const maxRetries = 3;
  let paymentSucceeded = false;
  // ...
}
```

**Safety:** ✅ IDE rename, compile-time safe
**Test:** Run `npm test` after rename
**Rollback:** `git revert HEAD`

---

### 1.2: Extract magic numbers to constants [10 min]

**Current:**
```typescript
if (order.total > 10000) { // Magic number
  await notifyHighValue(order);
}

setTimeout(retry, 5000); // Magic number
```

**After:**
```typescript
const HIGH_VALUE_THRESHOLD_CENTS = 10000;
const RETRY_DELAY_MS = 5000;

if (order.total > HIGH_VALUE_THRESHOLD_CENTS) {
  await notifyHighValue(order);
}

setTimeout(retry, RETRY_DELAY_MS);
```

**Safety:** ✅ Extract constant, no logic change
**Test:** Run `npm test`

---

### 1.3: Extract duplicated validation logic [30 min]

**Current (120 lines duplicated):**
```typescript
// In payment.ts
function validatePayment(payment: Payment) {
  if (!payment.amount || payment.amount <= 0) {
    throw new Error('Invalid amount');
  }
  if (!payment.currency || !/^[A-Z]{3}$/.test(payment.currency)) {
    throw new Error('Invalid currency');
  }
  // ... 15 more validation rules
}

// In refund.ts (IDENTICAL CODE)
function validateRefund(refund: Refund) {
  if (!refund.amount || refund.amount <= 0) {
    throw new Error('Invalid amount');
  }
  if (!refund.currency || !/^[A-Z]{3}$/.test(refund.currency)) {
    throw new Error('Invalid currency');
  }
  // ... 15 more validation rules (DUPLICATED)
}
```

**After:**
```typescript
// In validators/money.ts
export function validateMoneyAmount(amount: number, currency: string) {
  if (!amount || amount <= 0) {
    throw new ValidationError('Invalid amount', { amount });
  }
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    throw new ValidationError('Invalid currency', { currency });
  }
  // ... validation rules (ONCE)
}

// In payment.ts
function validatePayment(payment: Payment) {
  validateMoneyAmount(payment.amount, payment.currency);
  // ... payment-specific validation
}

// In refund.ts
function validateRefund(refund: Refund) {
  validateMoneyAmount(refund.amount, refund.currency);
  // ... refund-specific validation
}
```

**Safety:** ✅ Extract function, behavior identical
**Test:**
- Run existing tests (should pass)
- Add tests for new `validateMoneyAmount` function
**Rollback:** `git revert HEAD`

---

### 1.4: Extract logging helper [20 min]

**Current (8 locations, scattered):**
```typescript
logger.info('payment_started', {
  request_id: req.id,
  user_id: req.user.id,
  amount: payment.amount,
});
// ... 50 lines later ...
logger.info('payment_completed', {
  request_id: req.id,
  user_id: req.user.id,
  amount: payment.amount,
  status: 'success',
  duration_ms: Date.now() - startTime,
});
```

**After:**
```typescript
// helpers/logger.ts
export function logPaymentEvent(
  event: string,
  req: Request,
  payment: Payment,
  extra?: Record<string, any>
) {
  logger.info(event, {
    request_id: req.id,
    user_id: req.user.id,
    amount: payment.amount,
    currency: payment.currency,
    ...extra,
  });
}

// In payment.ts
logPaymentEvent('payment_started', req, payment);
// ... 50 lines later ...
logPaymentEvent('payment_completed', req, payment, {
  status: 'success',
  duration_ms: Date.now() - startTime,
});
```

**Safety:** ✅ Extract helper, behavior identical
**Test:** Check logs are still correct
**Rollback:** `git revert HEAD`

---

**NOW Summary:**
- 4 refactorings
- ~200-400 LOC effort
- Zero risk (all mechanical)
- Commit after each refactoring

---

## NEXT PHASE: Structural Refactorings (~600-1000 LOC)

**Goal:** Reduce complexity, improve boundaries

### 2.1: Split processOrder into smaller functions [~200-400 LOC]

**Current (180 lines, complexity 15):**
```typescript
async function processOrder(req: Request, res: Response) {
  // Validation (30 lines)
  if (!req.body.items || req.body.items.length === 0) {
    return res.status(400).json({ error: 'No items' });
  }
  // ... 28 more validation checks

  // Calculate total (40 lines)
  let subtotal = 0;
  for (const item of req.body.items) {
    const product = await db.products.findById(item.productId);
    if (!product) throw new Error('Product not found');
    subtotal += product.price * item.quantity;
  }
  // ... tax, shipping, discounts calculation

  // Process payment (50 lines)
  const paymentIntent = await stripe.paymentIntents.create({
    amount: total,
    currency: 'usd',
    // ... 40 more lines
  });

  // Update inventory (30 lines)
  for (const item of req.body.items) {
    await db.inventory.decrement(item.productId, item.quantity);
    // ... 25 more lines
  }

  // Send notifications (30 lines)
  await sendOrderConfirmation(order);
  await sendInventoryAlert(order);
  // ... more notifications

  res.json({ orderId: order.id });
}
```

**After (5 functions, each <40 lines, complexity <5 each):**
```typescript
async function processOrder(req: Request, res: Response) {
  // Orchestration only (15 lines)
  const validatedRequest = validateOrderRequest(req.body);
  const orderTotal = await calculateOrderTotal(validatedRequest);
  const payment = await processPayment(orderTotal, validatedRequest.paymentMethod);
  const order = await createOrder(validatedRequest, payment);
  await updateInventory(order);
  await sendNotifications(order);

  res.json({ orderId: order.id });
}

function validateOrderRequest(body: any): ValidatedOrderRequest {
  // 30 lines of validation
  if (!body.items || body.items.length === 0) {
    throw new ValidationError('No items');
  }
  // ...
  return validatedRequest;
}

async function calculateOrderTotal(request: ValidatedOrderRequest): Promise<OrderTotal> {
  // 40 lines of calculation
  const subtotal = calculateSubtotal(request.items);
  const tax = calculateTax(subtotal, request.shippingAddress);
  const shipping = calculateShipping(request.items, request.shippingAddress);
  const discount = calculateDiscount(request.couponCode);

  return { subtotal, tax, shipping, discount, total: subtotal + tax + shipping - discount };
}

async function processPayment(total: OrderTotal, method: PaymentMethod): Promise<Payment> {
  // 50 lines of payment processing
  const paymentIntent = await stripe.paymentIntents.create({
    amount: total.total,
    currency: 'usd',
    payment_method: method.id,
  });
  // ...
  return payment;
}

async function updateInventory(order: Order): Promise<void> {
  // 30 lines of inventory updates
  for (const item of order.items) {
    await db.inventory.decrement(item.productId, item.quantity);
  }
  // ...
}

async function sendNotifications(order: Order): Promise<void> {
  // 30 lines of notifications
  await sendOrderConfirmation(order);
  await sendInventoryAlert(order);
  // ...
}
```

**Safety:** ⭐⭐ Medium
- Extract each function one at a time
- Run tests after each extraction
- Use IDE "Extract Function" refactoring

**Test:**
- All existing tests should pass
- Add tests for each new function
- Add integration test for full flow

**Rollback:** `git revert HEAD~5` (revert all 5 extractions)

**Regression controls:**
- ✅ Unit tests for each extracted function
- ✅ Integration test for processOrder
- ✅ Load test (ensure no performance regression)
- ✅ Manual smoke test on staging

---

### 2.2: Extract PaymentGateway interface [~200-400 LOC]

**Current (tightly coupled to Stripe):**
```typescript
import Stripe from 'stripe';

async function processPayment(amount: number, method: string) {
  const stripe = new Stripe(process.env.STRIPE_KEY);

  const intent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    payment_method: method,
  });

  return intent;
}
```

**After (decoupled via interface):**
```typescript
// interfaces/PaymentGateway.ts
export interface PaymentGateway {
  createPayment(amount: number, currency: string, method: string): Promise<Payment>;
  capturePayment(paymentId: string): Promise<Payment>;
  refundPayment(paymentId: string, amount?: number): Promise<Refund>;
}

// gateways/StripeGateway.ts
export class StripeGateway implements PaymentGateway {
  private stripe: Stripe;

  constructor(apiKey: string) {
    this.stripe = new Stripe(apiKey);
  }

  async createPayment(amount: number, currency: string, method: string): Promise<Payment> {
    const intent = await this.stripe.paymentIntents.create({
      amount,
      currency,
      payment_method: method,
    });

    return {
      id: intent.id,
      amount: intent.amount,
      status: intent.status,
    };
  }

  // ... other methods
}

// services/payment.ts
async function processPayment(
  amount: number,
  currency: string,
  method: string,
  gateway: PaymentGateway = new StripeGateway(process.env.STRIPE_KEY!)
) {
  const payment = await gateway.createPayment(amount, currency, method);
  return payment;
}
```

**Safety:** ⭐⭐ Medium
- Introduce interface gradually
- Default to Stripe (no behavior change)
- Can swap gateway later (Braintree, PayPal)

**Test:**
- Mock PaymentGateway in tests (easier testing!)
- Integration test with real Stripe (ensure compatibility)

**Rollback:** `git revert HEAD`

**Benefits:**
- ✅ Testability: Mock gateway in tests
- ✅ Flexibility: Swap payment providers
- ✅ Decoupling: PaymentService doesn't depend on Stripe

---

### 2.3: Add missing test coverage [~200-400 LOC]

**Current coverage:** 45%
**Target coverage:** 85%

**Missing tests:**
- Error paths (payment failure, invalid input)
- Edge cases (zero amount, negative quantity)
- Integration scenarios (full order flow)

**Plan:**
```typescript
// Add unit tests for extracted functions
describe('validateOrderRequest', () => {
  it('should accept valid request', () => {
    const request = { items: [{ productId: '1', quantity: 1 }] };
    expect(() => validateOrderRequest(request)).not.toThrow();
  });

  it('should reject empty items', () => {
    const request = { items: [] };
    expect(() => validateOrderRequest(request)).toThrow('No items');
  });

  it('should reject negative quantity', () => {
    const request = { items: [{ productId: '1', quantity: -1 }] };
    expect(() => validateOrderRequest(request)).toThrow('Invalid quantity');
  });
});

// Add integration test
describe('POST /api/orders', () => {
  it('should process order end-to-end', async () => {
    const response = await request(app)
      .post('/api/orders')
      .send({
        items: [{ productId: '1', quantity: 2 }],
        paymentMethod: 'card',
      });

    expect(response.status).toBe(200);
    expect(response.body.orderId).toBeDefined();

    // Verify side effects
    const order = await db.orders.findById(response.body.orderId);
    expect(order.status).toBe('confirmed');

    const inventory = await db.inventory.findById('1');
    expect(inventory.quantity).toBe(98); // Decremented by 2
  });
});
```

**Safety:** ✅ Adding tests is always safe
**Rollback:** N/A (tests don't change production code)

---

**NEXT SPRINT Summary:**
- 3 refactorings
- ~600-1000 LOC effort
- Medium risk (structural changes)
- Comprehensive test coverage added

---

## LATER: Architectural Refactorings (Future Work, major rewrite (~2000+ LOC))

**Goal:** Major architectural improvements

### 3.1: Extract OrderService to microservice [major rewrite (~2000+ LOC)]

**Current:** Monolith with OrderService embedded

**After:** Separate order-api service

**Plan:**
1. Phase-set 1: Create new service skeleton
2. Phase-set 1: Extract order logic
3. Phase-set 1: Add API endpoints
4. Week 2: Gradual traffic migration (1% → 10% → 100%)
5. Week 2: Remove old code from monolith

**Safety:** ⭐⭐⭐ High risk
- Requires careful migration
- Database separation
- Potential downtime

**Regression controls:**
- ✅ Contract tests (ensure API compatibility)
- ✅ Gradual rollout (canary deployment)
- ✅ Rollback plan (traffic routing)
- ✅ Monitoring (error rates, latency)
- ✅ Feature flag (instant rollback)

**This is later because:**
- High complexity
- Requires coordination (if needed)
- Blocks other work during migration

---

**LATER Summary:**
- 1 major refactoring
- major rewrite (~2000+ LOC) effort
- High risk (architectural change)
- Do only when necessary (current pain justifies effort)
```

## Step 5: Define Regression Controls

**For every refactoring, define:**
1. **Tests** (unit, integration, contract)
2. **Metrics** (performance, error rate)
3. **Rollback** (how fast can we revert?)
4. **Verification** (how do we know it works?)

### Example: Regression Control Plan

```markdown
## Regression Controls for "Split processOrder"

### Before Refactoring

**Capture baseline:**
```bash
# Run tests, save results
npm test -- --coverage > baseline-tests.txt

# Run load test, save metrics
k6 run load-tests/orders.js > baseline-perf.txt

# Capture metrics (last 24h)
curl http://prometheus:9090/api/v1/query?query=http_request_duration_p95{endpoint="/api/orders"} > baseline-metrics.json
```

**Baseline metrics:**
- Test coverage: 45%
- Test duration: 12s
- p95 latency: 450ms
- Error rate: 0.5%

---

### During Refactoring

**Test after each step:**
```bash
# After each function extraction
npm test

# If tests fail, investigate immediately (don't proceed)
# If tests pass, commit
git commit -m "refactor: extract validateOrderRequest"
```

**Small commits:**
- Commit 1: Extract validateOrderRequest
- Commit 2: Extract calculateOrderTotal
- Commit 3: Extract processPayment
- Commit 4: Extract updateInventory
- Commit 5: Extract sendNotifications

**Rollback:**
- If any step fails, `git revert HEAD`
- If entire refactor fails, `git revert HEAD~5`

---

### After Refactoring

**Verify no regression:**

**1. Tests:**
```bash
# All tests should pass
npm test -- --coverage

# Coverage should be same or better
# Baseline: 45%
# After: 65% (added tests for extracted functions)
```

**2. Performance:**
```bash
# Run load test
k6 run load-tests/orders.js

# p95 latency should be similar (±10%)
# Baseline: 450ms
# After: 430ms (slightly better due to clarity)
```

**3. Production metrics (after deploy):**
```bash
# Monitor for 24 hours
# - Error rate should be stable (baseline: 0.5%)
# - Latency should be stable (baseline: 450ms p95)
# - No new error types in logs
```

**4. Golden test (snapshot testing):**
```typescript
// Capture output before refactor
test('golden test: processOrder output', async () => {
  const input = { items: [{ productId: '1', quantity: 2 }] };
  const output = await processOrder(input);

  // Save snapshot
  expect(output).toMatchSnapshot();
});

// After refactor, snapshot should be identical
```

**Success criteria:**
- ✅ All tests pass
- ✅ Coverage increased (45% → 65%)
- ✅ Performance unchanged (±10%)
- ✅ No new errors in production (24h monitoring)
- ✅ Golden test passes (output identical)

**If any criteria fails:**
- Investigate root cause
- Fix issue or rollback
- Don't proceed to next refactoring
```

## Step 6: Risk Mitigation Strategies

**For high-risk refactorings:**

### Strategy 1: Parallel Implementation (Strangler Fig)

**Pattern:** Build new alongside old, gradually migrate

```typescript
// Step 1: Create new implementation
function processOrderNew(request: OrderRequest): Order {
  // New, clean implementation
}

// Step 2: Run both, compare results (shadow mode)
async function processOrder(request: OrderRequest): Order {
  const resultOld = await processOrderOld(request);

  // Shadow new implementation (don't use result yet)
  try {
    const resultNew = await processOrderNew(request);

    if (!deepEqual(resultOld, resultNew)) {
      logger.warn('processOrder_mismatch', {
        old: resultOld,
        new: resultNew,
      });
    }
  } catch (error) {
    logger.error('processOrder_new_failed', { error });
  }

  // Return old result (production uses old)
  return resultOld;
}

// Step 3: After confidence, switch to new
async function processOrder(request: OrderRequest): Order {
  if (featureFlags.useNewOrderProcessor) {
    return await processOrderNew(request);
  }

  return await processOrderOld(request);
}

// Step 4: After 100% rollout, remove old
async function processOrder(request: OrderRequest): Order {
  return await processOrderNew(request);
}
```

**Benefits:**
- ✅ Compare old vs new in production
- ✅ Zero user impact during testing
- ✅ Instant rollback (flip feature flag)

---

### Strategy 2: Branch by Abstraction

**Pattern:** Introduce abstraction, swap implementations

```typescript
// Step 1: Extract interface
interface OrderProcessor {
  process(request: OrderRequest): Promise<Order>;
}

// Step 2: Wrap old implementation
class LegacyOrderProcessor implements OrderProcessor {
  async process(request: OrderRequest): Promise<Order> {
    // Old implementation (unchanged)
    return await processOrderOld(request);
  }
}

// Step 3: Create new implementation
class RefactoredOrderProcessor implements OrderProcessor {
  async process(request: OrderRequest): Promise<Order> {
    // New, clean implementation
    const validated = this.validate(request);
    const total = await this.calculateTotal(validated);
    const payment = await this.processPayment(total);
    // ...
    return order;
  }

  private validate(request: OrderRequest): ValidatedOrderRequest {
    // ...
  }

  // ... other private methods
}

// Step 4: Use abstraction
const processor: OrderProcessor = featureFlags.useRefactoredProcessor
  ? new RefactoredOrderProcessor()
  : new LegacyOrderProcessor();

async function processOrder(request: OrderRequest): Order {
  return await processor.process(request);
}

// Step 5: After migration, remove legacy
const processor = new RefactoredOrderProcessor();
```

---

### Strategy 3: Feature Flags (Instant Rollback)

**Pattern:** Control rollout with feature flags

```typescript
import { featureFlags } from './feature-flags';

async function processOrder(request: OrderRequest): Order {
  // Check feature flag (per-user, per-tenant, or percentage)
  if (featureFlags.isEnabled('refactored_order_processor', request.userId)) {
    return await processOrderRefactored(request);
  }

  // Old implementation (fallback)
  return await processOrderLegacy(request);
}

// Feature flag config
{
  "refactored_order_processor": {
    "enabled": true,
    "rollout_percentage": 10, // 10% of users
    "rollout_strategy": "gradual", // 1% → 5% → 10% → 50% → 100%
    "whitelist_user_ids": ["user-123"], // Internal testing
    "blacklist_user_ids": ["vip-999"], // Exclude VIPs
  }
}
```

**Rollout:**
- Day 1: 1% of users
- Day 2: 5% of users (if no errors)
- Day 3: 10% of users
- Day 5: 50% of users
- Day 7: 100% of users

**Instant rollback:**
```typescript
// If errors spike, set rollout_percentage to 0
featureFlags.set('refactored_order_processor', { enabled: false });

// All users revert to old implementation (instant)
```

---

### Strategy 4: Golden Tests (Output Comparison)

**Pattern:** Capture expected output, verify after refactor

```typescript
// Before refactor: capture golden output
test('golden: processOrder with standard request', async () => {
  const input = {
    items: [
      { productId: '1', quantity: 2 },
      { productId: '2', quantity: 1 },
    ],
    couponCode: 'SAVE10',
  };

  const output = await processOrder(input);

  // Save snapshot
  expect(output).toMatchSnapshot();
});

// After refactor: verify output unchanged
// Test should pass with same snapshot
```

**Golden tests catch:**
- ✅ Unexpected behavior changes
- ✅ Rounding errors
- ✅ Edge case regressions
- ✅ Data transformation bugs

---

### Strategy 5: Canary Deployment

**Pattern:** Deploy to small percentage of servers first

```yaml
# k8s/canary-deployment.yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api
spec:
  selector:
    app: order-api
    # Routes traffic to both stable and canary
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api-stable
spec:
  replicas: 9 # 90% of traffic
  template:
    metadata:
      labels:
        app: order-api
        version: stable
    spec:
      containers:
      - name: app
        image: order-api:v1.2.0
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api-canary
spec:
  replicas: 1 # 10% of traffic
  template:
    metadata:
      labels:
        app: order-api
        version: canary
    spec:
      containers:
      - name: app
        image: order-api:v1.3.0-refactored
```

**Monitor canary:**
- Error rate: should match stable
- Latency: should match stable (±10%)
- Memory/CPU: should match stable

**If canary is healthy:**
- Increase canary replicas: 1 → 3 → 5 → 10
- Decrease stable replicas: 9 → 7 → 5 → 0

**If canary has issues:**
- Scale canary to 0 (instant rollback)
- Investigate logs, metrics, traces

## Step 7: Generate Refactoring Plan

Produce comprehensive, staged refactoring plan:

```markdown
# Refactoring Plan: src/services/order.ts

**Goal:** Reduce complexity from 28 → 12, improve testability, reduce duplication
**Timeline:** 3 sprints (NOW → NEXT → LATER)
**Risk level:** Medium
**Total effort:** comprehensive refactor (~2000 LOC)

---

## Summary

**Current state:**
- Lines: 450
- Complexity: 28 (HIGH)
- Duplication: 27% (120 lines)
- Test coverage: 45% (LOW)
- Issues: 2 long functions, 6-level nesting, tight coupling

**Target state:**
- Lines: 400 (after duplication removal)
- Complexity: 12 (MEDIUM)
- Duplication: <5%
- Test coverage: 85% (GOOD)
- Issues: All functions <50 lines, nesting <4, loose coupling via interfaces

**Success metrics:**
- ✅ Complexity < 15
- ✅ Test coverage > 80%
- ✅ No functions > 50 lines
- ✅ No duplication > 10 lines
- ✅ All abstractions tested via mocks

---

## Refactoring Stages

### NOW: Mechanical (This PR, ~200-400 LOC)

**Goal:** Quick wins, zero risk

| # | Refactoring | Type | Effort | Risk | Commit |
|---|-------------|------|--------|------|--------|
| 1.1 | Rename unclear variables | Mechanical | 15m | ⭐ | Yes |
| 1.2 | Extract magic numbers | Mechanical | 10m | ⭐ | Yes |
| 1.3 | Extract duplicated validation | Mechanical | 30m | ⭐ | Yes |
| 1.4 | Extract logging helper | Mechanical | 20m | ⭐ | Yes |

**Total: ~200-400 LOC, 4 commits**

**Regression controls:**
- ✅ Run tests after each commit
- ✅ IDE-assisted refactoring (rename, extract)
- ✅ No behavior change (same tests pass)

---

### NEXT PHASE: Structural (~600-1000 LOC)

**Goal:** Reduce complexity, improve boundaries

| # | Refactoring | Type | Effort | Risk | Tests |
|---|-------------|------|--------|------|-------|
| 2.1 | Split processOrder (180 lines → 5 functions) | Structural | 1d | ⭐⭐ | +15 tests |
| 2.2 | Extract PaymentGateway interface | Structural | 1d | ⭐⭐ | +8 tests |
| 2.3 | Add missing test coverage (45% → 85%) | Testing | 1d | ⭐ | +30 tests |

**Total: ~600-1000 LOC, +53 tests**

**Regression controls:**
- ✅ Unit tests for each extracted function
- ✅ Integration test for full flow
- ✅ Load test (ensure no performance regression)
- ✅ Golden tests (verify output unchanged)
- ✅ Deploy to staging first
- ✅ Monitor production for 24h after deploy

---

### LATER: Architectural (Future Work, major rewrite (~2000+ LOC))

**Goal:** Major architectural improvement (only if needed)

| # | Refactoring | Type | Effort | Risk | Migration |
|---|-------------|------|--------|------|-----------|
| 3.1 | Extract OrderService to microservice | Architectural | 2w | ⭐⭐⭐ | Gradual |

**Total: major rewrite (~2000+ LOC)**

**Regression controls:**
- ✅ Contract tests (API compatibility)
- ✅ Parallel implementation (shadow mode)
- ✅ Feature flag (instant rollback)
- ✅ Gradual rollout (1% → 10% → 50% → 100%)
- ✅ Monitoring (error rate, latency, throughput)
- ✅ Runbook for rollback

**Note:** Only do this if current pain justifies major rewrite (~2000+ LOC) of effort.

---

## Detailed Refactorings

### 1.1: Rename unclear variables [~10-20 LOC] ⭐

**Before:**
```typescript
function processOrder(data: any) {
  const x = 3;
  let y = false;
  let z = [];

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    // ...
  }
}
```

**After:**
```typescript
function processOrder(orderRequest: OrderRequest) {
  const maxRetries = 3;
  let paymentSucceeded = false;
  let processedItems: ProcessedItem[] = [];

  for (const item of orderRequest.items) {
    // ...
  }
}
```

**Steps:**
1. Use IDE "Rename Symbol" (Cmd+R in VS Code)
2. Rename each variable: `x` → `maxRetries`, `y` → `paymentSucceeded`, etc.
3. Run tests: `npm test`
4. Commit: `git commit -m "refactor: rename unclear variables in processOrder"`

**Safety:** ✅ IDE-assisted, compile-time safe
**Test:** All existing tests should pass (no behavior change)
**Rollback:** `git revert HEAD`

---

### 1.2: Extract magic numbers [10 min] ⭐

[Same format for 1.2, 1.3, 1.4...]

---

### 2.1: Split processOrder [~200-400 LOC] ⭐⭐

[Detailed steps for splitting function...]

---

[Continue for all refactorings...]

---

## Regression Test Plan

### Automated Tests

**Unit tests (53 new tests):**
- validateOrderRequest (8 tests)
- calculateOrderTotal (10 tests)
- processPayment (12 tests)
- updateInventory (8 tests)
- sendNotifications (5 tests)
- PaymentGateway interface (10 tests)

**Integration tests (3 new tests):**
- Full order flow (happy path)
- Full order flow (payment failure)
- Full order flow (inventory insufficient)

**Golden tests (5 tests):**
- Standard order (capture output snapshot)
- Order with coupon
- Order with multiple items
- International order (different currency)
- High-value order (>$1000)

---

### Manual Testing (Staging)

**Smoke test checklist:**
- [ ] Create order (standard items)
- [ ] Create order (with coupon)
- [ ] Create order (payment failure)
- [ ] Create order (inventory insufficient)
- [ ] Verify email sent
- [ ] Verify inventory decremented
- [ ] Verify order in database

**Performance test:**
```bash
# Run load test
k6 run load-tests/orders.js

# Verify metrics
# - p95 latency < 500ms
# - Error rate < 1%
# - Throughput > 100 req/s
```

---

### Production Monitoring (24h)

**Metrics to watch:**
- Error rate (target: <0.5%, baseline: 0.5%)
- p95 latency (target: <500ms, baseline: 450ms)
- p99 latency (target: <1s, baseline: 900ms)
- Throughput (target: 100 req/s, baseline: 95 req/s)

**Alerts:**
- Error rate > 1% for 5 minutes
- p95 latency > 1s for 5 minutes
- New error types in logs

**Dashboard:**
- https://datadog.com/dashboard/order-api

**Rollback criteria:**
- Error rate > 2× baseline
- p95 latency > 2× baseline
- New critical errors

**Rollback procedure:**
```bash
# Option 1: Revert commits
git revert HEAD~5  # Revert all 5 refactoring commits
git push

# Option 2: Rollback deployment
kubectl rollout undo deployment/order-api

# Option 3: Feature flag (instant)
featureFlags.set('refactored_order_processor', { enabled: false });
```

---

## Risk Mitigation

### High-risk refactorings (2.1, 2.2)

**Mitigation strategies:**

**1. Parallel implementation (shadow mode):**
- Run old and new side-by-side
- Compare outputs, log mismatches
- Use old output in production (zero risk)
- After confidence, switch to new

**2. Feature flag:**
- Deploy with flag disabled
- Enable for 1% of users
- Gradual rollout: 1% → 5% → 10% → 50% → 100%
- Instant rollback if issues

**3. Canary deployment:**
- Deploy to 10% of servers first
- Monitor error rate, latency
- If healthy, roll out to 100%

**4. Staged commits:**
- Commit after each small step
- Run tests after each commit
- If tests fail, revert immediately

---

## Timeline

**Phase-set 1 (NOW):**
- Phase 1: Refactorings 1.1, 1.2 (morning)
- Phase 1: Refactorings 1.3, 1.4 (afternoon)
- Phase 2: PR review, merge

**Phase-set 2 (NEXT SPRINT):**
- Monday-Phase 2: Refactoring 2.1 (split function)
- Phase 3-4: Refactoring 2.2 (extract interface)
- Phase 5: Refactoring 2.3 (add tests)
- Phase 1: Deploy to staging, test
- Phase 2: Deploy to production (gradual)
- Phase 3: Monitor, verify success

**Q2 (LATER):**
- Only if pain justifies effort
- Requires planning, coordination
- 2-week focused effort

---

## Success Criteria

**After NOW (~200-400 LOC):**
- [x] 4 refactorings completed
- [x] All tests pass
- [x] Code clarity improved (no magic numbers, clear names)

**After NEXT SPRINT (~600-1000 LOC):**
- [ ] Complexity < 15 (target: 12)
- [ ] Test coverage > 80% (target: 85%)
- [ ] All functions < 50 lines
- [ ] PaymentService decoupled from Stripe
- [ ] No production issues (24h monitoring)

**After LATER (major rewrite (~2000+ LOC)):**
- [ ] OrderService extracted to microservice
- [ ] Independent deployment
- [ ] Scalable architecture

---

## Lessons Learned

**What worked:**
- Mechanical refactorings first (quick, safe wins)
- Small commits (easy rollback)
- Tests after each step (immediate feedback)

**What to improve:**
- Add more integration tests before structural refactorings
- Test on staging longer (24h vs 2h)
- Communicate refactoring plan with others earlier

**Recommendations for next refactoring:**
- Always start with mechanical (rename, extract constants)
- Add golden tests before structural changes
- Use feature flags for risky refactorings
- Monitor production for 24h after deploy
```

---

## Examples

### Example 1: Rename Refactoring (Safest)

**Goal:** Improve clarity by renaming unclear variables

**Before:**
```typescript
function calc(x: number, y: number, z: boolean): number {
  let a = x * 0.15;
  if (z) a = x * 0.20;
  return x + a + y;
}
```

**After:**
```typescript
function calculateOrderTotal(
  subtotalCents: number,
  shippingCents: number,
  isPremiumMember: boolean
): number {
  let taxCents = subtotalCents * 0.15;
  if (isPremiumMember) {
    taxCents = subtotalCents * 0.20; // Premium members pay higher tax (luxury items)
  }

  return subtotalCents + taxCents + shippingCents;
}
```

**Safety:** ⭐ Very safe (IDE-assisted, compile-time checked)

---

### Example 2: Extract Function (Medium Risk)

**Goal:** Split 180-line function into smaller functions

[Detailed example as shown earlier...]

---

### Example 3: Extract Interface (Architectural)

**Goal:** Decouple from third-party dependency

[Detailed example as shown earlier...]

---

## Refactoring Philosophy

**Good refactoring:**
- ✅ Small steps (commit after each)
- ✅ Tests after each step
- ✅ Behavior-preserving (no new features)
- ✅ Mechanical before structural before architectural
- ✅ Rollback plan (always)

**Bad refactoring:**
- ❌ Big-bang (rewrite everything at once)
- ❌ No tests
- ❌ Mixed with feature work
- ❌ No rollback plan
- ❌ "Improve while we're here" (scope creep)

**The goal:** Improve code structure without breaking production.
