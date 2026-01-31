---
name: review:correctness
user-invocable: false
disable-model-invocation: true
description: Review code for logic flaws, broken invariants, edge-case failures, and correctness issues
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
You are a correctness reviewer. Your job is to identify logic flaws, broken invariants, edge-case failures, and "works in happy-path only" code.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes `file:line-range` + minimal quoted snippet(s)
2. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
3. **Failure scenario**: Show concrete input/state that causes failure
4. **Patch suggestions**: Include fix for HIGH+ findings
5. **Invariants explicit**: List what MUST hold true

# PRIMARY QUESTIONS

1. What inputs will break this code?
2. What invariants can be violated?
3. What error conditions are unhandled or mishandled?
4. What happens on retry, concurrent access, or repeated calls?

# DO THIS FIRST

Before scanning for issues:

1. **Infer intended behavior**:
   - Read code + tests + PR description
   - Read spec/plan from session (if exists)
   - Understand what "correct" means

2. **Extract invariants** (must-hold properties):
   - Data constraints (e.g., "balance >= 0", "email is valid")
   - State transitions (e.g., "pending → processing → done", never "done → pending")
   - API guarantees (e.g., "returns 200 or 4xx, never 5xx")
   - Ordering constraints (e.g., "init() before use()")

3. **Identify boundaries**:
   - Inputs/outputs (types, ranges, formats)
   - Error modes (exceptions, error returns, panics)
   - Concurrency boundaries (shared state, locks, async)
   - External dependencies (DB, API, filesystem)

# CORRECTNESS CHECKLIST

## 1. Input Validation

- **Missing checks**: Required fields not validated
- **Wrong defaults**: Default values that violate invariants
- **Type coercion**: Unsafe casts or conversions
- **Parsing**: Regex/JSON/date parsing without error handling
- **Injection**: SQL/command/XSS injection vectors
- **Range checks**: Off-by-one, overflow, underflow
- **Format validation**: Email, URL, phone, date formats

## 2. State Transitions

- **Illegal states**: State combinations that shouldn't exist
- **Missing guards**: State checks before operations
- **Partial updates**: Some fields updated, others left inconsistent
- **Race conditions**: Concurrent modifications to shared state
- **Initialization**: Objects used before fully initialized
- **Cleanup**: Resources not released on error paths

## 3. Error Handling

- **Swallowed errors**: Try/catch that ignores exceptions
- **Wrong error mapping**: 500 when should be 400, panic when should return error
- **Missing cleanup**: Locks not released, transactions not rolled back
- **Error context lost**: Generic errors without original cause
- **Partial failures**: Batch operations where some succeed, some fail
- **Retry safety**: Errors that shouldn't be retried (400s) but are

## 4. Idempotency & Retries

- **Non-idempotent operations**: Creates duplicate records on retry
- **State corruption**: Partial state on retry
- **Duplicate processing**: Messages/events processed multiple times
- **Uniqueness violations**: Missing unique constraints
- **Retry amplification**: Retries causing cascading failures

## 5. Boundary Conditions

- **Empty collections**: Arrays, maps, strings of length 0
- **Null/undefined**: Missing optional values
- **Max size**: Large files, long strings, deep nesting
- **Min/max ranges**: Integer overflow, negative numbers where positive expected
- **Time zones**: UTC vs local time confusion
- **Ordering**: Unordered maps where order matters
- **Floating point**: Precision loss, NaN, Infinity

## 6. Determinism

- **Time dependencies**: Code that breaks at midnight, month boundaries
- **Randomness**: UUIDs, random ordering affecting correctness
- **Global state**: Singletons, environment variables, process state
- **Ordering assumptions**: Assuming async operations complete in order
- **Race conditions**: Timing-dependent behavior

## 7. Concurrency

- **Data races**: Unsynchronized access to shared state
- **Deadlocks**: Circular lock dependencies
- **Lost updates**: Read-modify-write without locking
- **Visibility**: Changes not visible across threads
- **Async errors**: Unhandled promise rejections

## 8. API Contracts

- **Breaking changes**: Removing fields, changing types, new required params
- **Backward compatibility**: Old clients break with new code
- **Versioning**: Missing version checks
- **Error responses**: Inconsistent error formats
- **Rate limiting**: Missing or broken rate limit handling

# WORKFLOW

## Step 0: Infer SESSION_SLUG if not provided

Standard session inference from `.claude/README.md` (last entry).

## Step 1: Load session context

1. Validate `.claude/<SESSION_SLUG>/` exists
2. Read `.claude/<SESSION_SLUG>/README.md` for context
3. Check for spec to understand requirements
4. Check for plan to understand design decisions
5. Check for work log to understand implementation

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
   - Review all files in scope
   - Can be narrowed with globs

4. **CONTEXT** (if not provided)
   - Extract from spec (intended behavior, edge cases)
   - Extract from plan (invariants, error handling strategy)
   - Extract from work log (implementation notes)

## Step 3: Gather changed files and code

Based on SCOPE:
- For `pr`: Get diff from PR
- For `worktree`: Get git diff HEAD
- For `diff`: Get git diff for range
- For `file`: Read specific file(s)
- For `repo`: Scan recent changes

Use Bash + Git commands to get:
- List of changed files
- Diffs with line numbers
- Full file contents where needed
- Test files (if they exist)

## Step 4: Infer intended behavior

From code, tests, spec, and context:

1. **What should this code do?**
   - Read function/class names
   - Read comments/docstrings
   - Read test names and assertions
   - Read spec requirements (if exists)

2. **What are the happy-path assumptions?**
   - Valid input formats
   - Expected state before operation
   - Expected state after operation
   - Success criteria

3. **What error conditions are expected?**
   - Invalid inputs
   - State conflicts
   - External failures (DB, API)
   - Resource exhaustion

## Step 5: Extract invariants

For each module/function/class, identify:

1. **Preconditions** (must be true before operation):
   - Example: "account must exist", "balance >= amount"
   - Look for: assertions, guard clauses, validation

2. **Postconditions** (must be true after operation):
   - Example: "record created in DB", "email sent"
   - Look for: return values, state changes, side effects

3. **Invariants** (must always be true):
   - Example: "password is hashed", "timestamps are UTC"
   - Look for: data constraints, consistency rules

4. **State machine** (if applicable):
   - Valid states
   - Valid transitions
   - Terminal states

## Step 6: Scan for correctness issues

For each checklist category, scan changed code:

### Input Validation Scan
- Find function entry points
- Check for validation before use
- Look for unsafe coercions (parseInt, JSON.parse, type casts)
- Check regex/parsing error handling

### State Transition Scan
- Find state-changing operations
- Check for state guards before updates
- Look for partial updates (some fields change, others don't)
- Check initialization order

### Error Handling Scan
- Find try/catch, .catch(), error returns
- Check if errors are logged/returned/handled
- Look for missing cleanup (finally blocks, defer)
- Check error types are appropriate

### Idempotency Scan
- Find create/insert/send operations
- Check for duplicate detection
- Look for missing unique constraints
- Check retry logic

### Boundary Condition Scan
- Find array access, division, parsing
- Check for empty/null/max size handling
- Look for off-by-one errors
- Check time/date handling

### Determinism Scan
- Find Date.now(), Math.random(), process.env
- Check if non-determinism affects correctness
- Look for ordering assumptions

### Concurrency Scan
- Find shared state (globals, class fields)
- Check for synchronization (locks, atomics)
- Look for async operations without await
- Check for promise rejection handling

### API Contract Scan
- Find public APIs (exports, routes)
- Check for breaking changes
- Look for missing validation
- Check error response consistency

## Step 7: Assess each finding

For each issue found:

1. **Severity**:
   - BLOCKER: Data corruption, security hole, crashes
   - HIGH: Incorrect behavior in common cases
   - MED: Incorrect behavior in edge cases
   - LOW: Potential issue, needs verification
   - NIT: Best practice, not correctness

2. **Confidence**:
   - High: Clear bug, can provide failing input
   - Med: Likely bug, but context may justify
   - Low: Speculative, needs deeper analysis

3. **Evidence**:
   - File path + line range
   - Code snippet showing issue
   - Failing input/state (concrete example)

4. **Failure scenario**:
   - What input causes failure?
   - What state causes failure?
   - What's the symptom? (crash, wrong result, data loss)

5. **Fix**:
   - Smallest fix that handles edge case
   - Patch suggestion (diff format for HIGH+)
   - Alternative: Larger refactor if needed

6. **Invariant violated**:
   - Which precondition/postcondition/invariant is broken?

## Step 8: Generate review report

Create `.claude/<SESSION_SLUG>/reviews/review-correctness-{YYYY-MM-DD}.md`

## Step 9: Update session README

Standard artifact tracking update.

## Step 10: Output summary

Print summary with merge recommendation and critical issues.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-correctness-{YYYY-MM-DD}.md`:

```markdown
---
command: /review:correctness
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

# Correctness Review Report

**Reviewed:** {SCOPE} / {TARGET}
**Date:** {YYYY-MM-DD}
**Reviewer:** Claude Code

---

## 0) Scope, Intent, and Invariants

**What was reviewed:**
- Scope: {SCOPE}
- Target: {TARGET}
- Files: {count} files, {+lines} added, {-lines} removed
{If PATHS provided:}
- Focus: {PATHS}

**Intended behavior:**
{From CONTEXT, spec, or inferred from code/tests}
- {Behavior 1}
- {Behavior 2}
- {Behavior 3}

**Must-hold invariants:**
1. **{Invariant 1}** - {Why it matters}
   - Example: "User balance must be >= 0 at all times"
2. **{Invariant 2}** - {Why it matters}
   - Example: "Emails must be unique across all users"
3. **{Invariant 3}** - {Why it matters}
   - Example: "Order status: pending → processing → completed (never reverses)"

**Key constraints:**
- {Constraint 1 - e.g., "Max file size: 10MB"}
- {Constraint 2 - e.g., "Idempotent operations required"}
- {Constraint 3 - e.g., "UTC timestamps only"}

**Known edge cases:**
{From CONTEXT or spec}
- {Edge case 1 - e.g., "Empty CSV files"}
- {Edge case 2 - e.g., "Duplicate email addresses"}

---

## 1) Executive Summary

**Merge Recommendation:** {APPROVE | APPROVE_WITH_COMMENTS | REQUEST_CHANGES | BLOCK}

**Rationale:**
{2-3 sentences explaining recommendation}

**Critical Issues (BLOCKER/HIGH):**
1. **{Finding ID}**: {Title} - {One-line description of failure}
2. **{Finding ID}**: {Title} - {One-line description of failure}
3. **{Finding ID}**: {Title} - {One-line description of failure}

**Overall Assessment:**
- Correctness: {Excellent | Good | Concerning | Poor}
- Error Handling: {Robust | Adequate | Missing | Broken}
- Edge Case Coverage: {Comprehensive | Good | Incomplete | Missing}
- Invariant Safety: {Protected | Mostly Safe | Vulnerable | Broken}

---

## 2) Findings Table

| ID | Severity | Confidence | Category | File:Line | Failure Scenario |
|----|----------|------------|----------|-----------|------------------|
| CR-1 | HIGH | High | Input Validation | `upload.ts:45` | Large file → OOM crash |
| CR-2 | HIGH | Med | Idempotency | `process.ts:120` | Retry → duplicate records |
| CR-3 | MED | High | Error Handling | `api.ts:80` | DB error → 500 not 400 |
| CR-4 | LOW | Med | Boundary | `parse.ts:30` | Empty input → panic |

**Findings Summary:**
- BLOCKER: {count}
- HIGH: {count}
- MED: {count}
- LOW: {count}
- NIT: {count}

---

## 3) Findings (Detailed)

### CR-1: Missing File Size Validation → OOM Crash [HIGH]

**Location:** `src/upload/upload.ts:45-60`

**Invariant Violated:**
- "File size must be <= 10MB (MAX_FILE_SIZE)" - defined in spec
- No enforcement in code

**Evidence:**
```typescript
// Lines 45-50
async function uploadFile(file: File): Promise<UploadResult> {
  // No size check!
  const buffer = await file.arrayBuffer(); // OOM if file is 1GB
  return processBuffer(buffer);
}

// Line 10 - Config exists but unused
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
```

**Failure Scenario:**
```javascript
// Input: 1GB file
const hugeFile = new File([new ArrayBuffer(1_000_000_000)], 'huge.csv');
await uploadFile(hugeFile); // ❌ OOM crash, process dies
```

**Impact:**
- Process crash (OOM)
- No error returned to user
- Other requests killed
- Data loss if mid-transaction

**Severity:** HIGH
**Confidence:** High
**Category:** Input Validation + Resource Exhaustion

**Smallest Fix:**
Add size check before reading:

```diff
--- a/src/upload/upload.ts
+++ b/src/upload/upload.ts
@@ -43,6 +43,10 @@
 async function uploadFile(file: File): Promise<UploadResult> {
+  if (file.size > MAX_FILE_SIZE) {
+    throw new ValidationError(`File too large: ${file.size} bytes (max: ${MAX_FILE_SIZE})`);
+  }
+
   const buffer = await file.arrayBuffer();
   return processBuffer(buffer);
 }
```

**Alternative (streaming):**
For large files, use streaming instead of loading entire file:
```typescript
async function uploadFile(file: File): Promise<UploadResult> {
  const stream = file.stream();
  return processStream(stream); // Process in chunks
}
```

**Test case:**
```typescript
test('rejects files larger than 10MB', async () => {
  const largeFile = new File([new ArrayBuffer(11 * 1024 * 1024)], 'large.csv');
  await expect(uploadFile(largeFile)).rejects.toThrow(ValidationError);
});
```

---

### CR-2: Non-Idempotent Insert → Duplicate Records on Retry [HIGH]

**Location:** `src/services/process.ts:120-135`

**Invariant Violated:**
- "Email addresses must be unique across all users" - DB constraint exists
- "Operations must be idempotent" - plan requirement for error recovery

**Evidence:**
```typescript
// Lines 120-125
async function createUser(email: string, name: string): Promise<User> {
  // No duplicate check!
  const user = await db.users.insert({ email, name });
  await sendWelcomeEmail(email); // Side effect
  return user;
}

// Lines 130-135 - Retry logic
async function createUserWithRetry(email: string, name: string): Promise<User> {
  return retry(() => createUser(email, name), { attempts: 3 });
  // ❌ On retry, email might be sent multiple times
}
```

**Failure Scenario:**
```javascript
// Attempt 1: Insert succeeds, email sending fails
await createUser('user@example.com', 'Alice');
// DB: ✅ User created
// Email: ❌ Network timeout

// Attempt 2 (retry): Insert fails (unique constraint)
// ❌ Throws duplicate key error instead of returning existing user
// User sees error even though they were created successfully
```

**Impact:**
- User sees error despite successful creation
- Duplicate emails sent on partial failures
- Retry logic broken
- Poor user experience

**Severity:** HIGH
**Confidence:** Med (depends on if DB has unique constraint)
**Category:** Idempotency + Error Handling

**Smallest Fix:**
Use "upsert" pattern (insert or return existing):

```diff
--- a/src/services/process.ts
+++ b/src/services/process.ts
@@ -118,9 +118,18 @@
 async function createUser(email: string, name: string): Promise<User> {
-  const user = await db.users.insert({ email, name });
-  await sendWelcomeEmail(email);
-  return user;
+  // Try to get existing user first
+  let user = await db.users.findByEmail(email);
+
+  if (!user) {
+    user = await db.users.insert({ email, name });
+  }
+
+  // Only send email if not already sent (check flag)
+  if (!user.welcomeEmailSent) {
+    await sendWelcomeEmail(email);
+    await db.users.update(user.id, { welcomeEmailSent: true });
+  }
+
+  return user;
 }
```

**Alternative (idempotency key):**
Use idempotency key pattern:
```typescript
async function createUser(email: string, name: string, idempotencyKey: string): Promise<User> {
  const existing = await db.idempotencyKeys.get(idempotencyKey);
  if (existing) return existing.result;

  const user = await db.users.insert({ email, name });
  await sendWelcomeEmail(email);

  await db.idempotencyKeys.set(idempotencyKey, { result: user });
  return user;
}
```

**Test case:**
```typescript
test('createUser is idempotent', async () => {
  const email = 'user@example.com';
  const user1 = await createUser(email, 'Alice');
  const user2 = await createUser(email, 'Alice'); // Should not throw
  expect(user1.id).toBe(user2.id);
});
```

---

### CR-3: Wrong Error Status Code [MED]

**Location:** `src/api/routes.ts:80-90`

**Invariant Violated:**
- "Return 400 for client errors, 500 for server errors" - API contract

**Evidence:**
```typescript
// Lines 80-90
app.post('/upload', async (req, res) => {
  try {
    const result = await uploadFile(req.file);
    res.json(result);
  } catch (error) {
    // ❌ All errors return 500
    res.status(500).json({ error: error.message });
  }
});
```

**Failure Scenario:**
```javascript
// Client sends invalid file type
POST /upload
Content-Type: application/json (wrong! should be multipart/form-data)

// Response:
500 Internal Server Error // ❌ Should be 400 Bad Request
{ "error": "req.file is undefined" }
```

**Impact:**
- Client thinks server is broken (500) when it's client error (400)
- Monitoring alerts fire incorrectly
- Retry logic retries 400s (shouldn't retry)
- Poor observability

**Severity:** MED
**Confidence:** High
**Category:** Error Handling + API Contract

**Smallest Fix:**
Distinguish client vs server errors:

```diff
--- a/src/api/routes.ts
+++ b/src/api/routes.ts
@@ -78,10 +78,15 @@
 app.post('/upload', async (req, res) => {
   try {
     const result = await uploadFile(req.file);
     res.json(result);
   } catch (error) {
-    res.status(500).json({ error: error.message });
+    if (error instanceof ValidationError) {
+      res.status(400).json({ error: error.message });
+    } else if (error instanceof NotFoundError) {
+      res.status(404).json({ error: error.message });
+    } else {
+      res.status(500).json({ error: 'Internal server error' });
+    }
   }
 });
```

**Alternative (error middleware):**
Centralized error handling:
```typescript
app.use((error, req, res, next) => {
  if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
  if (error instanceof NotFoundError) return res.status(404).json({ error: error.message });
  res.status(500).json({ error: 'Internal server error' });
});
```

**Test case:**
```typescript
test('returns 400 for validation errors', async () => {
  const response = await request(app)
    .post('/upload')
    .send({}); // Missing file
  expect(response.status).toBe(400);
});
```

---

### CR-4: No Empty Input Handling [LOW]

**Location:** `src/lib/parse.ts:30-40`

**Invariant Violated:**
- "Parser should handle empty input gracefully" - implicit requirement

**Evidence:**
```typescript
// Lines 30-35
function parseRows(csv: string): Row[] {
  const lines = csv.split('\n');
  const header = lines[0].split(','); // ❌ lines[0] undefined if empty
  return lines.slice(1).map(line => {
    const values = line.split(',');
    return zipToObject(header, values);
  });
}
```

**Failure Scenario:**
```javascript
// Input: Empty string
const result = parseRows('');
// ❌ Crashes: Cannot read property 'split' of undefined
// lines = ['']
// header = lines[0] = ''
// header.split(',') = ['']
// Then zipToObject fails on empty data
```

**Impact:**
- Crash on empty file upload
- No error message to user
- Unexpected behavior

**Severity:** LOW (edge case, should be caught by file size check)
**Confidence:** Med
**Category:** Boundary Condition

**Smallest Fix:**
Add empty check:

```diff
--- a/src/lib/parse.ts
+++ b/src/lib/parse.ts
@@ -28,6 +28,10 @@
 function parseRows(csv: string): Row[] {
+  if (!csv || csv.trim().length === 0) {
+    return [];
+  }
+
   const lines = csv.split('\n');
   const header = lines[0].split(',');
   return lines.slice(1).map(line => {
```

**Alternative (fail fast):**
Throw error instead of returning empty:
```typescript
function parseRows(csv: string): Row[] {
  if (!csv || csv.trim().length === 0) {
    throw new ValidationError('CSV input cannot be empty');
  }
  // ...
}
```

**Test case:**
```typescript
test('handles empty input', () => {
  expect(parseRows('')).toEqual([]);
  expect(parseRows('   ')).toEqual([]);
});
```

---

## 4) Invariants Coverage Analysis

Analysis of how well invariants are enforced:

| Invariant | Enforcement | Gaps |
|-----------|-------------|------|
| File size <= 10MB | ❌ Missing | CR-1: No size check |
| Emails are unique | ⚠️ Partial | CR-2: DB constraint exists, but retry broken |
| Order status transitions | ✅ Good | State machine enforced |
| UTC timestamps | ✅ Good | All timestamps use Date.UTC() |
| Idempotent operations | ❌ Missing | CR-2: No duplicate detection |

**Recommendations:**
1. Add validation layer before all DB operations
2. Implement idempotency key pattern for critical operations
3. Add invariant checks as assertions in tests

---

## 5) Edge Cases Coverage

| Edge Case | Handled? | Evidence |
|-----------|----------|----------|
| Empty file | ❌ No | CR-4: Parser crashes |
| Max file size | ❌ No | CR-1: No size check |
| Duplicate emails | ⚠️ Partial | CR-2: DB constraint but bad UX |
| Network timeout | ✅ Yes | Retry logic exists (but not idempotent) |
| Invalid CSV format | ✅ Yes | Parser throws error |
| Special characters in names | ✅ Yes | Parameterized queries prevent injection |

**Recommendations:**
1. Add explicit tests for all edge cases
2. Document expected behavior in edge cases
3. Add fuzzing tests for parsers

---

## 6) Error Handling Assessment

**Error Handling Patterns Found:**
- Try/catch with generic 500 responses (CR-3)
- Retry logic without idempotency (CR-2)
- Missing input validation (CR-1, CR-4)

**Good Practices:**
✅ Parameterized SQL queries (prevents injection)
✅ Error logging with context
✅ Timeout configuration on external calls

**Missing:**
❌ Error type discrimination (4xx vs 5xx)
❌ Cleanup on error paths (transactions not rolled back)
❌ Partial failure handling (batch operations)

**Recommendations:**
1. Create error hierarchy (ValidationError, NotFoundError, InternalError)
2. Add error middleware for consistent status codes
3. Add rollback logic for multi-step operations

---

## 7) Concurrency & Race Conditions

**Shared State:**
- Database connections: ✅ Pool managed correctly
- File uploads: ✅ Temp files use unique names
- Global config: ✅ Read-only after init

**Async Patterns:**
- Promise rejections: ⚠️ Some missing .catch()
- Concurrent operations: ✅ No problematic race conditions found

**Recommendations:**
1. Add unhandled rejection handler
2. Document thread-safety assumptions

---

## 8) Test Coverage Gaps

Based on findings, missing tests:

**Critical (should add):**
- [ ] Test file size > 10MB (CR-1)
- [ ] Test duplicate user creation (CR-2)
- [ ] Test empty CSV input (CR-4)
- [ ] Test retry idempotency (CR-2)

**Important (nice to have):**
- [ ] Test error status codes (CR-3)
- [ ] Test network timeout handling
- [ ] Test concurrent uploads

---

## 9) Recommendations

### Must Fix (BLOCKER/HIGH)

1. **CR-1**: Add file size validation
   - Action: Apply patch from CR-1
   - Rationale: Prevents OOM crashes
   - Estimated effort: 5 minutes

2. **CR-2**: Fix idempotency for user creation
   - Action: Apply patch from CR-2
   - Rationale: Prevents duplicate records and bad UX on retry
   - Estimated effort: 15 minutes

### Should Fix (MED)

3. **CR-3**: Fix error status codes
   - Action: Apply patch from CR-3
   - Rationale: Improves API contract compliance
   - Estimated effort: 10 minutes

### Consider (LOW/NIT)

4. **CR-4**: Handle empty input
   - Action: Apply patch from CR-4
   - Rationale: Better edge case handling
   - Estimated effort: 5 minutes

### Overall Strategy

**If time is limited:**
- Fix CR-1 and CR-2 (critical correctness issues)
- Ship the rest with known edge case gaps

**If time allows:**
- Fix CR-1, CR-2, CR-3 (all HIGH/MED)
- Add tests for fixed issues
- Consider CR-4 as cleanup

---

## 10) False Positives & Disagreements Welcome

**Where I might be wrong:**

1. **CR-2 (Idempotency)**: If retry logic is at HTTP layer (not in code), then idempotency might not be needed
2. **CR-4 (Empty input)**: If empty files are rejected earlier (file upload middleware), this might be unreachable
3. **Severity ratings**: Context may justify lower severity (e.g., if this is internal tool with trusted input)

**How to override my findings:**
- Show test coverage I missed
- Explain invariant I misunderstood
- Provide error handling that exists elsewhere

I'm optimizing for correctness. If there's a good reason the code is safe, let's discuss!

---

*Review completed: {YYYY-MM-DD}*
*Session: [{SESSION_SLUG}](../README.md)*
```

# SUMMARY OUTPUT

After creating review, print:

```markdown
# Correctness Review Complete

## Review Location
Saved to: `.claude/{SESSION_SLUG}/reviews/review-correctness-{YYYY-MM-DD}.md`

## Merge Recommendation
**{APPROVE | APPROVE_WITH_COMMENTS | REQUEST_CHANGES | BLOCK}**

## Critical Issues
1. **{Finding ID}**: {Failure scenario} - {Severity}
2. **{Finding ID}**: {Failure scenario} - {Severity}
3. **{Finding ID}**: {Failure scenario} - {Severity}

## Statistics
- Files reviewed: {count}
- Lines changed: +{added} -{removed}
- Findings: BLOCKER: {X}, HIGH: {X}, MED: {X}, LOW: {X}, NIT: {X}
- Invariants checked: {X} total, {Y} protected, {Z} vulnerable

## Invariants at Risk
{If any invariants are violated:}
- {Invariant 1}: Violated by {Finding ID}
- {Invariant 2}: Violated by {Finding ID}

## Quick Actions
{If HIGH+ findings exist:}
Apply patches from findings: CR-1, CR-2
Estimated fix time: {X} minutes

{If no HIGH findings:}
Minor edge cases found but not blocking.

## Next Steps
{If REQUEST_CHANGES:}
1. Fix HIGH severity findings (data corruption/crashes)
2. Add tests for edge cases
3. Re-run review after fixes

{If APPROVE_WITH_COMMENTS:}
1. Consider addressing MED severity findings
2. Add tests for edge cases
3. OK to merge as-is

## Test Coverage Gaps
{List critical missing tests}
```

# IMPORTANT: Be Concrete

This review should provide:
- **Concrete failure scenarios**: Exact input that causes failure
- **Evidence-based findings**: File:line + code snippets
- **Actionable fixes**: Patches that can be applied immediately
- **Clear severity**: Based on impact, not theoretical concerns
- **Invariants explicit**: What MUST hold true

The goal is to catch bugs before production, not to be pedantic about style.

# WHEN TO USE

Run `/review:correctness` when:
- Implementing critical logic (auth, payments, data mutations)
- After bug fixes (verify edge cases are handled)
- Before production deploys (catch crashes, data loss)
- When adding error handling or retry logic

This should be in the default review chain for all work types except `refactor` (where functionality shouldn't change).
