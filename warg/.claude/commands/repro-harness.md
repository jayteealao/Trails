---
name: repro-harness
description: Create minimal reproduction harness for bugs with deterministic tests and regression coverage
usage: /repro-harness [BUG_DESCRIPTION] [FILES]
arguments:
  - name: BUG_DESCRIPTION
    description: 'Brief description of the bug or issue to reproduce'
    required: false
  - name: FILES
    description: 'Files related to the bug (glob patterns supported)'
    required: false
examples:
  - command: /repro-harness "Race condition in payment processing"
    description: Create repro harness for payment race condition
  - command: /repro-harness "Memory leak in websocket" "src/ws/**/*.ts"
    description: Create repro harness for websocket memory leak
  - command: /repro-harness
    description: Interactive mode - guide through creating repro harness
---

# Reproduction Harness Creation

You are a reproduction harness specialist who creates **minimal, deterministic test harnesses** for bugs. Your goal: make bugs reproducible 100% of the time with the smallest possible test case.

## Philosophy: Minimal Reproducible Examples

**A good reproduction harness:**
- Reproduces the bug **reliably** (not "sometimes")
- Contains **only** code needed to trigger the bug
- Runs **fast** (<1 second if possible)
- Uses **deterministic** inputs (no randomness, frozen time)
- **Documents** the expected vs actual behavior
- Becomes a **regression test** after the fix

**Anti-patterns:**
- "Works on my machine sometimes"
- Requires manual steps or timing
- Includes unrelated code
- Depends on external services
- Uses production data

## Step 1: Understand the Bug

If `BUG_DESCRIPTION` provided, parse it. Otherwise, ask:

**Interactive prompts:**
1. **What's the symptom?** (error message, wrong output, crash, hang)
2. **When does it happen?** (always, intermittently, under load, specific input)
3. **What's the expected behavior?**
4. **What code is involved?** (file paths, function names)
5. **Environment specifics?** (OS, Node version, dependencies)

**Gather evidence:**
- Error stack traces
- Logs leading up to failure
- Input data that triggers bug
- Environment variables
- Timing/concurrency clues

## Step 2: Classify Bug Type

Identify bug category to guide reproduction strategy:

### 2.1 Deterministic Bugs
**Characteristics:**
- Always happens with same input
- No timing dependencies
- Easy to reproduce

**Examples:**
- Wrong calculation: `sum([1, 2, 3]) returns 5 instead of 6`
- Exception on specific input: `parseDate("2024-02-30") crashes`
- Wrong HTTP status: `DELETE /users/123 returns 200 instead of 204`

**Reproduction strategy:**
- Unit test with exact input
- Assert expected vs actual
- No mocking needed (usually)

### 2.2 Timing Bugs (Race Conditions)
**Characteristics:**
- Happens intermittently
- Depends on execution order
- More common under load

**Examples:**
- Two concurrent writes corrupt state
- Callback called before initialization
- Cache update after response sent

**Reproduction strategy:**
- Control execution order (delays, locks)
- Parallel execution in test
- Use `setImmediate`, `process.nextTick`
- Repeat many times (100+ iterations)

### 2.3 State Bugs
**Characteristics:**
- Happens after specific sequence
- Test order matters
- Shared mutable state

**Examples:**
- Second test fails because first test left garbage
- Module-level cache causes wrong result
- Singleton retains state

**Reproduction strategy:**
- Sequence multiple operations
- Don't reset state between steps
- Assert intermediate state

### 2.4 Environment Bugs
**Characteristics:**
- Depends on OS, timezone, locale
- Works in dev, fails in production
- Environment variables matter

**Examples:**
- Date parsing fails in non-US locale
- File paths break on Windows
- Missing env var causes crash

**Reproduction strategy:**
- Mock environment variables
- Override `process.env`, `Date`, locale
- Test multiple environments

### 2.5 Dependency Bugs
**Characteristics:**
- Happens with specific version
- External service behavior
- Network timing

**Examples:**
- API returns unexpected format
- Database driver bug
- HTTP library timeout handling

**Reproduction strategy:**
- Mock external dependencies
- Use fixtures for API responses
- Control timing with fake timers

## Step 3: Create Minimal Reproduction

### 3.1 Start with Full Context
**Don't minimize yet** - first, reproduce the bug in full context:

```typescript
// Step 1: Copy actual code that triggers bug
describe('Payment processing bug', () => {
  it('reproduces the race condition', async () => {
    // Exact production scenario
    const userId = 'user-123';
    const cart = await db.getCart(userId);

    // Trigger concurrent checkouts
    const [result1, result2] = await Promise.all([
      checkoutService.processPayment(userId, cart),
      checkoutService.processPayment(userId, cart)
    ]);

    // Bug: Both succeed, user charged twice
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(false); // ❌ Fails: also true
  });
});
```

### 3.2 Remove Dependencies
**Eliminate external services** one by one:

```typescript
// ❌ BEFORE: Depends on real database
const cart = await db.getCart(userId);

// ✅ AFTER: In-memory fixture
const cart = {
  id: 'cart-123',
  userId: 'user-123',
  items: [{ productId: 'prod-1', quantity: 1 }],
  totalCents: 1000
};
```

**Mock external APIs:**

```typescript
// ❌ BEFORE: Calls real payment API
await paymentGateway.charge(order);

// ✅ AFTER: Mocked gateway
const mockPaymentGateway = {
  charge: jest.fn().mockResolvedValue({ success: true, chargeId: 'ch_123' })
};
```

### 3.3 Make Deterministic
**Freeze time:**

```typescript
// ❌ BEFORE: Uses real time (non-deterministic)
const now = Date.now();

// ✅ AFTER: Frozen time
jest.useFakeTimers();
jest.setSystemTime(new Date('2024-01-15T10:00:00Z'));

const now = Date.now(); // Always 1705316400000
```

**Seed randomness:**

```typescript
// ❌ BEFORE: Random UUIDs (different each run)
const id = uuid.v4();

// ✅ AFTER: Deterministic IDs
let counter = 0;
jest.mock('uuid', () => ({
  v4: () => `mock-uuid-${counter++}`
}));

const id = uuid.v4(); // Always 'mock-uuid-0'
```

**Control async timing:**

```typescript
// ❌ BEFORE: Depends on real timing
await sleep(100);

// ✅ AFTER: Control with fake timers
jest.useFakeTimers();
const promise = doAsyncWork();
jest.advanceTimersByTime(100);
await promise;
```

### 3.4 Minimize Code
**Remove irrelevant code** until bug disappears, then add back:

```typescript
// ❌ BEFORE: 100 lines of code
async function processOrder(userId, cart, shippingAddress, billingAddress, promoCode) {
  // Validate user
  // Check inventory
  // Apply promo code
  // Calculate shipping
  // Process payment  ← Bug is here
  // Send confirmation email
  // Update analytics
}

// ✅ AFTER: 10 lines (minimal repro)
async function processPayment(userId, amountCents) {
  const charge = await paymentGateway.charge(userId, amountCents);
  // Bug: No idempotency check before charging
  return charge;
}

// Minimal test
it('charges user only once', async () => {
  const charge1 = await processPayment('user-1', 1000);
  const charge2 = await processPayment('user-1', 1000); // Same params

  expect(paymentGateway.charge).toHaveBeenCalledTimes(1); // ❌ Fails: called 2x
});
```

## Step 4: Reproduction Harness Checklist

**For each reproduction harness, verify:**

### 4.1 Reliability
- [ ] Bug reproduces **100% of the time** (not 50%, not 90%)
- [ ] Test passes after bug fixed
- [ ] Test is not flaky (run 100 times, passes every time)

**Anti-pattern:**
```typescript
// ❌ BAD: Flaky test (race condition)
it('should handle concurrent requests', async () => {
  // Sometimes passes, sometimes fails
  const results = await Promise.all([
    handleRequest(),
    handleRequest()
  ]);
});

// ✅ GOOD: Reliable test
it('should handle concurrent requests', async () => {
  // Use deterministic ordering
  const request1 = handleRequest();
  await tick(); // Force event loop tick
  const request2 = handleRequest();

  const results = await Promise.all([request1, request2]);
  // Always reproduces bug
});
```

### 4.2 Minimality
- [ ] Only includes code needed to trigger bug
- [ ] No unrelated features or setup
- [ ] Runs in <1 second (if possible)
- [ ] Can be understood quickly

**Anti-pattern:**
```typescript
// ❌ BAD: Includes irrelevant code
describe('Bug repro', () => {
  beforeEach(async () => {
    await setupDatabase();
    await seedTestData();
    await startServer();
    await setupAuth();
    // ... 50 lines of setup
  });

  it('reproduces bug', async () => {
    // Actual bug is just:
    expect(calculateTax(100)).toBe(10); // ❌ Returns 9
  });
});

// ✅ GOOD: Minimal repro
it('calculates tax incorrectly', () => {
  expect(calculateTax(100)).toBe(10); // Expected
  expect(calculateTax(100)).toBe(9);  // Actual (bug)
});
```

### 4.3 Determinism
- [ ] No randomness (or seeded randomness)
- [ ] Time frozen or controlled
- [ ] External calls mocked
- [ ] File system operations isolated
- [ ] Network calls eliminated

**Anti-pattern:**
```typescript
// ❌ BAD: Non-deterministic
it('reproduces bug', async () => {
  const id = Math.random().toString(); // Different each run
  const result = await processOrder(id);
  // Sometimes passes, sometimes fails
});

// ✅ GOOD: Deterministic
it('reproduces bug', () => {
  const id = 'test-order-123'; // Always same
  const result = processOrder(id);
  expect(result.total).toBe(100); // Always fails same way
});
```

### 4.4 Documentation
- [ ] Test name describes the bug
- [ ] Comments explain expected vs actual
- [ ] Link to issue/ticket (if exists)
- [ ] Mark as regression test after fix

**Anti-pattern:**
```typescript
// ❌ BAD: Unclear test
it('test 1', () => {
  expect(foo(bar)).toBe(baz);
});

// ✅ GOOD: Well-documented
it('calculates discount incorrectly for negative prices (#1234)', () => {
  // Bug: Negative prices should return 0 discount, but returns NaN
  // See: https://github.com/example/issues/1234

  const discount = calculateDiscount({ price: -10, discountPercent: 20 });

  expect(discount).toBe(0);  // Expected behavior
  // expect(discount).toBe(NaN);  // ❌ Actual bug
});
```

### 4.5 Regression Protection
- [ ] Test committed with bug fix
- [ ] Test would catch regression
- [ ] Test runs in CI
- [ ] Test is maintainable

## Step 5: Common Patterns and Techniques

### 5.1 Race Condition Reproduction

**Pattern: Force specific ordering**

```typescript
// Bug: Race condition in concurrent writes
class Counter {
  private value = 0;

  async increment() {
    const current = this.value;
    await sleep(1); // ❌ Async gap allows race
    this.value = current + 1;
  }
}

// ❌ BAD: Doesn't reliably reproduce
it('has race condition', async () => {
  const counter = new Counter();
  await Promise.all([counter.increment(), counter.increment()]);

  expect(counter.value).toBe(2); // Sometimes passes!
});

// ✅ GOOD: Forces race condition
it('has race condition (forced)', async () => {
  const counter = new Counter();

  // Start both increments
  const inc1 = counter.increment();
  const inc2 = counter.increment();

  // Let them race
  await Promise.all([inc1, inc2]);

  expect(counter.value).toBe(2); // ❌ Always fails: value is 1
  // Bug: Second increment overwrites first
});

// ✅ BETTER: Explicit timing control
it('reproduces race condition with fake timers', async () => {
  jest.useFakeTimers();

  const counter = new Counter();
  const inc1 = counter.increment();
  const inc2 = counter.increment();

  // Advance timers to trigger async gap
  jest.advanceTimersByTime(2);

  await Promise.all([inc1, inc2]);

  expect(counter.value).toBe(2); // ❌ Always fails: value is 1
});
```

### 5.2 State Pollution Reproduction

**Pattern: Don't reset state**

```typescript
// Bug: Module-level state persists between tests
// src/cache.ts
let cache: Map<string, any> = new Map();

export function set(key: string, value: any) {
  cache.set(key, value);
}

export function get(key: string) {
  return cache.get(key);
}

// ❌ BAD: Each test runs in isolation
describe('Cache tests', () => {
  afterEach(() => {
    cache.clear(); // Hides the bug!
  });

  it('test 1', () => {
    set('key', 'value1');
    expect(get('key')).toBe('value1');
  });

  it('test 2', () => {
    expect(get('key')).toBeUndefined(); // Passes (state reset)
  });
});

// ✅ GOOD: Reproduce state pollution
describe('Cache state pollution', () => {
  // Don't reset state!

  it('sets value in test 1', () => {
    set('key', 'value1');
    expect(get('key')).toBe('value1');
  });

  it('leaks state to test 2', () => {
    // Bug: Cache from previous test still present
    expect(get('key')).toBeUndefined(); // ❌ Fails: 'value1'
  });
});
```

### 5.3 Time-Dependent Bug Reproduction

**Pattern: Freeze time**

```typescript
// Bug: Coupon expiration check uses wrong timezone
function isCouponValid(coupon: Coupon): boolean {
  const now = new Date();
  return now < coupon.expiresAt;
}

// ❌ BAD: Non-deterministic (depends on when test runs)
it('checks coupon expiration', () => {
  const coupon = {
    code: 'SAVE20',
    expiresAt: new Date('2024-01-15T23:59:59Z')
  };

  expect(isCouponValid(coupon)).toBe(true); // Fails after expiration!
});

// ✅ GOOD: Freeze time
it('incorrectly validates expired coupon due to timezone bug', () => {
  jest.useFakeTimers();

  // Set time to 2024-01-15 11:00 PM PST (= 2024-01-16 7:00 AM UTC)
  jest.setSystemTime(new Date('2024-01-16T07:00:00Z'));

  const coupon = {
    code: 'SAVE20',
    expiresAt: new Date('2024-01-15T23:59:59Z') // Already expired in UTC
  };

  // Bug: Coupon should be invalid, but returns true
  expect(isCouponValid(coupon)).toBe(false); // ❌ Fails: returns true
  // Problem: Compares PST time to UTC timestamp incorrectly
});
```

### 5.4 Async Callback Bug Reproduction

**Pattern: Control async execution**

```typescript
// Bug: Callback called before initialization
class DataLoader {
  private data: any = null;

  constructor() {
    // Async initialization
    this.load();
  }

  private async load() {
    await sleep(10);
    this.data = { loaded: true };
  }

  getData() {
    return this.data; // ❌ May be null if called before load()
  }
}

// ❌ BAD: Doesn't reliably reproduce
it('reproduces bug', async () => {
  const loader = new DataLoader();
  expect(loader.getData()).toBeTruthy(); // Sometimes passes!
});

// ✅ GOOD: Synchronous check
it('getData returns null before initialization', () => {
  const loader = new DataLoader();

  // Bug: getData() called immediately after constructor
  const data = loader.getData();

  expect(data).not.toBeNull(); // ❌ Fails: data is null
  // Constructor didn't wait for load() to complete
});

// ✅ BETTER: Control timing
it('getData returns null before initialization (explicit timing)', async () => {
  jest.useFakeTimers();

  const loader = new DataLoader();

  // Don't advance timers - load() hasn't completed
  const data = loader.getData();

  expect(data).not.toBeNull(); // ❌ Fails: data is null

  // After advancing timers, should work
  jest.advanceTimersByTime(10);
  await Promise.resolve(); // Flush promises

  expect(loader.getData()).toEqual({ loaded: true }); // ✅ Now works
});
```

### 5.5 Boundary Condition Bug Reproduction

**Pattern: Test edge cases**

```typescript
// Bug: Array index out of bounds
function getLastElement<T>(arr: T[]): T {
  return arr[arr.length - 1]; // ❌ Breaks on empty array
}

// ❌ BAD: Only tests happy path
it('returns last element', () => {
  expect(getLastElement([1, 2, 3])).toBe(3);
});

// ✅ GOOD: Tests boundary condition
describe('getLastElement boundary conditions', () => {
  it('returns last element for non-empty array', () => {
    expect(getLastElement([1, 2, 3])).toBe(3);
  });

  it('throws on empty array', () => {
    expect(() => getLastElement([])).toThrow(); // Expected
  });

  it('crashes on empty array (bug)', () => {
    const result = getLastElement([]);
    expect(result).toBeUndefined(); // ❌ Actual bug (should throw)
  });

  it('handles single element', () => {
    expect(getLastElement([1])).toBe(1);
  });
});
```

## Step 6: Generate Reproduction Harness Files

Create test files in appropriate location:

### 6.1 File Structure

```
tests/
├── repro/                          # Reproduction harnesses
│   ├── bug-1234-payment-race.test.ts
│   ├── bug-1235-cache-leak.test.ts
│   └── bug-1236-timezone.test.ts
├── unit/                           # Regular unit tests
├── integration/                    # Integration tests
└── fixtures/                       # Test fixtures
    ├── payment-responses.json
    └── user-data.json
```

### 6.2 Template: Basic Reproduction Test

```typescript
/**
 * Reproduction harness for: [Bug title]
 *
 * Issue: #[issue-number]
 * Created: [date]
 *
 * Bug description:
 * [1-2 sentence description]
 *
 * Expected behavior:
 * [What should happen]
 *
 * Actual behavior:
 * [What actually happens]
 *
 * Status: REPRODUCES | FIXED
 */

import { describe, it, expect } from '@jest/globals';
import { functionUnderTest } from '../src/module';

describe('Bug #1234: [Short title]', () => {
  it('reproduces the bug', () => {
    // Arrange: Minimal setup
    const input = { /* test data */ };

    // Act: Trigger the bug
    const result = functionUnderTest(input);

    // Assert: Document expected vs actual
    expect(result).toBe('expected'); // ✅ After fix
    // expect(result).toBe('wrong');  // ❌ Before fix (comment out after fixing)
  });

  it('passes after bug fix (regression protection)', () => {
    // This test should pass once bug is fixed
    // If it fails later, we have a regression

    const result = functionUnderTest({ /* same input */ });
    expect(result).toBe('expected');
  });
});
```

### 6.3 Template: Race Condition Reproduction

```typescript
/**
 * Reproduction harness for: Race condition in payment processing
 * Issue: #1234
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PaymentProcessor } from '../src/payment';

describe('Bug #1234: Race condition in payment processing', () => {
  let processor: PaymentProcessor;

  beforeEach(() => {
    jest.useFakeTimers();
    processor = new PaymentProcessor();
  });

  it('reproduces double charge race condition', async () => {
    const orderId = 'order-123';
    const amount = 1000;

    // Start two concurrent payment processes
    const payment1 = processor.charge(orderId, amount);
    const payment2 = processor.charge(orderId, amount);

    // Let both proceed concurrently
    jest.advanceTimersByTime(10);

    const results = await Promise.all([payment1, payment2]);

    // Expected: Second charge should fail (duplicate)
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false); // ❌ Bug: also true

    // Expected: Only one charge
    expect(processor.getTotalCharges()).toBe(amount); // ❌ Bug: amount * 2
  });

  it('prevents double charge with idempotency key (after fix)', async () => {
    // This test passes after adding idempotency check

    const orderId = 'order-123';
    const amount = 1000;
    const idempotencyKey = 'idem-abc';

    const payment1 = processor.charge(orderId, amount, idempotencyKey);
    const payment2 = processor.charge(orderId, amount, idempotencyKey);

    const results = await Promise.all([payment1, payment2]);

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false); // ✅ Deduped
    expect(processor.getTotalCharges()).toBe(amount); // ✅ Single charge
  });
});
```

### 6.4 Template: Mock-Heavy Reproduction

```typescript
/**
 * Reproduction harness for: Payment API timeout not handled
 * Issue: #1235
 */

import { describe, it, expect, jest } from '@jest/globals';
import { checkoutFlow } from '../src/checkout';

describe('Bug #1235: Payment API timeout crashes server', () => {
  it('reproduces crash on payment timeout', async () => {
    // Mock payment gateway that times out
    const mockGateway = {
      charge: jest.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          // Never resolves - simulates timeout
        });
      })
    };

    jest.useFakeTimers();

    const checkoutPromise = checkoutFlow({
      userId: 'user-123',
      cartId: 'cart-456',
      paymentGateway: mockGateway
    });

    // Advance time past expected timeout (5 seconds)
    jest.advanceTimersByTime(6000);

    // Expected: Should timeout gracefully with error
    await expect(checkoutPromise).rejects.toThrow('Payment timeout'); // ✅ After fix

    // Actual: Hangs forever (uncomment to reproduce)
    // await checkoutPromise; // ❌ Bug: Never resolves or rejects
  });

  it('handles payment timeout gracefully (after fix)', async () => {
    const mockGateway = {
      charge: jest.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          // Simulates timeout by not resolving
        });
      })
    };

    jest.useFakeTimers();

    const checkoutPromise = checkoutFlow({
      userId: 'user-123',
      cartId: 'cart-456',
      paymentGateway: mockGateway,
      timeoutMs: 5000
    });

    jest.advanceTimersByTime(6000);

    // After fix: Throws timeout error instead of hanging
    await expect(checkoutPromise).rejects.toThrow('Payment timeout');
  });
});
```

## Step 7: Integrate with Regression Suite

After bug is fixed:

1. **Mark test as regression test:**
   ```typescript
   // ✅ This test protects against regression
   it('[REGRESSION] prevents double charge with idempotency (#1234)', async () => {
     // Test that should always pass after fix
   });
   ```

2. **Move to appropriate test suite:**
   ```
   tests/repro/bug-1234.test.ts  →  tests/unit/payment.test.ts
   ```

3. **Update test description:**
   ```typescript
   // Before:
   it('reproduces double charge bug', async () => { /* ... */ });

   // After:
   it('prevents double charge with concurrent requests (#1234)', async () => {
     // Regression test for bug #1234
     // This test should always pass - if it fails, we have a regression
   });
   ```

4. **Ensure CI runs regression tests:**
   ```yaml
   # .github/workflows/ci.yml
   - name: Run tests
     run: npm test

   - name: Run regression tests
     run: npm test -- --testPathPattern=regression
   ```

## Step 8: Output Reproduction Harness Summary

After creating harness, output:

```markdown
# Reproduction Harness Created

## Bug: [Bug title]

**Issue**: #[issue-number]
**Created**: [timestamp]

## Files Created

1. `tests/repro/bug-[number]-[slug].test.ts` - Main reproduction test
2. `tests/fixtures/[slug]-fixture.json` - Test fixtures (if needed)

## Reproduction Success

- [✅/❌] Reproduces bug reliably (100% of time)
- [✅/❌] Minimal code (no unnecessary dependencies)
- [✅/❌] Deterministic (no randomness or timing issues)
- [✅/❌] Fast (<1 second execution)
- [✅/❌] Well-documented (explains expected vs actual)

## How to Run

```bash
# Run reproduction test
npm test tests/repro/bug-[number]-[slug].test.ts

# Should FAIL before fix (reproduces bug)
# Should PASS after fix (regression protection)
```

## Expected Behavior

[What should happen]

## Actual Behavior (Bug)

[What actually happens]

## Minimal Reproduction Steps

1. [Step 1]
2. [Step 2]
3. [Step 3]

## Next Steps

1. **Fix the bug** in source code
2. **Verify fix** - run reproduction test (should pass)
3. **Move test** to appropriate test suite (unit/integration)
4. **Mark as regression test** - update test name and comments
5. **Add to CI** - ensure test runs on every commit

## Notes

- [Any additional context]
- [Related issues]
- [Known workarounds]
```

## Example Reproduction Harnesses

### Example 1: Deterministic Calculation Bug

```typescript
/**
 * Reproduction harness for: Tax calculation rounds incorrectly
 * Issue: #789
 *
 * Bug: Tax calculation uses Math.round() instead of banker's rounding,
 *      causing incorrect totals for prices ending in .5
 *
 * Expected: Banker's rounding (round to nearest even)
 * Actual: Always rounds 0.5 up
 */

import { describe, it, expect } from '@jest/globals';
import { calculateTax } from '../src/cart';

describe('Bug #789: Tax calculation rounding error', () => {
  it('reproduces incorrect rounding for .5 cent amounts', () => {
    // Price: $10.05, Tax rate: 10%
    // Tax: $1.005 (should round to $1.00, not $1.01)

    const price = 1005; // cents
    const taxRate = 0.10;

    const tax = calculateTax(price, taxRate);

    // Expected: Banker's rounding (round to nearest even)
    expect(tax).toBe(100); // $1.00

    // Actual: Always rounds up
    // expect(tax).toBe(101); // ❌ Bug: $1.01
  });

  it('reproduces for multiple edge cases', () => {
    const cases = [
      { price: 1005, rate: 0.10, expected: 100, actual: 101 }, // 1.005 → 1.00
      { price: 1015, rate: 0.10, expected: 102, actual: 102 }, // 1.015 → 1.02 (correct)
      { price: 1025, rate: 0.10, expected: 102, actual: 103 }, // 1.025 → 1.02 (bug)
      { price: 1035, rate: 0.10, expected: 104, actual: 104 }, // 1.035 → 1.04 (correct)
    ];

    for (const testCase of cases) {
      const tax = calculateTax(testCase.price, testCase.rate);

      // Uncomment to see failures:
      // expect(tax).toBe(testCase.actual); // ❌ Current behavior

      expect(tax).toBe(testCase.expected); // ✅ Expected after fix
    }
  });

  it('uses banker\'s rounding correctly (after fix)', () => {
    // After fix: Should use banker's rounding

    expect(calculateTax(1005, 0.10)).toBe(100); // 1.005 → 1.00 (round to even)
    expect(calculateTax(1015, 0.10)).toBe(102); // 1.015 → 1.02 (round to even)
    expect(calculateTax(1025, 0.10)).toBe(102); // 1.025 → 1.02 (round to even)
    expect(calculateTax(1035, 0.10)).toBe(104); // 1.035 → 1.04 (round to even)
  });
});
```

### Example 2: Race Condition in Cache

```typescript
/**
 * Reproduction harness for: Cache update race condition
 * Issue: #790
 *
 * Bug: Concurrent cache updates can overwrite each other, leading to
 *      stale data being cached
 *
 * Scenario:
 * 1. Request A starts: Fetch from DB, value = 1
 * 2. Request B starts: Fetch from DB, value = 2 (updated in meantime)
 * 3. Request A completes: Write value = 1 to cache
 * 4. Request B completes: Write value = 2 to cache
 * 5. Bug: Cache flip-flops between 1 and 2 based on timing
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CacheManager } from '../src/cache';

describe('Bug #790: Cache update race condition', () => {
  let cache: CacheManager;
  let dbCalls: number;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = new CacheManager();
    dbCalls = 0;
  });

  const mockDb = {
    async getUser(id: string) {
      dbCalls++;
      // Simulate DB query taking time
      await new Promise(resolve => setTimeout(resolve, 10));

      // Return different values based on when called
      return { id, name: `User-${dbCalls}` };
    }
  };

  it('reproduces cache race condition', async () => {
    const userId = 'user-123';

    // Start two concurrent cache reads (both miss)
    const read1 = cache.get(userId, () => mockDb.getUser(userId));
    const read2 = cache.get(userId, () => mockDb.getUser(userId));

    // Advance timers to let both DB queries complete
    jest.advanceTimersByTime(15);

    const [result1, result2] = await Promise.all([read1, read2]);

    // Both queries should return same cached value
    expect(result1.name).toBe(result2.name);

    // Should only query DB once
    expect(dbCalls).toBe(1); // ❌ Bug: called 2x

    // Cache should have stable value
    const cached = cache.peek(userId);
    expect(cached.name).toBe('User-1'); // ❌ Bug: may be 'User-2'
  });

  it('demonstrates timing-dependent cache corruption', async () => {
    const userId = 'user-123';

    // Request 1: Start fetching
    const req1 = cache.get(userId, () => mockDb.getUser(userId));

    // Advance time slightly
    jest.advanceTimersByTime(5);

    // Request 2: Start fetching (before req1 completes)
    const req2 = cache.get(userId, () => mockDb.getUser(userId));

    // Request 1 completes first
    jest.advanceTimersByTime(6);
    await req1;

    // Cache now has "User-1"
    expect(cache.peek(userId).name).toBe('User-1');

    // Request 2 completes later
    jest.advanceTimersByTime(5);
    await req2;

    // Bug: Cache overwritten with "User-2"
    expect(cache.peek(userId).name).toBe('User-1'); // ❌ Fails: 'User-2'
  });

  it('prevents race condition with in-flight tracking (after fix)', async () => {
    // After fix: Should track in-flight requests and dedupe

    const userId = 'user-123';

    const read1 = cache.get(userId, () => mockDb.getUser(userId));
    const read2 = cache.get(userId, () => mockDb.getUser(userId));

    jest.advanceTimersByTime(15);

    await Promise.all([read1, read2]);

    // Should only query DB once (second request waits for first)
    expect(dbCalls).toBe(1); // ✅ Fixed

    // Cache has stable value
    expect(cache.peek(userId).name).toBe('User-1'); // ✅ Fixed
  });
});
```

### Example 3: Memory Leak in WebSocket

```typescript
/**
 * Reproduction harness for: Memory leak in WebSocket connection pool
 * Issue: #791
 *
 * Bug: WebSocket connections are not properly cleaned up when clients
 *      disconnect, leading to memory leak over time
 *
 * Symptom: Memory usage grows linearly with number of connections,
 *          even after clients disconnect
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { WebSocketServer } from '../src/websocket';

describe('Bug #791: WebSocket connection memory leak', () => {
  let server: WebSocketServer;

  beforeEach(() => {
    server = new WebSocketServer();
  });

  it('reproduces memory leak from unclosed connections', () => {
    // Connect 100 clients
    const clients = Array.from({ length: 100 }, (_, i) => {
      return server.connect(`client-${i}`);
    });

    // Verify all connected
    expect(server.getConnectionCount()).toBe(100);

    // Disconnect all clients
    for (const client of clients) {
      client.disconnect();
    }

    // Expected: Connection count drops to 0
    expect(server.getConnectionCount()).toBe(0); // ❌ Bug: still 100

    // Bug: Internal connection map still holds references
    expect(server._connections.size).toBe(0); // ❌ Bug: still 100
  });

  it('demonstrates memory growth over multiple connect/disconnect cycles', () => {
    // Simulate realistic usage: clients connect and disconnect

    const initialMemory = process.memoryUsage().heapUsed;

    // 10 cycles of 1000 connections each
    for (let cycle = 0; cycle < 10; cycle++) {
      const clients = Array.from({ length: 1000 }, (_, i) => {
        return server.connect(`client-${cycle}-${i}`);
      });

      // Disconnect all
      for (const client of clients) {
        client.disconnect();
      }
    }

    // Force garbage collection (if available)
    if (global.gc) global.gc();

    const finalMemory = process.memoryUsage().heapUsed;
    const leaked = finalMemory - initialMemory;

    // Expected: Memory usage should not grow significantly
    expect(leaked).toBeLessThan(10 * 1024 * 1024); // <10 MB

    // Actual: Memory leaked ~100 MB (1000 bytes per connection × 10,000 connections)
    // expect(leaked).toBeGreaterThan(50 * 1024 * 1024); // ❌ Bug: >50 MB leaked
  });

  it('cleans up connections properly (after fix)', () => {
    // After fix: Should remove connections from internal map on disconnect

    const client = server.connect('client-1');
    expect(server.getConnectionCount()).toBe(1);
    expect(server._connections.has('client-1')).toBe(true);

    client.disconnect();

    // Connection removed immediately
    expect(server.getConnectionCount()).toBe(0);
    expect(server._connections.has('client-1')).toBe(false); // ✅ Fixed
  });
});

// Run with: node --expose-gc tests/repro/bug-791-websocket-leak.test.ts
```

### Example 4: Date Parsing Locale Bug

```typescript
/**
 * Reproduction harness for: Date parsing fails in non-US locales
 * Issue: #792
 *
 * Bug: Date parsing assumes US date format (MM/DD/YYYY) and fails
 *      to parse European format (DD/MM/YYYY)
 *
 * Impact: Users in Europe cannot enter birth dates
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { parseUserDate } from '../src/utils/date';

describe('Bug #792: Date parsing locale bug', () => {
  let originalLocale: string;

  beforeEach(() => {
    originalLocale = process.env.LANG || 'en_US';
  });

  afterEach(() => {
    process.env.LANG = originalLocale;
  });

  it('reproduces incorrect parsing in European locale', () => {
    // Simulate European locale (DD/MM/YYYY format)
    process.env.LANG = 'en_GB';

    const input = '15/01/2024'; // January 15, 2024 in DD/MM/YYYY
    const parsed = parseUserDate(input);

    // Expected: January 15, 2024
    expect(parsed.getMonth()).toBe(0); // January (0-indexed)
    expect(parsed.getDate()).toBe(15);

    // Actual: Parsed as MM/DD/YYYY → invalid date (month 15)
    // expect(parsed.getMonth()).toBe(14); // ❌ Bug: out of range
    // expect(parsed.toString()).toBe('Invalid Date'); // ❌ Bug
  });

  it('reproduces for multiple locales', () => {
    const testCases = [
      { locale: 'en_US', input: '01/15/2024', expected: new Date(2024, 0, 15) },
      { locale: 'en_GB', input: '15/01/2024', expected: new Date(2024, 0, 15) },
      { locale: 'de_DE', input: '15.01.2024', expected: new Date(2024, 0, 15) },
      { locale: 'fr_FR', input: '15/01/2024', expected: new Date(2024, 0, 15) },
    ];

    for (const testCase of testCases) {
      process.env.LANG = testCase.locale;

      const parsed = parseUserDate(testCase.input);

      expect(parsed.getTime()).toBe(testCase.expected.getTime()); // ❌ Fails for non-US
    }
  });

  it('accepts ISO 8601 format regardless of locale (after fix)', () => {
    // After fix: Should always accept ISO 8601 format

    const testCases = [
      { locale: 'en_US', input: '2024-01-15' },
      { locale: 'en_GB', input: '2024-01-15' },
      { locale: 'de_DE', input: '2024-01-15' },
    ];

    for (const testCase of testCases) {
      process.env.LANG = testCase.locale;

      const parsed = parseUserDate(testCase.input);

      expect(parsed.getMonth()).toBe(0);
      expect(parsed.getDate()).toBe(15);
      expect(parsed.getFullYear()).toBe(2024);
    }
  });
});
```

### Example 5: Async Initialization Bug

```typescript
/**
 * Reproduction harness for: Database query fails due to early usage
 * Issue: #793
 *
 * Bug: Database connection pool is not initialized before first query,
 *      causing "connection undefined" error
 *
 * Symptom: First API request after server restart fails with error
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Database } from '../src/database';
import { UserService } from '../src/services/user';

describe('Bug #793: Database not initialized before use', () => {
  let db: Database;
  let userService: UserService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reproduces "connection undefined" error', async () => {
    // Create database instance (triggers async initialization)
    db = new Database({
      host: 'localhost',
      port: 5432,
      database: 'test'
    });

    // Create service that depends on database
    userService = new UserService(db);

    // Immediately try to query (before initialization completes)
    const queryPromise = userService.getUser('user-123');

    // Expected: Query waits for initialization
    await expect(queryPromise).resolves.toBeDefined();

    // Actual: Throws "connection undefined"
    // await expect(queryPromise).rejects.toThrow('connection undefined'); // ❌ Bug
  });

  it('demonstrates timing-dependent failure', async () => {
    jest.useFakeTimers();

    // Database initialization takes 100ms
    const mockConnect = jest.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return { connected: true };
    });

    db = new Database({ connect: mockConnect });
    userService = new UserService(db);

    // Query immediately (before 100ms elapsed)
    const queryPromise = userService.getUser('user-123');

    // Don't advance timers - initialization not complete

    // Expected: Query waits for initialization
    // Actual: Throws immediately
    await expect(queryPromise).rejects.toThrow(); // ❌ Bug
  });

  it('waits for initialization before queries (after fix)', async () => {
    // After fix: Database should queue queries until initialized

    db = new Database({
      host: 'localhost',
      port: 5432,
      database: 'test'
    });

    userService = new UserService(db);

    // Query immediately - should wait for initialization
    const user = await userService.getUser('user-123');

    expect(user).toBeDefined(); // ✅ Fixed
  });

  it('provides explicit initialization method (after fix)', async () => {
    // After fix: Expose initialize() method for explicit control

    db = new Database({
      host: 'localhost',
      port: 5432,
      database: 'test'
    });

    // Explicitly wait for initialization
    await db.initialize();

    // Now safe to use
    userService = new UserService(db);
    const user = await userService.getUser('user-123');

    expect(user).toBeDefined(); // ✅ Fixed
  });
});
```

## Summary

A good reproduction harness:

1. **Reproduces reliably** (100% of the time)
2. **Minimal code** (only what's needed)
3. **Deterministic** (no randomness or timing issues)
4. **Fast** (<1 second if possible)
5. **Well-documented** (explains expected vs actual)
6. **Becomes regression test** (prevents future bugs)

**Anti-patterns to avoid:**
- Flaky tests that pass sometimes
- Overly complex setup
- Depends on external services
- Non-deterministic timing
- Unclear what's being tested

**After creating harness:**
1. Verify it reproduces bug reliably
2. Fix the bug
3. Verify test now passes
4. Move to regression test suite
5. Ensure CI runs test on every commit

**The goal:** Make the bug impossible to miss, and impossible to regress.
