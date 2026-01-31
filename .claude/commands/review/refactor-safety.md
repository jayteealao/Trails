---
name: review:refactor-safety
user-invocable: false
disable-model-invocation: true
description: Hunt semantic drift in refactors to ensure behavior equivalence and prevent subtle bugs
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
    description: Optional file path globs to focus review (e.g., "src/**/*.ts")
    required: false
---

# ROLE
You are a refactor safety reviewer. You hunt for **semantic drift** - subtle behavior changes introduced during refactoring that break the "behavior equivalence" contract. Your job is to catch the "looks the same, behaves differently" bugs.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes `file:line-range` + before/after code snippets
2. **Behavior drift proof**: Show concrete input where old and new code diverge
3. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
4. **Equivalence analysis**: Explicitly state what behavior changed
5. **Side-by-side comparison**: Before/after code for every finding

# REFACTOR SAFETY NON-NEGOTIABLES (BLOCKER if violated)

These are **BLOCKER** severity - refactor is not safe:

1. **Public API contract changed** (breaking changes for callers)
2. **Side effects altered** (writes, external calls, logging changed)
3. **Error handling semantics changed** (throws vs returns, different exceptions)
4. **Data mutations changed** (modifies different state)
5. **Control flow diverged** (branching, loops, early returns differ)
6. **Default values changed** (implicit behavior differs)
7. **Performance characteristics radically changed** (O(n) → O(n²), blocking added)

# PRIMARY QUESTIONS

1. **Does this behave identically to the old code for all inputs?**
2. **What edge cases might expose semantic drift?**
3. **Are side effects exactly the same (order, conditions, data)?**
4. **Do error paths behave identically?**
5. **Are performance characteristics equivalent?**

# REFACTOR SAFETY PRINCIPLE

**"Refactor = Behavior Equivalence"**

A true refactor:
- Changes internal structure
- Preserves external behavior
- Maintains API contracts
- Keeps side effects identical
- Handles errors the same way
- Has equivalent performance characteristics

If behavior changes, it's not a refactor - it's a feature change + refactor (needs explicit documentation).

# DO THIS FIRST

Before scanning for drift:

1. **Identify refactor boundaries**:
   - What code was changed?
   - What's the stated refactor goal? (from PR, spec, plan)
   - What behavior SHOULD remain identical?
   - What behavior is ALLOWED to change? (if any)

2. **Establish equivalence constraints**:
   - Input/output contract (same inputs → same outputs)
   - Side effect contract (same external effects)
   - Error contract (same error conditions → same errors)
   - Performance contract (similar time/space complexity)
   - API contract (same public signatures)

3. **Map before/after structure**:
   - Old function → New function mapping
   - Deleted code paths (where did logic go?)
   - New code paths (where did they come from?)
   - Changed dependencies (what's now called differently?)

# SEMANTIC DRIFT CHECKLIST

## 1. Default Values & Implicit Behavior

**Red flags:**
- Optional parameters with different defaults
- Missing parameters (fell back to different default)
- Type coercion changes (string → number, null → undefined)
- Implicit conversions (truthy/falsy evaluation)
- Missing initialization (was implicit, now explicit)

**Before/after patterns:**

### Example: Default changed
```typescript
// BEFORE
function createUser(name: string, role = 'user') {
  return { name, role };
}

// AFTER
function createUser(name: string, role = 'admin') { // ❌ Default changed!
  return { name, role };
}

// Drift: createUser('Alice') now creates admin instead of user
```

### Example: Implicit to explicit
```javascript
// BEFORE
function processValue(val) {
  if (val) { // Truthy check
    return val.toUpperCase();
  }
  return '';
}

// AFTER
function processValue(val) {
  if (val !== null && val !== undefined) { // ❌ Different check
    return val.toUpperCase();
  }
  return '';
}

// Drift: processValue(0) old: returns '', new: returns ''
//        processValue('') old: returns '', new: throws (undefined.toUpperCase)
```

## 2. Control Flow Changes

**Red flags:**
- Early returns moved (different execution order)
- Loop conditions changed (different iteration count)
- Branch conditions changed (different cases matched)
- Switch cases reordered with fallthrough
- Try/catch boundaries changed (different error handling)
- Async/await added/removed (execution order differs)

**Before/after patterns:**

### Example: Early return moved
```typescript
// BEFORE
function calculateDiscount(price: number, coupon?: string): number {
  let discount = 0;

  if (coupon === 'SAVE10') {
    discount = 0.1;
  }

  if (price < 10) {
    return 0; // No discount for small orders
  }

  return price * discount;
}

// AFTER
function calculateDiscount(price: number, coupon?: string): number {
  if (price < 10) {
    return 0; // Moved early return
  }

  let discount = 0;
  if (coupon === 'SAVE10') {
    discount = 0.1;
  }

  return price * discount;
}

// No drift in this case (behavior equivalent), but be vigilant!
```

### Example: Branching changed
```typescript
// BEFORE
function getStatus(code: number): string {
  if (code === 200) return 'ok';
  if (code >= 400 && code < 500) return 'client_error';
  if (code >= 500) return 'server_error';
  return 'unknown';
}

// AFTER
function getStatus(code: number): string {
  if (code === 200) return 'ok';
  if (code >= 500) return 'server_error'; // ❌ Order swapped
  if (code >= 400 && code < 500) return 'client_error';
  return 'unknown';
}

// Drift: getStatus(500) - old: 'server_error', new: 'server_error' ✓
// But logic flow changed - could expose bugs if conditions overlap
```

## 3. Error Handling Semantics

**Red flags:**
- Throws → Returns error (or vice versa)
- Different exception types thrown
- Error messages changed (if parsed by callers)
- Error conditions changed (throws in different cases)
- Try/catch added/removed (errors now propagate differently)
- Error swallowing added/removed

**Before/after patterns:**

### Example: Error handling changed
```typescript
// BEFORE
function parseConfig(json: string): Config {
  try {
    return JSON.parse(json);
  } catch {
    return {}; // Returns empty on error
  }
}

// AFTER
function parseConfig(json: string): Config {
  return JSON.parse(json); // ❌ Now throws on error
}

// Drift: parseConfig('invalid') - old: returns {}, new: throws SyntaxError
// BLOCKER: Callers expecting no exceptions will break
```

### Example: Different exception type
```python
# BEFORE
def load_user(user_id: int) -> User:
    user = db.get(user_id)
    if not user:
        raise ValueError(f"User {user_id} not found")  # ValueError
    return user

# AFTER
def load_user(user_id: int) -> User:
    user = db.get(user_id)
    if not user:
        raise UserNotFoundError(f"User {user_id} not found")  # ❌ Different exception
    return user

# Drift: Callers catching ValueError won't catch UserNotFoundError
# HIGH: Breaking change for error handling
```

## 4. Side Effects & State Mutations

**Red flags:**
- Writes to different variables/fields
- External calls reordered (DB, API, filesystem)
- Logging added/removed/changed
- Mutations conditional on different logic
- Side effects duplicated (called twice instead of once)
- Side effects removed (no longer happens)

**Before/after patterns:**

### Example: Side effect order changed
```typescript
// BEFORE
async function createOrder(order: Order): Promise<void> {
  await db.orders.insert(order);
  await sendEmail(order.customerEmail);
  await logEvent('order_created', order.id);
}

// AFTER
async function createOrder(order: Order): Promise<void> {
  await logEvent('order_created', order.id); // ❌ Order changed
  await db.orders.insert(order);
  await sendEmail(order.customerEmail);
}

// Drift: Log happens before DB insert
// MEDIUM: If insert fails, we logged an event for non-existent order
```

### Example: Side effect condition changed
```typescript
// BEFORE
function updateUser(user: User): void {
  if (user.isActive) {
    db.users.update(user);
    logActivity('user_updated', user.id);
  }
}

// AFTER
function updateUser(user: User): void {
  db.users.update(user); // ❌ Always updates now
  if (user.isActive) {
    logActivity('user_updated', user.id);
  }
}

// Drift: Inactive users now updated in DB (was skipped before)
// HIGH: Behavior change on inactive users
```

## 5. Public API Contract Drift

**Red flags:**
- Function signature changed (params added/removed/reordered)
- Return type changed (null → undefined, error → null)
- Parameter types changed (string → number, loosened/tightened)
- Required → Optional (or vice versa)
- Removed public methods/fields
- Behavior semantics changed (idempotent → non-idempotent)

**Before/after patterns:**

### Example: Parameter made required
```typescript
// BEFORE
function sendEmail(to: string, subject?: string): void {
  const subj = subject || 'No subject';
  // ...
}

// AFTER
function sendEmail(to: string, subject: string): void { // ❌ Required now
  // ...
}

// Drift: sendEmail('user@example.com') - old: works, new: compile error
// BLOCKER: Breaking change for all callers
```

### Example: Return type changed
```typescript
// BEFORE
function findUser(id: string): User | null {
  return db.users.find(id) || null;
}

// AFTER
function findUser(id: string): User | undefined { // ❌ null → undefined
  return db.users.find(id);
}

// Drift: Callers checking === null will break
// HIGH: Breaking change for null checks
```

## 6. Performance Surprises

**Red flags:**
- Synchronous → Asynchronous (or vice versa)
- Blocking operations added (network, disk I/O)
- Algorithm complexity changed (O(n) → O(n²))
- Caching removed (was fast, now slow)
- N+1 query introduced (was batched, now per-item)
- Memory allocation pattern changed (stack → heap)

**Before/after patterns:**

### Example: Sync to async
```typescript
// BEFORE
function loadConfig(): Config {
  return JSON.parse(fs.readFileSync('config.json', 'utf-8'));
}

// AFTER
async function loadConfig(): Promise<Config> { // ❌ Now async
  const content = await fs.promises.readFile('config.json', 'utf-8');
  return JSON.parse(content);
}

// Drift: All callers must now await (or code breaks)
// BLOCKER: Breaking API change
```

### Example: N+1 query introduced
```python
# BEFORE
def get_users_with_posts(user_ids: List[int]) -> List[UserWithPosts]:
    users = db.users.find(user_ids)  # 1 query
    posts = db.posts.find_by_user_ids(user_ids)  # 1 query
    return merge(users, posts)  # O(2) queries

# AFTER
def get_users_with_posts(user_ids: List[int]) -> List[UserWithPosts]:
    users = db.users.find(user_ids)
    for user in users:
        user.posts = db.posts.find_by_user_id(user.id)  # ❌ N queries
    return users

# Drift: 2 queries → N+1 queries
# HIGH: Performance regression (10 users = 11 queries instead of 2)
```

## 7. Ordering & Determinism

**Red flags:**
- Iteration order changed (map → array, set ordering)
- Randomness introduced (UUIDs, timestamps)
- Sort removed (was sorted, now arbitrary order)
- Hash map used (was ordered, now unordered)
- Race condition introduced (concurrent access)
- Time-dependent behavior changed (Date.now() calls)

**Before/after patterns:**

### Example: Ordering changed
```typescript
// BEFORE
function getActiveUsers(): User[] {
  return db.users
    .filter(u => u.isActive)
    .sort((a, b) => a.name.localeCompare(b.name)); // Sorted
}

// AFTER
function getActiveUsers(): User[] {
  return db.users.filter(u => u.isActive); // ❌ No sort
}

// Drift: Results now in arbitrary order (DB order)
// MEDIUM: Callers expecting sorted order will break
```

### Example: Determinism removed
```javascript
// BEFORE
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}`; // Time-based
}

// AFTER
function generateId(prefix: string): string {
  return `${prefix}_${Math.random()}`; // ❌ Now random
}

// Drift: IDs no longer sequential/sortable
// MEDIUM: If callers rely on time ordering, breaks
```

## 8. Data Transformation Changes

**Red flags:**
- Mapping logic changed (field mappings differ)
- Filtering conditions changed (different items included)
- Normalization changed (case, whitespace, encoding)
- Validation logic changed (accepts/rejects different inputs)
- Type coercion changed (parseInt behavior, null handling)

**Before/after patterns:**

### Example: Filtering changed
```typescript
// BEFORE
function getAdults(users: User[]): User[] {
  return users.filter(u => u.age >= 18);
}

// AFTER
function getAdults(users: User[]): User[] {
  return users.filter(u => u.age > 18); // ❌ > instead of >=
}

// Drift: 18-year-olds excluded now
// HIGH: Off-by-one changes eligibility
```

### Example: Transformation changed
```python
# BEFORE
def normalize_email(email: str) -> str:
    return email.lower().strip()

# AFTER
def normalize_email(email: str) -> str:
    return email.strip().lower().replace('+', '')  # ❌ Removes '+'

# Drift: 'user+tag@example.com' → old: 'user+tag@example.com', new: 'usertag@example.com'
# HIGH: Email matching logic changed
```

# WORKFLOW

## Step 0: Infer SESSION_SLUG if not provided

Standard session inference from `.claude/README.md` (last entry).

## Step 1: Load session context

1. Validate `.claude/<SESSION_SLUG>/` exists
2. Read `.claude/<SESSION_SLUG>/README.md` for context
3. Check spec for behavior requirements
4. Check plan for refactor goals
5. Check work log for what was refactored

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
   - Review all changed files
   - Can be narrowed with globs

4. **CONTEXT** (if not provided)
   - Extract refactor goals from spec/plan
   - Identify expected behavior changes (if any)
   - Establish equivalence constraints

## Step 3: Gather before/after code

Based on SCOPE:
- For `pr`: Get diff from PR
- For `worktree`: Get git diff HEAD
- For `diff`: Get git diff for range
- For `file`: Get previous version + current

For each changed file:
1. Get complete before/after versions
2. Identify changed functions/classes
3. Map old code → new code
4. Note deleted code (where did it go?)
5. Note new code (where did it come from?)

## Step 4: Establish equivalence constraints

For each refactored function/class:

### 4.1: Input/Output Contract
- Same input types?
- Same output types?
- Same return values for same inputs?
- Same exceptions thrown?

### 4.2: Side Effect Contract
- Same external calls (DB, API, filesystem)?
- Same order of side effects?
- Same conditions for side effects?
- Same data mutations?
- Same logging/metrics?

### 4.3: Error Contract
- Same error conditions?
- Same exception types?
- Same error messages (if parsed)?
- Same error propagation?

### 4.4: Performance Contract
- Same algorithm complexity?
- Same blocking behavior (sync/async)?
- Same resource usage patterns?
- Same caching behavior?

### 4.5: API Contract
- Same public signatures?
- Same parameter semantics?
- Same return value semantics?
- Same idempotency guarantees?

## Step 5: Scan for semantic drift

For each checklist category, compare before/after:

### Default Values Scan
- Find optional parameters
- Check default values unchanged
- Look for missing parameters (fell back to different default)
- Check type coercion (truthy checks, null handling)

### Control Flow Scan
- Compare if/else conditions
- Check early returns (same conditions, same order)
- Verify loop conditions (same iteration count)
- Check switch cases (same matching logic)
- Verify try/catch boundaries (same error handling)

### Error Handling Scan
- Compare exception types thrown
- Check throws vs returns error
- Verify error conditions (same triggers)
- Look for added/removed try/catch
- Check error messages (if parsed by callers)

### Side Effects Scan
- List all external calls (DB, API, filesystem, logging)
- Compare order of side effects
- Check conditions for side effects (same guards?)
- Verify data mutations (same fields modified?)
- Look for duplicated/removed side effects

### API Contract Scan
- Compare function signatures
- Check parameter types (same? compatible?)
- Check return types (same? compatible?)
- Verify required vs optional parameters
- Look for removed public methods/fields

### Performance Scan
- Check sync vs async (blocking added/removed?)
- Look for algorithm changes (O(n) → O(n²)?)
- Check for N+1 queries (batching → per-item?)
- Verify caching behavior (same?)
- Look for memory allocation changes

### Ordering Scan
- Check iteration order (array → map, sorted → unsorted)
- Look for sort removed/added
- Check for randomness introduced (UUIDs, Math.random)
- Verify determinism (same inputs → same outputs always?)

### Data Transformation Scan
- Compare mapping logic (field mappings changed?)
- Check filtering conditions (same items included?)
- Verify normalization (case, whitespace, encoding)
- Check validation logic (accepts/rejects same inputs?)
- Look for type coercion changes (parseInt, null handling)

## Step 6: Assess each drift

For each potential drift found:

1. **Is it intentional or accidental?**
   - Check PR description, spec, plan
   - If intentional: Is it documented?
   - If accidental: It's a bug

2. **What's the blast radius?**
   - How many callers affected?
   - Is this a public API?
   - Are callers external (library) or internal?

3. **Severity**:
   - BLOCKER: Public API contract broken, data corruption, crashes
   - HIGH: Behavior differs in common cases, subtle data bugs
   - MED: Behavior differs in edge cases, performance regression
   - LOW: Cosmetic differences (log messages, timing)
   - NIT: Style, not semantic

4. **Confidence**:
   - High: Clear semantic difference, can show divergent input
   - Med: Likely different, but context may justify
   - Low: Suspicious, needs deeper analysis

5. **Evidence**:
   - File path + line range (before and after)
   - Side-by-side code snippets
   - Input that exposes drift
   - Expected vs actual behavior

6. **Fix**:
   - Revert to original behavior
   - Or: Document as intentional change
   - Or: Update callers if breaking change justified

## Step 7: Test coverage analysis

For refactored code, check:

1. **Do existing tests pass?**
   - If yes: Tests might be insufficient (didn't catch drift)
   - If no: Drift confirmed by tests

2. **What tests are missing?**
   - Edge cases that expose drift
   - Error path tests
   - Side effect verification tests
   - Performance regression tests

3. **Recommend new tests**:
   - Tests that would have caught the drift
   - Property-based tests (old and new return same result)
   - Characterization tests (lock in current behavior)

## Step 8: Generate review report

Create `.claude/<SESSION_SLUG>/reviews/review-refactor-safety-{YYYY-MM-DD}.md`

## Step 9: Update session README

Standard artifact tracking update.

## Step 10: Output summary

Print summary with drift findings and safety assessment.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-refactor-safety-{YYYY-MM-DD}.md`:

```markdown
---
command: /review:refactor-safety
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

# Refactor Safety Review Report

**Reviewed:** {SCOPE} / {TARGET}
**Date:** {YYYY-MM-DD}
**Reviewer:** Claude Code

---

## 0) Refactor Scope & Equivalence Constraints

**What was refactored:**
- Scope: {SCOPE}
- Target: {TARGET}
- Files: {count} files, {+lines} added, {-lines} removed
{If PATHS provided:}
- Focus: {PATHS}

**Refactor goals:**
{From CONTEXT, spec, or plan}
- {Goal 1 - e.g., "Extract user validation logic into separate module"}
- {Goal 2 - e.g., "Simplify error handling with custom error types"}
- {Goal 3 - e.g., "Remove code duplication in API routes"}

**Equivalence constraints:**
What MUST remain identical:

1. **Input/Output Contract**
   - Same inputs → same outputs
   - Same return types
   - Same exceptions thrown

2. **Side Effect Contract**
   - Same external calls (DB, API, filesystem)
   - Same order of operations
   - Same data mutations

3. **Error Contract**
   - Same error conditions
   - Same exception types
   - Same error handling behavior

4. **Performance Contract**
   - Same algorithm complexity (O(n) remains O(n))
   - Same sync/async behavior
   - No N+1 queries introduced

5. **API Contract** (public APIs only)
   - Same function signatures
   - Same parameter semantics
   - Same idempotency guarantees

**Allowed changes:**
{From CONTEXT or plan}
- {Change 1 - e.g., "Internal variable names can differ"}
- {Change 2 - e.g., "Helper functions can be added"}
- {Change 3 - e.g., "Code organization can differ"}

---

## 1) Executive Summary

**Safety Assessment:** {SAFE | MOSTLY_SAFE | DRIFT_DETECTED | UNSAFE}

**Rationale:**
{2-3 sentences explaining assessment}

**Critical Drift (BLOCKER/HIGH):**
1. **{Finding ID}**: {What changed} - {Impact on behavior}
2. **{Finding ID}**: {What changed} - {Impact on behavior}

**Overall Assessment:**
- Behavior Equivalence: {Preserved | Mostly Preserved | Violated}
- Public API Safety: {Safe | Breaking Changes}
- Side Effect Safety: {Preserved | Changed}
- Error Handling Safety: {Preserved | Changed}
- Performance Safety: {Preserved | Regressed}

---

## 2) Findings Table

| ID | Severity | Confidence | Category | File:Line | Semantic Drift |
|----|----------|------------|----------|-----------|----------------|
| RS-1 | BLOCKER | High | API Contract | `auth.ts:45` | Required param now optional |
| RS-2 | HIGH | High | Side Effects | `process.ts:120` | Log order changed |
| RS-3 | HIGH | Med | Error Handling | `api.ts:80` | Throws different exception |
| RS-4 | MED | High | Default Values | `config.ts:30` | Default changed from 10 to 100 |
| RS-5 | LOW | Med | Performance | `parse.ts:50` | O(n) → O(n log n) |

**Findings Summary:**
- BLOCKER: {count}
- HIGH: {count}
- MED: {count}
- LOW: {count}
- NIT: {count}

**Category Breakdown:**
- Default Values: {count}
- Control Flow: {count}
- Error Handling: {count}
- Side Effects: {count}
- API Contract: {count}
- Performance: {count}
- Ordering: {count}
- Data Transformation: {count}

---

## 3) Findings (Detailed)

### RS-1: Function Signature Changed - Required Parameter Removed [BLOCKER]

**Location:** `src/auth/auth.ts:45-60`

**Category:** API Contract Drift

**Equivalence Violated:**
- **API Contract**: Function signature changed
- **Impact**: Breaking change for all callers

**Before:**
```typescript
// Lines 45-50 (git SHA: abc123)
function authenticateUser(
  username: string,
  password: string,
  mfaToken: string  // ← Required parameter
): Promise<AuthResult> {
  if (!mfaToken) {
    throw new Error('MFA token required');
  }

  return verifyCredentials(username, password, mfaToken);
}
```

**After:**
```typescript
// Lines 45-50 (git SHA: def456)
function authenticateUser(
  username: string,
  password: string,
  mfaToken?: string  // ❌ Now optional
): Promise<AuthResult> {
  if (mfaToken) {
    return verifyCredentials(username, password, mfaToken);
  }

  // ❌ NEW: Fallback to no MFA
  return verifyCredentials(username, password);
}
```

**Semantic Drift:**

Input that exposes drift:
```typescript
// Old behavior
authenticateUser('alice', 'pass123'); // ✅ Compile error: Missing mfaToken

// New behavior
authenticateUser('alice', 'pass123'); // ❌ Compiles! Bypasses MFA
```

**Impact:**
- **Security hole**: MFA can now be bypassed
- **Breaking change**: Callers may stop passing mfaToken (TypeScript won't complain)
- **Silent degradation**: Auth becomes weaker without error
- **All callers affected**: 47 call sites in codebase

**Why is this drift?**

This violates the **API contract**:
- Old: MFA always required (enforced by type system)
- New: MFA optional (security weakened)

This is not a refactor - it's a **behavior change disguised as refactor**.

**Severity:** BLOCKER
**Confidence:** High
**Category:** API Contract + Security

**Fix:**

Revert to required parameter:

```diff
--- a/src/auth/auth.ts
+++ b/src/auth/auth.ts
@@ -43,7 +43,7 @@
 function authenticateUser(
   username: string,
   password: string,
-  mfaToken?: string
+  mfaToken: string
 ): Promise<AuthResult> {
-  if (mfaToken) {
-    return verifyCredentials(username, password, mfaToken);
-  }
-
-  return verifyCredentials(username, password);
+  return verifyCredentials(username, password, mfaToken);
 }
```

**Alternative (if optional MFA is intentional):**

Document as breaking change and provide migration:
```typescript
// Add new function for optional MFA
function authenticateUserOptionalMFA(
  username: string,
  password: string,
  mfaToken?: string
): Promise<AuthResult> {
  if (mfaToken) {
    return verifyCredentials(username, password, mfaToken);
  }
  return verifyCredentials(username, password);
}

// Keep old function with required MFA
function authenticateUser(
  username: string,
  password: string,
  mfaToken: string
): Promise<AuthResult> {
  return verifyCredentials(username, password, mfaToken);
}
```

**Test that would have caught this:**
```typescript
test('authenticateUser requires MFA token', async () => {
  // @ts-expect-error: mfaToken is required
  await expect(authenticateUser('alice', 'pass123')).toReject();
});
```

---

### RS-2: Side Effect Order Changed [HIGH]

**Location:** `src/services/process.ts:120-140`

**Category:** Side Effects Drift

**Equivalence Violated:**
- **Side Effect Contract**: Order of operations changed
- **Impact**: Error recovery behavior differs

**Before:**
```typescript
// Lines 120-130 (git SHA: abc123)
async function createOrder(order: Order): Promise<Order> {
  // 1. Create in DB first
  const created = await db.orders.insert(order);

  // 2. Then send confirmation
  await sendConfirmationEmail(order.customerEmail, created.id);

  // 3. Finally log
  logger.info('Order created', { orderId: created.id });

  return created;
}
```

**After:**
```typescript
// Lines 120-140 (git SHA: def456)
async function createOrder(order: Order): Promise<Order> {
  // ❌ 1. Log first
  logger.info('Creating order', { customerId: order.customerId });

  // ❌ 2. Send email before DB insert
  const tempId = generateOrderId();
  await sendConfirmationEmail(order.customerEmail, tempId);

  // 3. Then create in DB
  const created = await db.orders.insert({ ...order, id: tempId });

  return created;
}
```

**Semantic Drift:**

Failure scenario that exposes drift:
```typescript
// Scenario: DB insert fails

// Old behavior
createOrder(order);
// 1. DB insert fails ❌
// 2. Email NOT sent ✅ (never reached)
// 3. Log NOT written ✅ (never reached)
// Result: No side effects (clean failure)

// New behavior
createOrder(order);
// 1. Log written ❌ (for non-existent order)
// 2. Email sent ❌ (for order that won't exist)
// 3. DB insert fails ❌
// Result: Customer got confirmation for failed order!
```

**Impact:**
- **Customer confusion**: Confirmation email sent for failed orders
- **Logging pollution**: Logs show "creating" but order doesn't exist
- **Cleanup required**: Now need to handle partial failures (unsend email?)
- **Atomicity broken**: Was atomic (all or nothing), now partial

**Why is this drift?**

This violates the **side effect contract**:
- Old: Side effects only on success (transaction-like)
- New: Side effects happen even on failure (partial completion)

Error handling semantics changed:
- Old: Clean failure (no customer impact)
- New: Messy failure (customer affected)

**Severity:** HIGH
**Confidence:** High
**Category:** Side Effects + Error Handling

**Fix:**

Revert to original order (side effects after success):

```diff
--- a/src/services/process.ts
+++ b/src/services/process.ts
@@ -118,15 +118,13 @@
 async function createOrder(order: Order): Promise<Order> {
-  logger.info('Creating order', { customerId: order.customerId });
-
-  const tempId = generateOrderId();
-  await sendConfirmationEmail(order.customerEmail, tempId);
-
-  const created = await db.orders.insert({ ...order, id: tempId });
+  // Create in DB first (if this fails, no side effects)
+  const created = await db.orders.insert(order);
+
+  // Only send email after successful creation
+  await sendConfirmationEmail(order.customerEmail, created.id);
+
+  logger.info('Order created', { orderId: created.id });

   return created;
 }
```

**Better approach (explicit transaction):**
```typescript
async function createOrder(order: Order): Promise<Order> {
  return await db.transaction(async (tx) => {
    // All operations within transaction
    const created = await tx.orders.insert(order);

    // Mark email for sending (outside transaction)
    await tx.emailQueue.enqueue({
      to: order.customerEmail,
      template: 'order_confirmation',
      data: { orderId: created.id },
    });

    return created;
  });
  // Log after transaction commits
  .then(created => {
    logger.info('Order created', { orderId: created.id });
    return created;
  });
}
```

**Test that would have caught this:**
```typescript
test('createOrder has no side effects on failure', async () => {
  const emailSpy = jest.spyOn(emailService, 'send');
  const logSpy = jest.spyOn(logger, 'info');

  // Make DB insert fail
  jest.spyOn(db.orders, 'insert').mockRejectedValue(new Error('DB error'));

  await expect(createOrder(order)).rejects.toThrow();

  // Verify no email sent
  expect(emailSpy).not.toHaveBeenCalled();

  // Verify no success log
  expect(logSpy).not.toHaveBeenCalledWith('Order created', expect.any(Object));
});
```

---

### RS-3: Exception Type Changed [HIGH]

**Location:** `src/api/api.ts:80-95`

**Category:** Error Handling Drift

**Equivalence Violated:**
- **Error Contract**: Different exception type thrown
- **Impact**: Callers catching specific exceptions will break

**Before:**
```typescript
// Lines 80-90 (git SHA: abc123)
function validateUser(user: User): void {
  if (!user.email) {
    throw new ValidationError('Email is required');  // ValidationError
  }

  if (!user.name) {
    throw new ValidationError('Name is required');  // ValidationError
  }
}
```

**After:**
```typescript
// Lines 80-95 (git SHA: def456)
function validateUser(user: User): void {
  const errors: string[] = [];

  if (!user.email) {
    errors.push('Email is required');
  }

  if (!user.name) {
    errors.push('Name is required');
  }

  if (errors.length > 0) {
    throw new MultipleValidationError(errors);  // ❌ Different exception type
  }
}
```

**Semantic Drift:**

Error handling that exposes drift:
```typescript
// Old behavior
try {
  validateUser({ name: 'Alice' }); // Missing email
} catch (error) {
  if (error instanceof ValidationError) {  // ✅ Caught
    console.log('Validation failed:', error.message);
  }
}

// New behavior
try {
  validateUser({ name: 'Alice' }); // Missing email
} catch (error) {
  if (error instanceof ValidationError) {  // ❌ Not caught!
    console.log('Validation failed:', error.message);
  }
  // Error propagates uncaught!
}
```

**Impact:**
- **Uncaught exceptions**: Callers catching ValidationError won't catch MultipleValidationError
- **Process crashes**: Uncaught exceptions may kill process
- **Error handling broken**: 23 call sites with ValidationError catch blocks
- **API contract broken**: Function contract changed from "throws ValidationError" to "throws MultipleValidationError"

**Why is this drift?**

This violates the **error contract**:
- Old: Throws ValidationError (documented, expected)
- New: Throws MultipleValidationError (undocumented, unexpected)

Even though the new approach is arguably better (batches errors), it's a **breaking change** - not a refactor.

**Severity:** HIGH
**Confidence:** High
**Category:** Error Handling + API Contract

**Fix:**

Option 1: Keep ValidationError, add errors array field:

```diff
--- a/src/api/api.ts
+++ b/src/api/api.ts
@@ -78,17 +78,17 @@
 function validateUser(user: User): void {
   const errors: string[] = [];

   if (!user.email) {
     errors.push('Email is required');
   }

   if (!user.name) {
     errors.push('Name is required');
   }

   if (errors.length > 0) {
-    throw new MultipleValidationError(errors);
+    // ✅ Keep same exception type, add errors array
+    const error = new ValidationError(errors.join(', '));
+    error.errors = errors;  // Add errors array as property
+    throw error;
   }
 }
```

Option 2: Make MultipleValidationError extend ValidationError:

```typescript
// Preserve exception hierarchy
class MultipleValidationError extends ValidationError {
  constructor(public readonly errors: string[]) {
    super(errors.join(', '));
  }
}

// Now callers catching ValidationError will still catch MultipleValidationError
```

Option 3: Deprecate old function, add new:

```typescript
// Keep old function (unchanged)
function validateUser(user: User): void {
  if (!user.email) {
    throw new ValidationError('Email is required');
  }
  if (!user.name) {
    throw new ValidationError('Name is required');
  }
}

// Add new function with batched errors
function validateUserBatch(user: User): void {
  const errors: string[] = [];
  if (!user.email) errors.push('Email is required');
  if (!user.name) errors.push('Name is required');
  if (errors.length > 0) {
    throw new MultipleValidationError(errors);
  }
}
```

**Test that would have caught this:**
```typescript
test('validateUser throws ValidationError', () => {
  expect(() => validateUser({ name: 'Alice' })).toThrow(ValidationError);

  // Verify error can be caught as ValidationError
  try {
    validateUser({ name: 'Alice' });
    fail('Should have thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
  }
});
```

---

### RS-4: Default Value Changed [MED]

**Location:** `src/config/config.ts:30-40`

**Category:** Default Values Drift

**Equivalence Violated:**
- **Implicit Behavior**: Default parameter value changed
- **Impact**: Callers not passing parameter get different behavior

**Before:**
```typescript
// Lines 30-35 (git SHA: abc123)
function createConnection(
  host: string,
  port: number = 5432,  // Default PostgreSQL port
  timeout: number = 10000  // 10 seconds
): Connection {
  return new Connection(host, port, timeout);
}
```

**After:**
```typescript
// Lines 30-40 (git SHA: def456)
function createConnection(
  host: string,
  port: number = 5432,
  timeout: number = 30000  // ❌ Changed to 30 seconds
): Connection {
  return new Connection(host, port, timeout);
}
```

**Semantic Drift:**

Call that exposes drift:
```typescript
// Old behavior
const conn = createConnection('localhost', 5432);
// timeout = 10000 (10 seconds)

// New behavior
const conn = createConnection('localhost', 5432);
// timeout = 30000 (30 seconds) ❌ 3x longer!
```

**Impact:**
- **Timeout behavior changed**: Operations now wait 3x longer
- **Slow failures**: Clients wait 30s instead of 10s for timeout
- **Resource holding**: Connections held longer on slow networks
- **User experience**: UI appears frozen for 30s instead of 10s
- **All callers affected**: 34 call sites not passing timeout

**Why is this drift?**

This violates **implicit behavior contract**:
- Old: Quick timeout (10s) - fail fast
- New: Long timeout (30s) - slow failure

While not necessarily wrong, this is a **behavior change** that:
- Affects user experience
- Changes resource usage patterns
- Alters failure modes

Should be documented as intentional change, not silent refactor.

**Severity:** MED (impacts UX, not correctness)
**Confidence:** High
**Category:** Default Values + Performance

**Fix:**

Revert to original default:

```diff
--- a/src/config/config.ts
+++ b/src/config/config.ts
@@ -28,7 +28,7 @@
 function createConnection(
   host: string,
   port: number = 5432,
-  timeout: number = 30000
+  timeout: number = 10000
 ): Connection {
   return new Connection(host, port, timeout);
 }
```

**Alternative (if longer timeout is intentional):**

1. Document the change:
```typescript
/**
 * Creates a database connection
 *
 * @param timeout - Connection timeout in milliseconds (default: 30000)
 *                  Changed from 10s to 30s in v2.0 to handle slow networks
 */
function createConnection(
  host: string,
  port: number = 5432,
  timeout: number = 30000
): Connection {
  return new Connection(host, port, timeout);
}
```

2. Or make it configurable:
```typescript
// Load from config
const DEFAULT_TIMEOUT = process.env.DB_TIMEOUT
  ? parseInt(process.env.DB_TIMEOUT)
  : 10000;

function createConnection(
  host: string,
  port: number = 5432,
  timeout: number = DEFAULT_TIMEOUT
): Connection {
  return new Connection(host, port, timeout);
}
```

**Test that would have caught this:**
```typescript
test('createConnection uses 10s default timeout', () => {
  const conn = createConnection('localhost', 5432);
  expect(conn.timeout).toBe(10000);
});
```

---

### RS-5: Performance Characteristics Changed [LOW]

**Location:** `src/lib/parse.ts:50-70`

**Category:** Performance Drift

**Equivalence Violated:**
- **Performance Contract**: Algorithm complexity changed
- **Impact**: Slower on large inputs

**Before:**
```typescript
// Lines 50-60 (git SHA: abc123)
function deduplicateUsers(users: User[]): User[] {
  const seen = new Set<string>();
  const result: User[] = [];

  for (const user of users) {  // O(n)
    if (!seen.has(user.email)) {
      seen.add(user.email);
      result.push(user);
    }
  }

  return result;
}
// Time complexity: O(n)
// Space complexity: O(n)
```

**After:**
```typescript
// Lines 50-70 (git SHA: def456)
function deduplicateUsers(users: User[]): User[] {
  const result: User[] = [];

  for (const user of users) {  // O(n)
    // ❌ O(n) lookup on each iteration
    if (!result.find(u => u.email === user.email)) {  // O(n)
      result.push(user);
    }
  }

  return result;
}
// Time complexity: O(n²) ❌
// Space complexity: O(n)
```

**Semantic Drift:**

Performance that exposes drift:
```typescript
// Old behavior: O(n)
deduplicateUsers(users1000);  // ~1ms
deduplicateUsers(users10000); // ~10ms (linear)

// New behavior: O(n²)
deduplicateUsers(users1000);  // ~10ms
deduplicateUsers(users10000); // ~1000ms (quadratic) ❌ 100x slower!
```

**Impact:**
- **Performance regression**: 100x slower on large inputs
- **Timeout risk**: May timeout on production data sizes
- **Resource usage**: More CPU time consumed
- **User experience**: Slower page loads

**Why is this drift?**

This violates **performance contract**:
- Old: O(n) - scales linearly
- New: O(n²) - scales quadratically

While functionally equivalent (same output), performance is part of the contract for production code.

**Severity:** LOW (only noticeable on large inputs, likely caught in testing)
**Confidence:** Med (depends on typical input size)
**Category:** Performance

**Fix:**

Revert to O(n) implementation:

```diff
--- a/src/lib/parse.ts
+++ b/src/lib/parse.ts
@@ -48,11 +48,15 @@
 function deduplicateUsers(users: User[]): User[] {
+  const seen = new Set<string>();
   const result: User[] = [];

   for (const user of users) {
-    if (!result.find(u => u.email === user.email)) {
+    if (!seen.has(user.email)) {
+      seen.add(user.email);
       result.push(user);
     }
   }

   return result;
 }
```

**Alternative (if linear search is intentional):**

Add comment explaining why:
```typescript
function deduplicateUsers(users: User[]): User[] {
  const result: User[] = [];

  // NOTE: Using linear search instead of Set to preserve insertion order
  // and avoid hash collisions. Acceptable for small user lists (<100).
  // For large lists, use deduplicateUsersOptimized() instead.
  for (const user of users) {
    if (!result.find(u => u.email === user.email)) {
      result.push(user);
    }
  }

  return result;
}
```

**Test that would have caught this:**
```typescript
test('deduplicateUsers performance is O(n)', () => {
  const users1k = generateUsers(1000);
  const users10k = generateUsers(10000);

  const time1k = measureTime(() => deduplicateUsers(users1k));
  const time10k = measureTime(() => deduplicateUsers(users10k));

  // Should be roughly linear (allow 2x margin for variance)
  expect(time10k).toBeLessThan(time1k * 20);
});
```

---

## 4) Equivalence Analysis

Analysis of how well behavior equivalence was preserved:

| Contract | Status | Violations | Notes |
|----------|--------|------------|-------|
| Input/Output | ⚠️ Partial | RS-1 (signature changed) | Most functions preserved I/O contract |
| Side Effects | ❌ Violated | RS-2 (order changed) | Order matters for error recovery |
| Error Handling | ❌ Violated | RS-3 (exception type) | Breaking change for error handling |
| Performance | ⚠️ Regressed | RS-5 (O(n²)) | Noticeable on large inputs |
| API Contract | ❌ Broken | RS-1 (signature), RS-3 (exceptions) | Breaking changes for callers |
| Defaults | ⚠️ Changed | RS-4 (timeout 3x longer) | Affects user experience |

**Summary:**
- ✅ Preserved: Internal code structure, naming, organization
- ⚠️ Partially Preserved: I/O contract (mostly), performance (most functions)
- ❌ Violated: API contract (RS-1), error handling (RS-3), side effects (RS-2)

**Verdict:**
This refactor **introduced semantic drift**. While most code was refactored safely, several breaking changes make this **not a pure refactor**.

**Recommendations:**
1. Fix RS-1, RS-2, RS-3 (BLOCKER/HIGH findings)
2. Revert RS-4, RS-5 or document as intentional changes
3. Add equivalence tests (old behavior = new behavior)
4. Consider this a "behavior change + refactor" not "pure refactor"

---

## 5) Test Coverage Analysis

**Existing tests:**
- Unit tests: 127 tests, 87% coverage
- Integration tests: 34 tests

**Test results:**
- ✅ Passed: 124 tests
- ❌ Failed: 3 tests (related to RS-1 and RS-3)
- ⚠️ Flaky: 0 tests

**What tests caught:**
1. RS-1: TypeScript compile error in tests (signature changed)
2. RS-3: Test expecting ValidationError failed

**What tests missed:**
1. RS-2: No test for side effect order (would have caught email-before-DB bug)
2. RS-4: No test for default timeout value
3. RS-5: No performance regression test

**Recommended new tests:**

### Equivalence Tests
Tests that compare old vs new behavior:

```typescript
describe('Refactor equivalence tests', () => {
  test('createOrder has same side effect order', async () => {
    const effects: string[] = [];

    jest.spyOn(db.orders, 'insert').mockImplementation(async (order) => {
      effects.push('db');
      return { ...order, id: '123' };
    });

    jest.spyOn(emailService, 'send').mockImplementation(async () => {
      effects.push('email');
    });

    await createOrder(order);

    // Verify DB happens before email
    expect(effects).toEqual(['db', 'email']);
  });

  test('validateUser throws ValidationError type', () => {
    expect(() => validateUser({ name: 'Alice' }))
      .toThrow(ValidationError);
  });

  test('createConnection default timeout is 10s', () => {
    const conn = createConnection('localhost', 5432);
    expect(conn.timeout).toBe(10000);
  });
});
```

### Performance Regression Tests
```typescript
describe('Performance regression tests', () => {
  test('deduplicateUsers is O(n)', () => {
    const sizes = [100, 1000, 10000];
    const times: number[] = [];

    for (const size of sizes) {
      const users = generateUsers(size);
      const start = performance.now();
      deduplicateUsers(users);
      times.push(performance.now() - start);
    }

    // Check for quadratic growth (O(n²) would be 100x, 10000x)
    // Allow 20x for O(n) with variance
    expect(times[1] / times[0]).toBeLessThan(20);
    expect(times[2] / times[1]).toBeLessThan(20);
  });
});
```

### Characterization Tests
Tests that lock in current behavior:

```typescript
describe('Characterization tests', () => {
  test('authenticateUser snapshot', async () => {
    const result = await authenticateUser('alice', 'pass123', 'mfa123');
    expect(result).toMatchSnapshot();
  });

  test('createOrder side effects snapshot', async () => {
    const effects: any[] = [];

    // Spy on all side effects
    jest.spyOn(db.orders, 'insert').mockImplementation(async (order) => {
      effects.push({ type: 'db', order });
      return { ...order, id: '123' };
    });

    jest.spyOn(emailService, 'send').mockImplementation(async (email) => {
      effects.push({ type: 'email', email });
    });

    await createOrder(order);

    // Snapshot of all side effects (order and data)
    expect(effects).toMatchSnapshot();
  });
});
```

---

## 6) Recommendations

### Critical (Fix Before Merge) - BLOCKER

1. **RS-1: Function Signature Changed**
   - Action: Revert to required parameter or add deprecation path
   - Effort: 15 minutes
   - Risk: Security hole (MFA bypass)

### High Priority (Fix Soon) - HIGH

2. **RS-2: Side Effect Order Changed**
   - Action: Revert to DB-first order
   - Effort: 10 minutes
   - Risk: Customer confusion, failed order confirmations

3. **RS-3: Exception Type Changed**
   - Action: Keep ValidationError type or make MultipleValidationError extend it
   - Effort: 20 minutes
   - Risk: Uncaught exceptions, process crashes

### Medium Priority (Address or Document) - MED

4. **RS-4: Default Value Changed**
   - Action: Revert to 10s timeout or document as intentional change
   - Effort: 5 minutes
   - Risk: Slower user experience

### Low Priority (Document or Accept) - LOW

5. **RS-5: Performance Regression**
   - Action: Revert to O(n) implementation or add comment
   - Effort: 5 minutes
   - Risk: Slow on large inputs (likely caught in testing)

### Testing Improvements

6. **Add equivalence tests**
   - Action: Tests that verify old behavior = new behavior
   - Effort: 1 hour
   - Risk: Future refactors introduce drift

7. **Add performance regression tests**
   - Action: Tests that check algorithm complexity
   - Effort: 30 minutes
   - Risk: Silent performance regressions

### Overall Strategy

**This is not a safe refactor.** It introduces semantic drift that breaks behavior equivalence.

**Recommended path:**
1. Fix BLOCKER and HIGH findings (RS-1, RS-2, RS-3)
2. For MED/LOW findings: Revert or document as intentional changes
3. Add equivalence tests to prevent future drift
4. Consider splitting into two PRs:
   - PR 1: Pure refactor (structure only, zero behavior change)
   - PR 2: Behavior changes (explicitly documented)

---

## 7) False Positives & Disagreements Welcome

**Where I might be wrong:**

1. **RS-4 (Default timeout)**: If this is internal code and 30s timeout is required for production, severity might be lower
2. **RS-5 (Performance)**: If typical input size is <100 items, O(n²) might be acceptable
3. **RS-3 (Exception type)**: If MultipleValidationError is caught by a generic exception handler, might not break

**How to override my findings:**
- Show that tests verify equivalence (I missed them)
- Explain that behavior changes were intentional and documented
- Provide context that makes drift acceptable (internal code, migration plan)
- Show that API contract changes are non-breaking (e.g., extends old type)

I'm optimizing for **behavior equivalence**. If there's a good reason for drift, let's document it explicitly!

---

*Review completed: {YYYY-MM-DD}*
*Session: [{SESSION_SLUG}](../README.md)*
```

# SUMMARY OUTPUT

After creating review, print:

```markdown
# Refactor Safety Review Complete

## Review Location
Saved to: `.claude/{SESSION_SLUG}/reviews/review-refactor-safety-{YYYY-MM-DD}.md`

## Safety Assessment
**{SAFE | MOSTLY_SAFE | DRIFT_DETECTED | UNSAFE}**

## Critical Drift (BLOCKER/HIGH)
1. **{Finding ID}**: {What changed} - {Impact}
2. **{Finding ID}**: {What changed} - {Impact}

## Statistics
- Files reviewed: {count}
- Lines changed: +{added} -{removed}
- Findings: BLOCKER: {X}, HIGH: {X}, MED: {X}, LOW: {X}, NIT: {X}
- Semantic drift detected: {X} violations of behavior equivalence

## Equivalence Status
- Input/Output Contract: {Preserved | Partial | Violated}
- Side Effects Contract: {Preserved | Partial | Violated}
- Error Handling Contract: {Preserved | Partial | Violated}
- Performance Contract: {Preserved | Regressed | Violated}
- API Contract: {Preserved | Broken}

## Immediate Actions Required
{If BLOCKER findings:}
1. {Finding ID}: {Fix description} ({estimated time})
2. {Finding ID}: {Fix description} ({estimated time})

**DO NOT MERGE** until drift is fixed or documented.

## Quick Fixes
{If HIGH findings:}
1. {Finding ID}: {Fix description} ({estimated time})
2. {Finding ID}: {Fix description} ({estimated time})

**Total critical fix effort:** {X} minutes

## Verdict
{If UNSAFE:}
This refactor **introduces semantic drift** and breaks behavior equivalence.
Not safe to merge without fixing critical findings.

{If DRIFT_DETECTED:}
This refactor is **mostly safe** but has some behavior changes.
Document as "behavior change + refactor" not "pure refactor".

{If MOSTLY_SAFE:}
This refactor is **mostly safe** with minor edge case differences.
Consider fixing or documenting minor drift.

{If SAFE:}
This refactor **preserves behavior equivalence**. Safe to merge.

## Next Steps
1. Fix BLOCKER/HIGH drift (RS-1, RS-2, RS-3)
2. Revert or document MED/LOW changes (RS-4, RS-5)
3. Add equivalence tests
4. Consider splitting: pure refactor vs behavior changes

## Test Coverage Gaps
{List critical missing tests that would have caught drift}
```

# IMPORTANT: Hunt the Drift

This review should:
- **Compare before/after**: Side-by-side code for every finding
- **Prove drift**: Concrete input where behavior differs
- **Test what's missing**: Equivalence tests that would catch drift
- **Be pedantic**: Even "small" changes matter (defaults, order, exceptions)
- **Assume nothing**: "Looks equivalent" is not "is equivalent"

The goal is to catch **"looks the same, behaves differently"** bugs before they ship.

# WHEN TO USE

Run `/review:refactor-safety` when:
- PR is labeled "refactor" or "cleanup"
- Code structure changed but "behavior same"
- After large refactors (extracting modules, renaming, restructuring)
- Before releases (verify no accidental behavior changes)
- When "simple refactor" breaks tests

This should be in the default review chain for all refactor work types.
