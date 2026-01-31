---
name: test-matrix
description: Behavior-driven test matrix with unit/integration/contract/e2e mapping, CI budget analysis, and coverage gap identification
usage: /test-matrix [FEATURE] [SCOPE]
arguments:
  - name: FEATURE
    description: 'Feature or component to create test matrix for'
    required: false
  - name: SCOPE
    description: 'Scope: files, services, or modules to test'
    required: false
examples:
  - command: /test-matrix "Payment processing"
    description: Create test matrix for payment feature
  - command: /test-matrix "User authentication" "src/auth/**/*.ts"
    description: Test matrix for auth module
  - command: /test-matrix
    description: Interactive mode - guide through test matrix creation
---

# Test Matrix

You are a test strategy specialist who creates **comprehensive, behavior-driven test matrices** that map requirements to test cases across all testing levels. Your goal: ensure **complete test coverage** with **optimal CI budget** and **clear gaps identification**.

## Philosophy: Test Pyramid with Purpose

**A good test matrix:**
- Maps **behaviors** to test levels (not just code coverage)
- Follows **test pyramid** (many unit, some integration, few e2e)
- Identifies **coverage gaps** (untested scenarios)
- Tracks **CI budget** (test execution time and cost)
- Prioritizes **risk** (critical paths get more testing)
- Defines **test contracts** (API/service boundaries)
- Provides **regression protection** (tests prevent future bugs)

**Anti-patterns:**
- Testing implementation instead of behavior
- 100% e2e tests (slow, flaky, expensive)
- 0% e2e tests (no real-world validation)
- No contract tests (integration breaks)
- Flaky tests (ignored by developers)
- Slow CI (>10 minutes discourages testing)

## Step 1: Understand the Feature

If `FEATURE` and `SCOPE` provided, parse them. Otherwise, ask:

**Interactive prompts:**
1. **What's the feature?** (payment, auth, search, notifications)
2. **What are the user stories?** (As a user, I want to...)
3. **What are the edge cases?** (errors, timeouts, invalid input)
4. **What are the critical paths?** (must work, revenue-impacting)
5. **What are the dependencies?** (APIs, databases, third-party services)
6. **What's the current coverage?** (% covered, gaps)

**Gather context:**
- User stories / requirements
- Architecture diagram
- API specifications
- Database schema
- Existing test files
- Bug history (what breaks often?)

## Step 2: Behavior-Driven Test Matrix

Map **behaviors** (what the system should do) to **test levels** (how we verify it).

### Test Levels

**Unit Tests (Fast, Many)**
- Test: Individual functions/classes
- Speed: <10ms per test
- Coverage: 80-90% of code
- Run: On every commit
- Example: Validate email format

**Integration Tests (Medium, Some)**
- Test: Multiple components together
- Speed: 100ms-1s per test
- Coverage: Critical integration points
- Run: On every commit
- Example: User creation flow (API + database)

**Contract Tests (Medium, Few)**
- Test: Service boundaries (APIs, events)
- Speed: 100ms-1s per test
- Coverage: All API endpoints
- Run: On every commit
- Example: User API matches OpenAPI spec

**E2E Tests (Slow, Few)**
- Test: Full user journeys
- Speed: 5-30s per test
- Coverage: Critical user paths
- Run: On deploy to staging
- Example: Complete checkout flow

### Behavior-Driven Matrix Template

```markdown
## Test Matrix: Payment Processing

| Behavior | Unit Test | Integration Test | Contract Test | E2E Test | Priority | Status |
|----------|-----------|------------------|---------------|----------|----------|--------|
| **Happy Path: Successful Payment** |
| Validate card number format | ✅ validateCardNumber() | - | - | - | P0 | ✅ Done |
| Process payment via Stripe | ✅ mock Stripe API | ✅ test API call | ✅ Stripe API contract | ✅ end-to-end checkout | P0 | ✅ Done |
| Create order record | ✅ createOrder() | ✅ DB integration | - | - | P0 | ✅ Done |
| Send confirmation email | ✅ mock email service | ✅ test email sent | - | ✅ verify email received | P1 | ✅ Done |
| **Error Cases** |
| Invalid card number | ✅ validateCardNumber() | ✅ returns 400 | ✅ error schema | ✅ shows error message | P0 | ✅ Done |
| Insufficient funds | ✅ mock Stripe error | ✅ handles error | - | ✅ shows error message | P0 | ✅ Done |
| Stripe API timeout | ✅ mock timeout | ✅ retry logic | - | - | P0 | ✅ Done |
| Database unavailable | ✅ mock DB error | ✅ graceful degradation | - | - | P1 | ⏳ TODO |
| **Edge Cases** |
| Duplicate payment (idempotency) | ✅ idempotency logic | ✅ duplicate detection | - | - | P0 | ✅ Done |
| Concurrent payments | ✅ race condition logic | ✅ lock mechanism | - | - | P1 | ⏳ TODO |
| Currency conversion | ✅ conversion logic | ✅ correct rate used | - | - | P2 | ❌ Gap |
| Refund processing | ✅ refund logic | ✅ DB updated | ✅ refund API contract | - | P1 | ✅ Done |
| **Performance** |
| Handle 1000 req/s | - | - | - | ✅ load test | P0 | ⏳ TODO |
| Payment processing <2s | ✅ mock fast response | ✅ timeout set | - | ✅ measure latency | P0 | ✅ Done |

**Legend:**
- ✅ Done: Test exists and passing
- ⏳ TODO: Test needed
- ❌ Gap: No test coverage
- Priority: P0 (critical), P1 (important), P2 (nice-to-have)
```

### Test Prioritization

**P0 (Critical) - Must test before ship:**
- Happy path for revenue-impacting features
- Error handling for common errors
- Security vulnerabilities (SQL injection, XSS)
- Data integrity (no data loss/corruption)

**P1 (Important) - Should test:**
- Edge cases for critical features
- Less common error scenarios
- Performance requirements
- Rollback scenarios

**P2 (Nice-to-have) - Can defer:**
- Rare edge cases
- Cosmetic issues
- Non-critical features
- Optimization opportunities

## Step 3: Unit Test Matrix

**Purpose:** Test individual functions/classes in isolation.

### Unit Test Categories

**1. Business Logic**
```typescript
// Feature: Payment validation
describe('PaymentValidator', () => {
  describe('validateCardNumber', () => {
    it('accepts valid Visa card', () => {
      expect(validateCardNumber('4111111111111111')).toBe(true);
    });

    it('accepts valid Mastercard', () => {
      expect(validateCardNumber('5500000000000004')).toBe(true);
    });

    it('rejects invalid card number', () => {
      expect(validateCardNumber('1234')).toBe(false);
    });

    it('rejects expired card', () => {
      const card = { number: '4111111111111111', expiry: '01/2020' };
      expect(validateCard(card)).toHaveError('card_expired');
    });

    it('validates CVV length', () => {
      expect(validateCVV('123')).toBe(true);  // 3 digits
      expect(validateCVV('1234')).toBe(true); // 4 digits (Amex)
      expect(validateCVV('12')).toBe(false);  // Too short
    });
  });
});
```

**2. Edge Cases**
```typescript
describe('calculateTotal', () => {
  it('handles zero items', () => {
    expect(calculateTotal([])).toBe(0);
  });

  it('handles single item', () => {
    expect(calculateTotal([{ price: 100 }])).toBe(100);
  });

  it('handles negative prices (should throw)', () => {
    expect(() => calculateTotal([{ price: -10 }])).toThrow('Negative price');
  });

  it('handles floating point precision', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS
    expect(calculateTotal([{ price: 0.1 }, { price: 0.2 }])).toBe(0.3);
  });

  it('handles very large totals', () => {
    const items = Array(1000).fill({ price: 1000000 });
    expect(calculateTotal(items)).toBe(1000000000);
  });
});
```

**3. Error Handling**
```typescript
describe('processPayment error handling', () => {
  it('throws on invalid amount', () => {
    expect(() => processPayment({ amount: -100 })).toThrow('Invalid amount');
  });

  it('throws on missing payment method', () => {
    expect(() => processPayment({ amount: 100 })).toThrow('Payment method required');
  });

  it('retries on transient errors', async () => {
    const mockAPI = jest.fn()
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValueOnce({ success: true });

    const result = await processPaymentWithRetry(mockAPI);

    expect(mockAPI).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
  });

  it('gives up after max retries', async () => {
    const mockAPI = jest.fn().mockRejectedValue(new Error('Timeout'));

    await expect(processPaymentWithRetry(mockAPI)).rejects.toThrow('Max retries exceeded');
    expect(mockAPI).toHaveBeenCalledTimes(3); // Max retries
  });
});
```

**4. State Management**
```typescript
describe('ShoppingCart', () => {
  let cart: ShoppingCart;

  beforeEach(() => {
    cart = new ShoppingCart();
  });

  it('starts empty', () => {
    expect(cart.getItems()).toEqual([]);
    expect(cart.getTotal()).toBe(0);
  });

  it('adds item to cart', () => {
    cart.addItem({ id: '1', name: 'Widget', price: 100 });

    expect(cart.getItems()).toHaveLength(1);
    expect(cart.getTotal()).toBe(100);
  });

  it('increments quantity for duplicate items', () => {
    cart.addItem({ id: '1', name: 'Widget', price: 100 });
    cart.addItem({ id: '1', name: 'Widget', price: 100 });

    expect(cart.getItems()).toHaveLength(1);
    expect(cart.getItems()[0].quantity).toBe(2);
    expect(cart.getTotal()).toBe(200);
  });

  it('removes item from cart', () => {
    cart.addItem({ id: '1', name: 'Widget', price: 100 });
    cart.removeItem('1');

    expect(cart.getItems()).toEqual([]);
    expect(cart.getTotal()).toBe(0);
  });

  it('clears cart', () => {
    cart.addItem({ id: '1', name: 'Widget', price: 100 });
    cart.addItem({ id: '2', name: 'Gadget', price: 200 });
    cart.clear();

    expect(cart.getItems()).toEqual([]);
    expect(cart.getTotal()).toBe(0);
  });
});
```

### Unit Test Coverage Goals

```markdown
## Unit Test Coverage Goals

| Module | Target | Actual | Gap | Priority |
|--------|--------|--------|-----|----------|
| Payment validation | 95% | 92% | -3% | P0 |
| Order processing | 90% | 85% | -5% | P0 |
| Cart management | 90% | 95% | +5% ✅ | P0 |
| Email formatting | 80% | 75% | -5% | P1 |
| Analytics tracking | 70% | 65% | -5% | P2 |
| UI components | 80% | 60% | -20% ❌ | P1 |

**Coverage gaps:**
- ❌ UI components: 20% below target (missing edge case tests)
- ⚠️ Order processing: 5% below target (missing error handling tests)

**Action items:**
1. Add UI component edge case tests (owner: Alice, due: Week 1)
2. Add order processing error tests (owner: Bob, due: Week 1)
```

## Step 4: Integration Test Matrix

**Purpose:** Test multiple components together (API + database + external services).

### Integration Test Categories

**1. API + Database Integration**
```typescript
// Test: User creation flow (API → Database)
describe('POST /api/users (integration)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  afterEach(async () => {
    await db.clear();
  });

  it('creates user in database', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'alice@example.com' })
      .expect(201);

    // Verify: User in database
    const user = await db.users.findOne({ email: 'alice@example.com' });
    expect(user).toBeDefined();
    expect(user.name).toBe('Alice');

    // Verify: Response matches database
    expect(response.body.id).toBe(user.id);
  });

  it('returns 400 for duplicate email', async () => {
    // Create user
    await db.users.create({ name: 'Alice', email: 'alice@example.com' });

    // Try to create duplicate
    const response = await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'alice@example.com' })
      .expect(400);

    expect(response.body.error).toBe('email_already_exists');
  });

  it('validates email format', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'invalid-email' })
      .expect(400);

    expect(response.body.error).toBe('invalid_email');

    // Verify: User NOT in database
    const count = await db.users.count();
    expect(count).toBe(0);
  });
});
```

**2. External API Integration**
```typescript
// Test: Payment processing (API → Stripe)
describe('Payment processing (integration)', () => {
  let stripeServer: StripeTestServer;

  beforeAll(() => {
    stripeServer = new StripeTestServer();
    stripeServer.start();
  });

  afterAll(() => {
    stripeServer.stop();
  });

  it('processes payment via Stripe', async () => {
    // Configure mock Stripe response
    stripeServer.mockCharge({
      id: 'ch_123',
      amount: 1000,
      status: 'succeeded'
    });

    const result = await paymentService.processPayment({
      amount: 1000,
      currency: 'usd',
      source: 'tok_visa'
    });

    expect(result.success).toBe(true);
    expect(result.chargeId).toBe('ch_123');

    // Verify: Stripe API called correctly
    expect(stripeServer.requests).toHaveLength(1);
    expect(stripeServer.requests[0]).toMatchObject({
      method: 'POST',
      path: '/v1/charges',
      body: {
        amount: 1000,
        currency: 'usd',
        source: 'tok_visa'
      }
    });
  });

  it('handles Stripe errors', async () => {
    // Configure mock Stripe error
    stripeServer.mockError({
      type: 'card_error',
      code: 'insufficient_funds',
      message: 'Your card has insufficient funds.'
    });

    await expect(
      paymentService.processPayment({
        amount: 1000,
        currency: 'usd',
        source: 'tok_visa'
      })
    ).rejects.toThrow('insufficient_funds');
  });

  it('retries on timeout', async () => {
    // First request: timeout
    stripeServer.mockTimeout();

    // Second request: success
    stripeServer.mockCharge({ id: 'ch_123', status: 'succeeded' });

    const result = await paymentService.processPayment({
      amount: 1000,
      currency: 'usd',
      source: 'tok_visa'
    });

    expect(result.success).toBe(true);
    expect(stripeServer.requests).toHaveLength(2); // Retry
  });
});
```

**3. Message Queue Integration**
```typescript
// Test: Event publishing and consumption
describe('Event processing (integration)', () => {
  let queue: TestMessageQueue;

  beforeAll(async () => {
    queue = await createTestQueue();
  });

  afterAll(async () => {
    await queue.close();
  });

  it('publishes and consumes user.created event', async () => {
    const events: UserCreatedEvent[] = [];

    // Subscribe to events
    queue.subscribe('user.created', (event) => {
      events.push(event);
    });

    // Publish event
    await eventBus.publish<UserCreatedEvent>({
      type: 'user.created',
      userId: 'user-123',
      name: 'Alice'
    });

    // Wait for event to be consumed
    await queue.waitForMessages(1);

    expect(events).toHaveLength(1);
    expect(events[0].userId).toBe('user-123');
  });

  it('handles event processing errors with retry', async () => {
    let attempts = 0;

    queue.subscribe('user.created', (event) => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Transient error');
      }
      // Success on 3rd attempt
    });

    await eventBus.publish({ type: 'user.created', userId: 'user-123' });

    await queue.waitForMessages(1);

    expect(attempts).toBe(3); // Retried 2 times
  });
});
```

### Integration Test Coverage Goals

```markdown
## Integration Test Coverage Goals

| Integration Point | Tests | Coverage | Priority | Status |
|-------------------|-------|----------|----------|--------|
| User API + DB | 15 tests | 95% | P0 | ✅ Done |
| Payment API + Stripe | 12 tests | 90% | P0 | ✅ Done |
| Order API + DB | 10 tests | 85% | P0 | ⏳ In Progress |
| Email service | 8 tests | 80% | P1 | ✅ Done |
| Event publishing | 6 tests | 75% | P1 | ⏳ In Progress |
| Auth + Session store | 5 tests | 70% | P0 | ❌ Gap |

**Coverage gaps:**
- ❌ Auth + Session store: No integration tests (critical gap!)
- ⚠️ Order API + DB: Missing error handling tests

**Action items:**
1. Add auth + session store integration tests (owner: Charlie, due: Week 1) - BLOCKER
2. Complete order API error tests (owner: Alice, due: Week 2)
```

## Step 5: Contract Test Matrix

**Purpose:** Verify API contracts between services (provider and consumer agree on API shape).

### Contract Testing with Pact

**Provider (API server):**
```typescript
// Test: User API contract (provider side)
describe('User API contract (provider)', () => {
  it('GET /api/users/:id matches contract', async () => {
    // Consumer expects this response shape
    const expectedContract = {
      id: 'string',
      name: 'string',
      email: 'string',
      created_at: 'string (ISO 8601)'
    };

    const user = await db.users.create({
      id: 'user-123',
      name: 'Alice',
      email: 'alice@example.com'
    });

    const response = await request(app)
      .get('/api/users/user-123')
      .expect(200);

    // Verify: Response matches contract
    expect(response.body).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      email: expect.any(String),
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    });

    // Verify: No extra fields
    expect(Object.keys(response.body)).toEqual(['id', 'name', 'email', 'created_at']);
  });
});
```

**Consumer (client):**
```typescript
// Test: User API contract (consumer side)
describe('User API contract (consumer)', () => {
  it('can parse GET /api/users/:id response', async () => {
    // Mock API response (what provider promises)
    nock('https://api.example.com')
      .get('/api/users/user-123')
      .reply(200, {
        id: 'user-123',
        name: 'Alice',
        email: 'alice@example.com',
        created_at: '2024-01-15T10:00:00Z'
      });

    // Consumer code
    const user = await userClient.getUser('user-123');

    // Verify: Consumer can parse response
    expect(user.id).toBe('user-123');
    expect(user.name).toBe('Alice');
    expect(user.email).toBe('alice@example.com');
    expect(user.createdAt).toBeInstanceOf(Date);
  });
});
```

### OpenAPI Contract Validation

```typescript
// Test: Validate API against OpenAPI spec
import { validateResponse } from 'openapi-validator';

describe('API contract validation', () => {
  it('POST /api/users response matches OpenAPI spec', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'alice@example.com' })
      .expect(201);

    // Validate against OpenAPI spec
    const validation = validateResponse({
      spec: './openapi.yaml',
      path: '/api/users',
      method: 'post',
      statusCode: 201,
      response: response.body
    });

    expect(validation.errors).toEqual([]);
  });

  it('POST /api/users error response matches OpenAPI spec', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({ name: 'Alice' }) // Missing email
      .expect(400);

    // Validate error response
    const validation = validateResponse({
      spec: './openapi.yaml',
      path: '/api/users',
      method: 'post',
      statusCode: 400,
      response: response.body
    });

    expect(validation.errors).toEqual([]);
    expect(response.body).toMatchObject({
      error: expect.any(String),
      message: expect.any(String)
    });
  });
});
```

### Contract Test Matrix

```markdown
## Contract Test Matrix

| API Endpoint | Provider Test | Consumer Test | OpenAPI Validation | Status |
|--------------|---------------|---------------|-------------------|--------|
| GET /api/users/:id | ✅ | ✅ | ✅ | ✅ Done |
| POST /api/users | ✅ | ✅ | ✅ | ✅ Done |
| PUT /api/users/:id | ✅ | ✅ | ✅ | ✅ Done |
| DELETE /api/users/:id | ✅ | ✅ | ✅ | ✅ Done |
| GET /api/orders | ✅ | ⏳ | ✅ | ⏳ In Progress |
| POST /api/orders | ✅ | ⏳ | ✅ | ⏳ In Progress |
| POST /api/payments | ✅ | ❌ | ✅ | ❌ Gap |

**Coverage gaps:**
- ❌ Payment API: No consumer contract tests
- ⏳ Order API: Consumer tests in progress

**Action items:**
1. Add payment API consumer tests (owner: Alice, due: Week 1)
2. Complete order API consumer tests (owner: Bob, due: Week 1)
```

## Step 6: E2E Test Matrix

**Purpose:** Test full user journeys end-to-end (browser → API → database).

### E2E Test Categories

**1. Critical User Journeys**
```typescript
// Test: Complete checkout flow (E2E)
describe('Checkout flow (E2E)', () => {
  it('completes purchase from browse to confirmation', async () => {
    // Setup: Start with clean state
    await page.goto('http://localhost:3000');

    // Step 1: Browse products
    await page.click('[data-testid="products-link"]');
    await page.waitForSelector('[data-testid="product-list"]');

    // Step 2: Add item to cart
    await page.click('[data-testid="add-to-cart-btn"]');
    await expect(page.locator('[data-testid="cart-count"]')).toHaveText('1');

    // Step 3: Go to checkout
    await page.click('[data-testid="checkout-btn"]');
    await page.waitForSelector('[data-testid="checkout-form"]');

    // Step 4: Fill shipping info
    await page.fill('[data-testid="name-input"]', 'Alice Smith');
    await page.fill('[data-testid="email-input"]', 'alice@example.com');
    await page.fill('[data-testid="address-input"]', '123 Main St');

    // Step 5: Fill payment info (test card)
    await page.fill('[data-testid="card-number-input"]', '4242424242424242');
    await page.fill('[data-testid="expiry-input"]', '12/25');
    await page.fill('[data-testid="cvv-input"]', '123');

    // Step 6: Submit payment
    await page.click('[data-testid="pay-btn"]');

    // Step 7: Verify confirmation
    await page.waitForSelector('[data-testid="confirmation-page"]');
    await expect(page.locator('[data-testid="order-status"]')).toHaveText('Payment successful');

    // Verify: Order in database
    const orders = await db.orders.find({ email: 'alice@example.com' });
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('paid');

    // Verify: Email sent
    const emails = await emailService.getSentEmails();
    expect(emails).toContainEqual(
      expect.objectContaining({
        to: 'alice@example.com',
        subject: expect.stringContaining('Order confirmation')
      })
    );
  });
});
```

**2. Error Scenarios**
```typescript
describe('Payment error handling (E2E)', () => {
  it('shows error for declined card', async () => {
    await page.goto('http://localhost:3000/checkout');

    // Fill form with declined card
    await page.fill('[data-testid="card-number-input"]', '4000000000000002'); // Declined card
    await page.click('[data-testid="pay-btn"]');

    // Verify: Error message shown
    await expect(page.locator('[data-testid="error-message"]')).toHaveText(
      'Your card was declined. Please try a different payment method.'
    );

    // Verify: Order NOT created
    const orders = await db.orders.find({ email: 'alice@example.com' });
    expect(orders).toHaveLength(0);
  });

  it('handles network timeout gracefully', async () => {
    // Simulate slow network
    await page.route('**/api/payments', (route) => {
      setTimeout(() => route.abort(), 5000); // Timeout after 5s
    });

    await page.goto('http://localhost:3000/checkout');
    await page.fill('[data-testid="card-number-input"]', '4242424242424242');
    await page.click('[data-testid="pay-btn"]');

    // Verify: Timeout error shown
    await expect(page.locator('[data-testid="error-message"]')).toHaveText(
      'Payment processing timed out. Please try again.'
    );
  });
});
```

**3. Performance Tests**
```typescript
describe('Performance (E2E)', () => {
  it('checkout page loads in <2 seconds', async () => {
    const start = Date.now();

    await page.goto('http://localhost:3000/checkout');
    await page.waitForLoadState('networkidle');

    const loadTime = Date.now() - start;

    expect(loadTime).toBeLessThan(2000); // <2s
  });

  it('payment processing completes in <5 seconds', async () => {
    await page.goto('http://localhost:3000/checkout');

    // Fill form
    await page.fill('[data-testid="card-number-input"]', '4242424242424242');

    const start = Date.now();
    await page.click('[data-testid="pay-btn"]');
    await page.waitForSelector('[data-testid="confirmation-page"]');
    const processingTime = Date.now() - start;

    expect(processingTime).toBeLessThan(5000); // <5s
  });
});
```

### E2E Test Matrix

```markdown
## E2E Test Matrix

| User Journey | Steps | Duration | Priority | Status | Flakiness |
|--------------|-------|----------|----------|--------|-----------|
| **Critical Paths (P0)** |
| Complete checkout | 7 steps | 15s | P0 | ✅ Done | Stable ✅ |
| User registration | 4 steps | 8s | P0 | ✅ Done | Stable ✅ |
| User login | 3 steps | 5s | P0 | ✅ Done | Stable ✅ |
| **Error Scenarios (P0)** |
| Declined card | 5 steps | 10s | P0 | ✅ Done | Stable ✅ |
| Network timeout | 5 steps | 12s | P0 | ✅ Done | Flaky ⚠️ (20%) |
| Invalid input | 3 steps | 6s | P0 | ✅ Done | Stable ✅ |
| **Important Paths (P1)** |
| Product search | 4 steps | 8s | P1 | ✅ Done | Stable ✅ |
| Order history | 3 steps | 6s | P1 | ⏳ In Progress | - |
| Refund request | 5 steps | 12s | P1 | ❌ Gap | - |
| **Performance (P0)** |
| Page load <2s | 1 step | 2s | P0 | ✅ Done | Stable ✅ |
| Payment <5s | 1 step | 5s | P0 | ✅ Done | Flaky ⚠️ (10%) |

**Total E2E tests:** 10
**Total duration:** 89s (~1.5 minutes)
**Flaky tests:** 2 (20% and 10% failure rate)

**Issues:**
- ⚠️ Network timeout test flaky (20% failure rate) - needs investigation
- ⚠️ Payment performance test flaky (10% failure rate) - timing issue
- ❌ Refund request journey not tested

**Action items:**
1. Fix flaky network timeout test (owner: Alice, due: Week 1)
2. Fix flaky payment performance test (owner: Bob, due: Week 1)
3. Add refund request E2E test (owner: Charlie, due: Week 2)
```

## Step 7: CI Budget Analysis

Track **test execution time** and **cost** to optimize CI pipeline.

### CI Budget Breakdown

```markdown
## CI Budget Analysis

| Test Level | Count | Avg Duration | Total Duration | % of Budget | Status |
|------------|-------|--------------|----------------|-------------|--------|
| Unit tests | 1,247 | 8ms | 10s | 10% | ✅ Fast |
| Integration tests | 156 | 450ms | 70s | 70% | ⚠️ Slow |
| Contract tests | 45 | 200ms | 9s | 9% | ✅ Fast |
| E2E tests | 10 | 8.9s | 89s | 89% | ❌ Very slow |
| **Total** | **1,458** | - | **178s** | - | ⚠️ |

**Budget target:** <120s (2 minutes)
**Current duration:** 178s (2m 58s)
**Over budget by:** 58s (48%)

**Slowest tests:**
1. E2E checkout flow: 15s
2. E2E network timeout: 12s (flaky)
3. Integration: Payment processing: 8s
4. Integration: Order creation: 6s
5. E2E payment performance: 5s (flaky)

**Optimization opportunities:**
1. **Parallelize E2E tests**: Run on 2 workers → 89s → 45s (save 44s) ✅
2. **Cache integration test DB**: Reuse DB between tests → 70s → 50s (save 20s) ✅
3. **Remove flaky tests from PR checks**: Run on nightly instead → 12s + 5s = 17s saved ✅

**After optimizations:**
- Unit: 10s
- Integration: 50s (cached DB)
- Contract: 9s
- E2E: 45s (parallelized)
- **Total: 114s** ✅ (under 120s budget)
```

### CI Pipeline Stages

```yaml
# .github/workflows/ci.yml

name: CI

on: [push, pull_request]

jobs:
  # Stage 1: Fast feedback (unit + contract tests)
  fast-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Unit tests
        run: npm test -- --testPathPattern=unit
        timeout-minutes: 1

      - name: Contract tests
        run: npm test -- --testPathPattern=contract
        timeout-minutes: 1

  # Stage 2: Integration tests (slower)
  integration-tests:
    runs-on: ubuntu-latest
    needs: fast-tests
    steps:
      - name: Start test database
        run: docker-compose up -d postgres redis

      - name: Integration tests
        run: npm test -- --testPathPattern=integration
        timeout-minutes: 2

  # Stage 3: E2E tests (slowest, only on main branch)
  e2e-tests:
    runs-on: ubuntu-latest
    needs: integration-tests
    if: github.ref == 'refs/heads/main'
    steps:
      - name: E2E tests
        run: npm test -- --testPathPattern=e2e
        timeout-minutes: 3

  # Nightly: Flaky tests (don't block PRs)
  nightly:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule'
    steps:
      - name: Flaky tests
        run: npm test -- --testPathPattern=flaky
        timeout-minutes: 5
```

## Step 8: Coverage Gap Analysis

Identify **untested scenarios** and prioritize closing gaps.

### Coverage Gap Matrix

```markdown
## Coverage Gap Analysis

| Scenario | Risk | Impact | Unit | Integration | Contract | E2E | Status |
|----------|------|--------|------|-------------|----------|-----|--------|
| **Happy Paths** |
| Successful payment | High | High | ✅ | ✅ | ✅ | ✅ | ✅ Covered |
| User registration | High | High | ✅ | ✅ | ✅ | ✅ | ✅ Covered |
| Product search | Medium | Medium | ✅ | ✅ | - | ✅ | ✅ Covered |
| **Error Cases** |
| Declined card | High | High | ✅ | ✅ | - | ✅ | ✅ Covered |
| Duplicate order (idempotency) | High | High | ✅ | ✅ | - | - | ⚠️ Partial (missing E2E) |
| Database unavailable | High | Medium | ✅ | ❌ | - | - | ❌ **Gap** |
| Stripe API timeout | High | Medium | ✅ | ✅ | - | ⚠️ | ⚠️ Flaky E2E |
| **Edge Cases** |
| Concurrent payments | High | High | ✅ | ❌ | - | - | ❌ **Gap** |
| Currency conversion | Medium | Medium | ✅ | ✅ | - | - | ✅ Covered |
| Refund processing | Medium | Medium | ✅ | ✅ | ✅ | ❌ | ❌ **Gap** (no E2E) |
| Expired card | Medium | Low | ✅ | ✅ | - | - | ✅ Covered |
| **Security** |
| SQL injection | High | High | ✅ | ✅ | - | - | ✅ Covered |
| XSS attack | High | High | ✅ | ❌ | - | - | ❌ **Gap** |
| CSRF protection | High | High | ❌ | ❌ | - | - | ❌ **Gap** |
| **Performance** |
| Handle 1000 req/s | High | High | - | - | - | ⏳ | ⏳ Load test TODO |
| Payment <5s latency | High | Medium | - | - | - | ✅ | ✅ Covered |

**Critical gaps (P0 - must fix before ship):**
1. ❌ Database unavailable (integration test needed)
2. ❌ Concurrent payments (race condition integration test)
3. ❌ XSS attack (integration test needed)
4. ❌ CSRF protection (integration + E2E tests needed)
5. ⏳ Load test at 1000 req/s (performance test needed)

**Important gaps (P1 - should fix):**
6. ❌ Refund processing (E2E test needed)
7. ⚠️ Duplicate order (E2E test needed for full coverage)
8. ⚠️ Stripe API timeout (E2E test flaky, needs fixing)

**Action items:**
1. Add database unavailable integration test (owner: Alice, due: Week 1) - BLOCKER
2. Add concurrent payments race condition test (owner: Bob, due: Week 1) - BLOCKER
3. Add XSS attack integration test (owner: Charlie, due: Week 1) - BLOCKER
4. Add CSRF protection tests (owner: Alice, due: Week 1) - BLOCKER
5. Add load test for 1000 req/s (owner: David, due: Week 2) - BLOCKER
6. Add refund E2E test (owner: Bob, due: Week 2)
7. Fix flaky Stripe timeout E2E test (owner: Alice, due: Week 1)
```

## Step 9: Test Strategy Document

Generate comprehensive test strategy at `.claude/<SESSION_SLUG>/test-matrix-<feature-slug>.md`:

```markdown
# Test Matrix: [Feature Name]

**Date:** YYYY-MM-DD
**Author:** [Name]
**Feature:** [Description]
**Status:** [Planning / In Progress / Complete]

---

## Executive Summary

**Test coverage:** [X%] (target: 80%)
**CI duration:** [Xs] (budget: 120s)
**Coverage gaps:** [count] critical, [count] important

**Recommendation:** [Ship / Fix gaps first / Needs more testing]

---

## Behavior-Driven Test Matrix

[Table from Step 2]

---

## Test Coverage by Level

### Unit Tests
[From Step 3]

### Integration Tests
[From Step 4]

### Contract Tests
[From Step 5]

### E2E Tests
[From Step 6]

---

## CI Budget Analysis

[From Step 7]

---

## Coverage Gap Analysis

[From Step 8]

---

## Test Execution Plan

[How to run tests, CI pipeline]

---

## Sign-off

[Project owner approvals (if needed)]
```

## Summary

A comprehensive test matrix:

1. **Behavior-driven matrix** (map requirements to tests)
2. **Test pyramid** (many unit, some integration, few e2e)
3. **Unit test categories** (business logic, edge cases, errors, state)
4. **Integration test categories** (API+DB, external APIs, queues)
5. **Contract tests** (provider/consumer, OpenAPI validation)
6. **E2E test categories** (critical journeys, errors, performance)
7. **CI budget analysis** (execution time, optimization)
8. **Coverage gap analysis** (untested scenarios, prioritization)

**Key principles:**
- Test behavior, not implementation
- Follow test pyramid (fast, reliable, cheap at bottom)
- Identify and fix coverage gaps
- Optimize CI budget (<2 minutes)
- Fix flaky tests (or remove from PR checks)
- Prioritize by risk × impact

**The goal:** Comprehensive test coverage with fast, reliable, maintainable tests that give confidence to ship.
