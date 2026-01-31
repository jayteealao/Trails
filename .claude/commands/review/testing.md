---
name: review:testing
user-invocable: false
disable-model-invocation: true
description: Review test quality, coverage, and reliability to ensure changes are well-verified
args:
  SESSION_SLUG:
    description: The session identifier. If not provided, uses the most recent session from .claude/README.md
    required: false
  SCOPE:
    description: What to review
    required: false
    choices: [pr, worktree, diff, file, repo]
  TARGET:
    description: Specific target to review
    required: false
  PATHS:
    description: Optional file path globs to focus review (e.g., "src/**/*.test.ts")
    required: false
---

# ROLE
You are a test-quality reviewer. Your goal is to ensure the change is reliably verified, with tests that assert behavior (not implementation) and minimize flakiness.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes `file:line-range` + test code snippet
2. **Show the gap**: Identify untested behavior with concrete example input/scenario
3. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
4. **Suggest test cases**: Provide example test for missing coverage
5. **Flakiness evidence**: Show specific race condition or non-determinism

# PRIMARY QUESTIONS

1. What behavior changed? Is it tested?
2. Are tests asserting behavior (outputs) or implementation (internals)?
3. Can tests fail spuriously (flakiness)?
4. Are tests at the right level (unit/integration/e2e)?
5. Are tests readable and maintainable?

# TESTING CHECKLIST

## 1. Coverage of New/Changed Behavior
- **Happy path**: Normal, expected inputs and flow
- **Error path**: Invalid inputs, exceptions, failures
- **Edge cases**: Empty collections, null, undefined, max sizes
- **Boundary values**: Min/max, zero, negative, overflow
- **State transitions**: All valid and invalid state changes
- **Concurrency**: Race conditions, parallel execution

## 2. Correct Test Level
- **Unit tests**: Pure logic, no I/O, fast (<100ms)
- **Integration tests**: DB, filesystem, network, slower (<5s)
- **E2E tests**: Critical user workflows, slowest (<30s)
- **Wrong level**: Unit test doing DB calls, E2E test for pure logic

## 3. Test Brittleness
- **Over-mocking**: Mocking everything, testing mocks not real behavior
- **Implementation coupling**: Asserting internal method calls
- **Snapshot misuse**: Overly broad snapshots, unmaintainable
- **Tight coupling**: Tests break on refactors that don't change behavior

## 4. Flakiness Sources
- **Time-based**: `sleep()`, `setTimeout()`, `Date.now()` without mocking
- **Race conditions**: Async tests without proper synchronization
- **Ordering assumptions**: Tests depend on execution order
- **External state**: Tests depend on DB state, file system, network
- **Randomness**: `Math.random()`, UUIDs without seeding
- **Resource leaks**: Unclosed connections, timers

## 5. Determinism
- **Fixed clocks**: Mock `Date.now()`, use fake timers
- **Seeded randomness**: Mock `Math.random()` or use fixed seed
- **Stable ordering**: Sort arrays, use ordered collections
- **Isolated state**: Each test starts with clean state
- **Idempotency**: Tests can run in any order, multiple times

## 6. Fixtures and Test Data
- **Heavy fixtures**: Loading entire DB, slow setup
- **Shared mutable fixtures**: Tests modify shared data, cause interference
- **Unclear factories**: `createUser()` vs `createValidUser()` ambiguity
- **Magic values**: Unclear why specific values chosen
- **Test data quality**: Realistic vs minimal

## 7. Assertions
- **Meaningful**: Specific expectations, not `assert(true)` or `assert(result)`
- **Precise**: Check exact values, not just existence
- **Error messages**: Clear failure messages
- **Over-assertion**: Checking too many fields, brittle
- **Under-assertion**: Not checking critical fields

## 8. Test Organization
- **Naming**: Descriptive test names (behavior, not implementation)
- **Structure**: Arrange-Act-Assert (Given-When-Then)
- **Focus**: One behavior per test
- **Duplication**: Repeated setup, should use helper functions
- **Readability**: Clear intent, not cryptic

## 9. Error Testing
- **Exception testing**: Verify correct errors thrown
- **Error messages**: Check error message content
- **Error types**: Check specific error types (ValidationError, NotFoundError)
- **Error context**: Verify error includes useful context
- **Partial failures**: Test error handling in multi-step operations

## 10. Performance/Resource Testing
- **Memory leaks**: Resource cleanup tested
- **Timeouts**: Operations complete within expected time
- **Resource limits**: Handle max file size, max requests, etc.
- **Cleanup**: Teardown removes test artifacts

# WORKFLOW

## Step 0: Infer SESSION_SLUG if not provided

Standard session inference from `.claude/README.md` (last entry).

## Step 1: Load session context

1. Validate `.claude/<SESSION_SLUG>/` exists
2. Read `.claude/<SESSION_SLUG>/README.md` for context
3. Check spec for acceptance criteria (what should be tested)
4. Check plan for test strategy
5. Check work log for what was implemented

## Step 2: Determine review scope

From SCOPE, TARGET, PATHS, and session context:

1. **SCOPE** (if not provided)
   - If work log exists: use most recent work scope
   - Default to `worktree`

2. **TARGET** (if not provided)
   - If SCOPE is `pr`: need PR URL
   - If SCOPE is `diff`: need commit range
   - If SCOPE is `file`: need file path
   - If SCOPE is `worktree`: use `HEAD`
   - If SCOPE is `repo`: use `.`

3. **PATHS** (if not provided)
   - Review all changed files and their tests
   - Can be narrowed with globs

4. **CONTEXT** (if not provided)
   - Extract test strategy from plan
   - Look for CI config (GitHub Actions, etc.)
   - Check for test framework config (Jest, pytest, etc.)

## Step 3: Gather changed files and tests

Based on SCOPE:
- For `pr`: Get diff from PR
- For `worktree`: Get git diff HEAD
- For `diff`: Get git diff for range
- For `file`: Read specific file(s) and test files
- For `repo`: Scan recent changes

Use Bash + Git commands to get:
- List of changed source files
- List of changed test files
- New source files without tests
- Modified source files with/without test changes

## Step 4: Identify what behavior changed

For each changed file:

1. **Read the changes**:
   - New functions/methods added
   - Existing functions/methods modified
   - Changed error handling
   - Changed validation logic
   - Changed state transitions

2. **Identify testable behavior**:
   - Public API changes (functions, classes, endpoints)
   - Error conditions (new exceptions, validations)
   - Edge cases (boundary values, empty inputs)
   - State changes (DB writes, file writes)

3. **Extract acceptance criteria** (if spec exists):
   - What should the code do?
   - What inputs should it accept?
   - What errors should it handle?
   - What edge cases should it cover?

## Step 5: Find corresponding tests

For each changed source file:

1. **Locate test files**:
   - Common patterns: `*.test.ts`, `*_test.py`, `*_spec.rb`
   - Co-located: `src/foo.ts` → `src/foo.test.ts`
   - Separate: `src/foo.ts` → `tests/foo.test.ts`

2. **Read test files**:
   - What behaviors are tested?
   - What test level (unit/integration/e2e)?
   - What assertions are made?

3. **Map tests to behavior**:
   - Which behaviors have tests?
   - Which behaviors lack tests?
   - Which tests cover changed code?

## Step 6: Assess coverage gaps

For each testable behavior:

1. **Happy path coverage**:
   - Is normal operation tested?
   - Are typical inputs covered?

2. **Error path coverage**:
   - Are error conditions tested?
   - Are validation failures tested?

3. **Edge case coverage**:
   - Empty inputs ([], "", null, undefined)?
   - Boundary values (0, -1, MAX_INT)?
   - Large inputs (max size, overflow)?

4. **State transition coverage**:
   - Are all valid transitions tested?
   - Are invalid transitions tested?

**Prioritize by risk:**
- BLOCKER: No tests for critical functionality (auth, payments, data loss)
- HIGH: No tests for common error paths
- MED: No tests for edge cases
- LOW: Incomplete boundary value testing

## Step 7: Assess test quality

For each existing test:

1. **Test level appropriateness**:
   - Unit test doing DB calls? (should be integration)
   - E2E test for pure function? (should be unit)

2. **Brittleness check**:
   - Mocking internal implementation details?
   - Asserting method calls instead of outputs?
   - Snapshots that include irrelevant fields?

3. **Flakiness check**:
   - `sleep()` or `setTimeout()` without mocking?
   - Async tests without proper `await`?
   - Date/time usage without mocking?
   - Randomness without seeding?

4. **Determinism check**:
   - Tests create unique data (avoid conflicts)?
   - Tests clean up after themselves?
   - Tests independent of execution order?

5. **Assertion quality**:
   - Specific assertions (`expect(x).toBe(5)`)?
   - Or vague (`expect(x).toBeTruthy()`)?
   - Meaningful error messages?

## Step 8: Run tests (if possible)

If in CI or local environment:

1. **Run test suite**:
   ```bash
   npm test  # or pytest, cargo test, etc.
   ```

2. **Check for flakiness**:
   ```bash
   # Run tests 10 times
   for i in {1..10}; do npm test || echo "Failed on run $i"; done
   ```

3. **Check coverage**:
   ```bash
   npm test -- --coverage
   # or pytest --cov
   ```

4. **Identify flaky tests**:
   - Tests that fail intermittently
   - Tests that fail in CI but pass locally
   - Tests with timing issues

## Step 9: Generate findings

For each gap or quality issue:

1. **Severity**:
   - BLOCKER: No tests for critical data mutation (auth, payments)
   - HIGH: No tests for public API or common error paths
   - MED: Missing edge cases or brittle tests
   - LOW: Minor coverage gaps or test improvements
   - NIT: Test naming, organization

2. **Confidence**:
   - High: Clear untested behavior or obvious flakiness
   - Med: Likely issue but might be tested elsewhere
   - Low: Speculative concern

3. **Evidence**:
   - File:line showing untested code
   - Code snippet showing what's not tested
   - Concrete scenario that lacks coverage

4. **Suggested test**:
   - Example test case filling the gap
   - Specific assertions needed

## Step 10: Generate review report

Create `.claude/<SESSION_SLUG>/reviews/review-testing-{YYYY-MM-DD}.md`

## Step 11: Update session README

Standard artifact tracking update.

## Step 12: Output summary

Print summary with coverage gaps and critical issues.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-testing-{YYYY-MM-DD}.md`:

```markdown
---
command: /review:testing
session_slug: {SESSION_SLUG}
date: {YYYY-MM-DD}
scope: {SCOPE}
target: {TARGET}
paths: {PATHS}
related:
  session: ../README.md
  spec: ../spec/spec-crystallize.md (if exists)
  plan: ../plan/research-plan*.md (if exists)
  work: ../work/work*.md (if exists)
---

# Testing Review Report

**Reviewed:** {SCOPE} / {TARGET}
**Date:** {YYYY-MM-DD}
**Reviewer:** Claude Code

---

## 0) Scope, Test Strategy, and Context

**What was reviewed:**
- Scope: {SCOPE}
- Target: {TARGET}
- Files changed: {count} source files, {count} test files
- Lines changed: +{added} -{removed} (source), +{added} -{removed} (tests)
{If PATHS provided:}
- Focus: {PATHS}

**Test strategy:**
{From CONTEXT, plan, or inferred}
- Test levels: {unit / integration / e2e}
- Test framework: {Jest, pytest, etc.}
- Coverage target: {X}%
- CI environment: {GitHub Actions, etc.}

**Changed behavior:**
{List of functions/features changed}
1. `uploadFile()` - Added file size validation
2. `processRows()` - Changed error handling
3. `createUser()` - Added duplicate detection

**Acceptance criteria:**
{From spec, if exists}
1. Files larger than 10MB should be rejected
2. Invalid rows should throw ValidationError
3. Duplicate emails should return existing user

---

## 1) Executive Summary

**Merge Recommendation:** {APPROVE | APPROVE_WITH_COMMENTS | REQUEST_CHANGES | BLOCK}

**Rationale:**
{2-3 sentences explaining recommendation}

**Test Coverage:** {75}% of changed lines (baseline: {80}%)

**Critical Gaps:**
1. **{Finding ID}**: {Untested behavior} - No test for {scenario}
2. **{Finding ID}**: {Untested behavior} - No test for {scenario}
3. **{Finding ID}**: {Untested behavior} - No test for {scenario}

**Overall Assessment:**
- Coverage: {Good | Acceptable | Insufficient | Missing}
- Test Quality: {High | Good | Brittle | Poor}
- Flakiness Risk: {Low | Medium | High | Severe}
- Determinism: {Excellent | Good | Issues | Broken}

---

## 2) Coverage Analysis

### Changed Behavior Coverage

| Behavior | File:Line | Tested? | Test Level | Coverage |
|----------|-----------|---------|------------|----------|
| File size validation | `upload.ts:45` | ✅ Yes | Unit | Happy + Error + Edge |
| Invalid row handling | `parser.ts:60` | ⚠️ Partial | Unit | Happy + Error (missing edge) |
| Duplicate user check | `user.ts:120` | ❌ No | - | No tests |
| Email sending | `notify.ts:30` | ✅ Yes | Integration | Happy path only |

**Coverage Summary:**
- ✅ Fully tested: {2} behaviors
- ⚠️ Partially tested: {1} behavior
- ❌ Not tested: {1} behavior

### Test Level Distribution

| Level | Tests | % of Total | Appropriate? |
|-------|-------|------------|--------------|
| Unit | 15 | 75% | ✅ Good ratio |
| Integration | 4 | 20% | ✅ Good ratio |
| E2E | 1 | 5% | ✅ Good ratio |

**Expected distribution:**
- Unit: 70-80% ✅
- Integration: 15-25% ✅
- E2E: 5-10% ✅

---

## 3) Findings Table

| ID | Severity | Confidence | Category | File:Line | Issue |
|----|----------|------------|----------|-----------|-------|
| TS-1 | HIGH | High | Coverage Gap | `user.ts:120` | No tests for duplicate user logic |
| TS-2 | MED | High | Edge Case | `parser.ts:60` | Empty input not tested |
| TS-3 | MED | Med | Flakiness | `upload.test.ts:30` | setTimeout without mock |
| TS-4 | LOW | High | Brittleness | `routes.test.ts:50` | Over-mocking |

**Findings Summary:**
- BLOCKER: {count}
- HIGH: {count}
- MED: {count}
- LOW: {count}
- NIT: {count}

**Category Breakdown:**
- Coverage gaps: {count}
- Flakiness: {count}
- Brittleness: {count}
- Wrong test level: {count}
- Assertion quality: {count}

---

## 4) Findings (Detailed)

### TS-1: No Tests for Duplicate User Detection [HIGH]

**Location:** `src/services/user.ts:120-140`

**Untested Behavior:**
```typescript
// Lines 120-140 - NO TESTS FOR THIS
async function createUser(email: string, name: string): Promise<User> {
  // ❌ This duplicate check has no tests
  const existing = await db.users.findByEmail(email);
  if (existing) {
    return existing; // Return existing user
  }

  const user = await db.users.insert({ email, name });
  return user;
}
```

**What's missing:**
No tests verify:
1. **Duplicate detection**: Calling `createUser()` twice with same email returns same user
2. **Idempotency**: Multiple calls don't create duplicates
3. **Error vs return**: Returns existing user (doesn't throw error)

**Why it matters:**
- Critical for data integrity (no duplicate users)
- Idempotency requirement from spec
- Common error path (users will retry on network failures)

**Scenarios not tested:**
1. Create user with email that already exists → should return existing
2. Concurrent calls with same email → should handle race condition
3. Case sensitivity: "User@Example.com" vs "user@example.com"

**Severity:** HIGH
**Confidence:** High
**Category:** Coverage Gap (Error Path)

**Impact:**
- Risk of duplicate users in production
- Retry failures will confuse users
- No confidence in idempotency guarantee

**Suggested Test:**
```typescript
describe('createUser', () => {
  test('returns existing user when email already exists', async () => {
    // Arrange: Create user first time
    const user1 = await createUser('user@example.com', 'Alice');

    // Act: Try to create again with same email
    const user2 = await createUser('user@example.com', 'Alice');

    // Assert: Same user returned
    expect(user2.id).toBe(user1.id);
    expect(user2.email).toBe('user@example.com');

    // Assert: No duplicate in DB
    const allUsers = await db.users.findAll();
    const duplicates = allUsers.filter(u => u.email === 'user@example.com');
    expect(duplicates).toHaveLength(1);
  });

  test('is idempotent - multiple calls create one user', async () => {
    // Act: Call multiple times
    const results = await Promise.all([
      createUser('user@example.com', 'Alice'),
      createUser('user@example.com', 'Alice'),
      createUser('user@example.com', 'Alice'),
    ]);

    // Assert: All return same user
    const ids = results.map(u => u.id);
    expect(new Set(ids).size).toBe(1);
  });

  test('handles case-insensitive email duplicates', async () => {
    const user1 = await createUser('User@Example.com', 'Alice');
    const user2 = await createUser('user@example.com', 'Alice');

    expect(user2.id).toBe(user1.id);
  });
});
```

**Test level:** Integration (requires real DB)

---

### TS-2: Empty Input Edge Case Not Tested [MED]

**Location:** `src/lib/parser.ts:60-70`

**Partially tested behavior:**
```typescript
// Lines 60-70
function parseRows(csv: string): Row[] {
  if (!csv || csv.trim().length === 0) {
    return []; // ❌ This edge case not tested
  }

  const lines = csv.split('\n');
  // ... rest of parsing
}
```

**Existing tests:**
```typescript
// tests/parser.test.ts - What IS tested
test('parses valid CSV', () => {
  const result = parseRows('name,email\nAlice,alice@example.com');
  expect(result).toHaveLength(1);
}); // ✅ Happy path covered

test('throws on invalid format', () => {
  expect(() => parseRows('invalid')).toThrow();
}); // ✅ Error path covered
```

**What's missing:**
Edge cases not tested:
1. Empty string: `parseRows('')`
2. Whitespace only: `parseRows('   ')`
3. Newlines only: `parseRows('\n\n\n')`

**Why it matters:**
- Users might upload empty files
- Should return `[]` not crash
- Edge case mentioned in spec

**Severity:** MED
**Confidence:** High
**Category:** Coverage Gap (Edge Case)

**Suggested Test:**
```typescript
describe('parseRows - edge cases', () => {
  test('returns empty array for empty string', () => {
    expect(parseRows('')).toEqual([]);
  });

  test('returns empty array for whitespace only', () => {
    expect(parseRows('   ')).toEqual([]);
    expect(parseRows('\t\t')).toEqual([]);
  });

  test('returns empty array for newlines only', () => {
    expect(parseRows('\n\n\n')).toEqual([]);
  });
});
```

**Test level:** Unit (pure function, no I/O)

---

### TS-3: Test Uses setTimeout Without Mocking (Flakiness Risk) [MED]

**Location:** `tests/upload.test.ts:30-45`

**Flaky test code:**
```typescript
// Lines 30-45
test('processes file asynchronously', async () => {
  const file = new File(['data'], 'test.csv');
  const promise = processFile(file);

  // ❌ FLAKY: Real delay, not deterministic
  await new Promise(resolve => setTimeout(resolve, 100));

  const status = await getProcessingStatus();
  expect(status).toBe('processing');

  // ❌ FLAKY: Assumes processing completes within 500ms
  await new Promise(resolve => setTimeout(resolve, 500));

  const result = await promise;
  expect(result.success).toBe(true);
});
```

**Flakiness sources:**
1. **Race condition**: Assumes processing starts within 100ms
2. **Timing assumption**: Assumes processing completes within 500ms
3. **Non-deterministic**: Will fail on slow CI runners
4. **No timeout**: Could hang indefinitely

**Why it's flaky:**
- CI runners are slower than local machines
- Load spikes can delay execution
- Different environments have different timing

**Evidence of flakiness:**
- Test might pass locally, fail in CI
- Intermittent failures ("works on my machine")
- Timing-dependent logic

**Severity:** MED
**Confidence:** Med (might work with current timing, but fragile)
**Category:** Flakiness (Time-based)

**Impact:**
- Intermittent CI failures
- False negatives (test passes when code broken)
- False positives (test fails when code works)
- Developer frustration

**Fix:**
Use fake timers and proper async synchronization:

```diff
--- a/tests/upload.test.ts
+++ b/tests/upload.test.ts
@@ -28,16 +28,22 @@

-test('processes file asynchronously', async () => {
+test('processes file asynchronously', async () => {
+  jest.useFakeTimers();
+
   const file = new File(['data'], 'test.csv');
   const promise = processFile(file);

-  await new Promise(resolve => setTimeout(resolve, 100));
+  // Fast-forward time instead of waiting
+  jest.advanceTimersByTime(100);
+  await Promise.resolve(); // Flush promises

   const status = await getProcessingStatus();
   expect(status).toBe('processing');

-  await new Promise(resolve => setTimeout(resolve, 500));
+  // Fast-forward to completion
+  jest.advanceTimersByTime(500);

   const result = await promise;
   expect(result.success).toBe(true);
+
+  jest.useRealTimers();
 });
```

**Better approach:** Use event-based synchronization:
```typescript
test('processes file asynchronously', async () => {
  const file = new File(['data'], 'test.csv');

  // Wait for actual completion, not arbitrary timeout
  const result = await processFile(file);

  expect(result.success).toBe(true);
  expect(result.status).toBe('completed');
});
```

---

### TS-4: Over-Mocking Leads to Brittle Tests [LOW]

**Location:** `tests/routes.test.ts:50-80`

**Brittle test code:**
```typescript
// Lines 50-80
test('upload endpoint calls correct methods', async () => {
  const mockParse = jest.fn().mockReturnValue([]);
  const mockValidate = jest.fn().mockReturnValue(true);
  const mockSave = jest.fn().mockResolvedValue({ success: true });

  // ❌ Mocking everything, testing mock interactions
  jest.mock('../lib/parser', () => ({ parse: mockParse }));
  jest.mock('../lib/validator', () => ({ validate: mockValidate }));
  jest.mock('../db', () => ({ save: mockSave }));

  const response = await request(app)
    .post('/upload')
    .attach('file', 'test.csv');

  // ❌ Asserting implementation details (method calls)
  expect(mockParse).toHaveBeenCalledWith(expect.any(String));
  expect(mockValidate).toHaveBeenCalledWith(expect.any(Array));
  expect(mockSave).toHaveBeenCalledWith(expect.any(Array));

  // ✅ This is the only useful assertion
  expect(response.status).toBe(200);
});
```

**Problems:**
1. **Over-mocking**: Mocks parse, validate, AND save (all implementation)
2. **Testing mocks**: Asserts mock calls, not actual behavior
3. **Brittle**: Refactoring breaks test even if behavior unchanged
4. **False confidence**: Test passes but actual behavior might be broken

**Example brittleness:**
```typescript
// If we refactor to combine parse + validate:
function parseAndValidate(data) {
  const rows = parse(data);
  validate(rows);
  return rows;
}

// ❌ Test breaks even though behavior unchanged!
// mockParse is called from parseAndValidate, not from route
```

**Why it matters:**
- Tests should verify behavior, not implementation
- Refactors should be safe if behavior preserved
- False confidence in test coverage

**Severity:** LOW (test does catch some issues)
**Confidence:** High
**Category:** Brittleness (Over-mocking)

**Fix:**
Test behavior with minimal mocking:

```diff
--- a/tests/routes.test.ts
+++ b/tests/routes.test.ts
@@ -48,24 +48,25 @@

-test('upload endpoint calls correct methods', async () => {
-  const mockParse = jest.fn().mockReturnValue([]);
-  const mockValidate = jest.fn().mockReturnValue(true);
-  const mockSave = jest.fn().mockResolvedValue({ success: true });
-
-  jest.mock('../lib/parser', () => ({ parse: mockParse }));
-  jest.mock('../lib/validator', () => ({ validate: mockValidate }));
-  jest.mock('../db', () => ({ save: mockSave }));
+test('upload endpoint successfully processes valid CSV', async () => {
+  // Only mock external boundary (DB)
+  const mockDb = createMockDb();

   const response = await request(app)
     .post('/upload')
-    .attach('file', 'test.csv');
+    .attach('file', Buffer.from('name,email\nAlice,alice@example.com'));

-  expect(mockParse).toHaveBeenCalledWith(expect.any(String));
-  expect(mockValidate).toHaveBeenCalledWith(expect.any(Array));
-  expect(mockSave).toHaveBeenCalledWith(expect.any(Array));
+  // Assert behavior (output), not implementation (method calls)
   expect(response.status).toBe(200);
+  expect(response.body.success).toBe(true);
+  expect(response.body.count).toBe(1);
+
+  // Assert side effect (DB contains data)
+  const users = await mockDb.users.findAll();
+  expect(users).toHaveLength(1);
+  expect(users[0].email).toBe('alice@example.com');
 });
```

**Principle:** Mock boundaries (DB, network), not internal logic.

---

## 5) Coverage Gaps Summary

### Critical Gaps (HIGH+)

**Untested behaviors:**
1. **Duplicate user detection** (TS-1)
   - Scenario: Call `createUser()` twice with same email
   - Expected: Return existing user
   - Risk: Data duplication

### Important Gaps (MED)

**Partially tested behaviors:**
2. **Empty input handling** (TS-2)
   - Scenario: Empty string, whitespace only
   - Expected: Return empty array
   - Risk: Crash on empty file upload

### Edge Cases (LOW)

**Missing boundary tests:**
- Max file size (10MB limit)
- Special characters in names
- Very long email addresses

---

## 6) Test Quality Issues

### Flakiness (Risk: Medium)

**Identified flaky tests:**
1. **TS-3**: `upload.test.ts:30` - setTimeout without mocking

**Flakiness prevention needed:**
- Mock `Date.now()` and timers
- Use event-based synchronization
- Seed random generators

### Brittleness (Risk: Low)

**Brittle tests:**
1. **TS-4**: `routes.test.ts:50` - Over-mocking

**Brittleness prevention:**
- Mock boundaries, not internals
- Assert outputs, not method calls
- Use integration tests for workflows

### Determinism (Status: Good)

✅ **Good practices found:**
- Tests clean up DB state
- Tests use unique data (UUIDs)
- No shared mutable fixtures

---

## 7) Test Level Assessment

### Correctly Leveled Tests

✅ **Unit tests** (15 tests):
- `parser.test.ts`: Pure functions, no I/O
- `validator.test.ts`: Pure validation logic
- Fast (<100ms per test)

✅ **Integration tests** (4 tests):
- `user.test.ts`: Tests with real DB
- `email.test.ts`: Tests with mocked SMTP
- Slower (<5s per test)

✅ **E2E tests** (1 test):
- `upload-workflow.test.ts`: Full user workflow
- Slowest (<30s)

### Incorrectly Leveled Tests

⚠️ **Unit test doing DB calls:**
- `validator.test.ts:80` - Calls DB to check email uniqueness
- Should be integration test or mock DB

---

## 8) Positive Observations

Things done well (for balance):

✅ **Good test organization:** Clear test structure with describe/test blocks
✅ **Descriptive test names:** Test names explain behavior being verified
✅ **Arrange-Act-Assert:** Tests follow clear structure
✅ **Good assertions:** Specific expectations, not vague
✅ **Error testing:** Error paths are tested for most functions
✅ **Test data factories:** Clear `createUser()` helper functions

---

## 9) Recommendations

### Must Fix (BLOCKER/HIGH)

1. **TS-1**: Add tests for duplicate user detection
   - Action: Add suggested test cases
   - Rationale: Critical for data integrity
   - Estimated effort: 15 minutes

### Should Fix (MED)

2. **TS-2**: Add edge case tests for empty input
   - Action: Add suggested test cases
   - Rationale: Prevents crashes on empty files
   - Estimated effort: 5 minutes

3. **TS-3**: Fix flaky test (setTimeout)
   - Action: Use fake timers or event-based sync
   - Rationale: Prevents intermittent CI failures
   - Estimated effort: 10 minutes

### Consider (LOW/NIT)

4. **TS-4**: Reduce mocking in integration tests
   - Action: Mock boundaries only
   - Rationale: More realistic, less brittle
   - Estimated effort: 15 minutes

### Long-term

5. **Add coverage tracking** to CI
6. **Run tests multiple times** to detect flakiness
7. **Document test strategy** in CONTRIBUTING.md

---

## 10) Coverage Metrics

{If coverage tool available:}

**Line coverage:** {75}% (target: {80}%)
**Branch coverage:** {70}% (target: {75}%)
**Function coverage:** {85}% (target: {90}%)

**Uncovered lines:**
- `src/services/user.ts:125-130` (duplicate detection)
- `src/lib/parser.ts:62-65` (empty input handling)

**Uncovered branches:**
- `src/upload/handler.ts:45` (error path for max file size)

---

## 11) CI/Runtime Considerations

**Test runtime:**
- Total: {45}s (target: <60s)
- Unit: {5}s (15 tests @ ~300ms avg)
- Integration: {15}s (4 tests @ ~4s avg)
- E2E: {25}s (1 test)

**CI environment:**
- Platform: GitHub Actions
- Node version: 18.x
- Parallel execution: Yes (jest --maxWorkers=2)

**Recommendations:**
- ✅ Fast unit tests
- ✅ Reasonable integration test time
- ⚠️ E2E test is slow (25s), consider splitting

---

## 12) False Positives & Disagreements Welcome

**Where I might be wrong:**

1. **TS-1 (missing tests)**: If duplicate detection is tested in integration test suite I didn't see, severity is lower
2. **TS-3 (flakiness)**: If timeouts are generous enough for CI, might not be flaky in practice
3. **TS-4 (over-mocking)**: If rapid refactoring is expected, mocking internals might be pragmatic trade-off

**How to override my findings:**
- Show test coverage I missed (different test file)
- Explain why behavior doesn't need testing (e.g., trivial getter)
- Provide evidence test isn't flaky (CI history)

I'm optimizing for test reliability and coverage. If there's a good reason for gaps, let's discuss!

---

*Review completed: {YYYY-MM-DD}*
*Session: [{SESSION_SLUG}](../README.md)*
```

# SUMMARY OUTPUT

After creating review, print:

```markdown
# Testing Review Complete

## Review Location
Saved to: `.claude/{SESSION_SLUG}/reviews/review-testing-{YYYY-MM-DD}.md`

## Merge Recommendation
**{APPROVE | APPROVE_WITH_COMMENTS | REQUEST_CHANGES | BLOCK}**

## Test Coverage
**{75}%** of changed lines (baseline: {80}%)

## Critical Gaps
1. **{Finding ID}**: {Untested behavior} - {Scenario}
2. **{Finding ID}**: {Untested behavior} - {Scenario}
3. **{Finding ID}**: {Untested behavior} - {Scenario}

## Statistics
- Files changed: {X} source, {Y} test files
- Lines changed: +{X} source, +{Y} test
- Findings: BLOCKER: {X}, HIGH: {X}, MED: {X}, LOW: {X}, NIT: {X}
- Coverage: {X}% line, {Y}% branch, {Z}% function
- Flakiness risk: {Low | Medium | High}

## Coverage Breakdown
- ✅ Fully tested: {X} behaviors
- ⚠️ Partially tested: {Y} behaviors
- ❌ Not tested: {Z} behaviors

## Test Quality
- Flaky tests: {count}
- Brittle tests: {count}
- Wrong level: {count}

## Quick Actions
{If HIGH+ gaps exist:}
Add missing test cases from findings: TS-1, TS-2
Estimated time: {X} minutes

Fix flaky tests: TS-3
Estimated time: {X} minutes

**Total effort for HIGH+MED fixes:** {X} minutes

{If no HIGH findings:}
Minor coverage gaps, OK to merge with comments.

## Next Steps
{If REQUEST_CHANGES:}
1. Add tests for critical gaps (TS-1)
2. Fix flaky tests (TS-3)
3. Re-run test suite
4. Verify coverage improved

{If APPROVE_WITH_COMMENTS:}
1. Consider adding edge case tests (TS-2)
2. Consider fixing brittle tests (TS-4)
3. OK to merge as-is

## Suggested Test Cases
{List of concrete test cases to add, copy-pasteable}
```

# IMPORTANT: Concrete, Actionable Feedback

This review should provide:
- **Concrete scenarios**: Exact inputs that lack test coverage
- **Example tests**: Copy-pasteable test cases
- **Evidence of flakiness**: Specific race conditions or timing issues
- **Actionable fixes**: Exact changes to improve tests
- **Risk assessment**: Prioritize by criticality of untested code

The goal is reliable test coverage that catches bugs without flakiness.

# WHEN TO USE

Run `/review:testing` when:
- Before merging features (verify tests exist)
- After bug fixes (ensure regression tests added)
- When CI is flaky (identify flakiness sources)
- During test refactors (verify improvement)

This should be in the default review chain for all work types.
