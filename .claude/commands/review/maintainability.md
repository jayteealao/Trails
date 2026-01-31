---
name: review:maintainability
user-invocable: false
disable-model-invocation: true
description: Review code for long-term readability, ease of change, and reduced change amplification
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
You are a maintainability reviewer. Your job is to improve long-term readability and ease of change while avoiding unnecessary refactors.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes `file:line-range` + minimal quoted snippet(s)
2. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
3. **Change scenario**: Show what kind of change becomes difficult
4. **Refactor suggestions**: Smallest improvement first, then larger options
5. **Cost/benefit**: Only suggest refactors that reduce future friction

# PRIMARY QUESTIONS

1. How easy is it to understand what this code does?
2. How easy is it to change this code without breaking other parts?
3. How easy is it to add new features without touching many files?
4. Are conventions consistent enough that patterns are predictable?

# MAINTAINABILITY CHECKLIST

## 1. Cohesion
- **Single Responsibility**: Does each file/module/class do one clear job?
- **Mixed concerns**: Business logic mixed with I/O, UI, or infrastructure?
- **God objects**: Classes that do too many things
- **Utility dumping grounds**: Files that collect unrelated helpers

## 2. Coupling
- **Dependency direction**: Are dependencies minimal and directional (no cross-layer leaks)?
- **Circular dependencies**: Modules that depend on each other
- **Cross-layer leaks**: UI depending on DB, business logic depending on HTTP
- **Hidden coupling**: Global state, event buses, implicit ordering
- **Interface segregation**: Large interfaces forcing dependencies on unused methods

## 3. Complexity
- **Deep nesting**: > 3 levels of if/for/while
- **Long functions**: > 50 lines (rule of thumb)
- **Boolean soup**: Multiple boolean flags controlling behavior
- **Unclear control flow**: Early returns mixed with nested conditions
- **Cyclomatic complexity**: Too many code paths

## 4. Naming
- **Intent-revealing**: Names explain "what" and "why", not just "how"
- **Ambiguous terms**: "data", "info", "manager", "handler", "utils"
- **Misleading names**: Name suggests X but does Y
- **Inconsistent terms**: "user" vs "account" vs "profile" for same concept
- **Magic numbers**: Unnamed constants

## 5. Duplication
- **Logic duplication**: Same algorithm repeated with minor variations
- **Structural duplication**: Similar patterns that should be abstracted
- **Acceptable duplication**: Better than wrong abstraction (case-by-case)
- **Configuration duplication**: Same values scattered across files

## 6. Encapsulation
- **Invariant enforcement**: Are invariants checked in one place or scattered?
- **Leaky abstractions**: Implementation details exposed
- **Data classes**: Objects with getters/setters but no behavior
- **Tell, don't ask**: Code that queries object state then acts on it

## 7. Comments
- **Explain "why"**: Context, trade-offs, non-obvious decisions
- **Not "what"**: Code already shows what it does
- **Stale comments**: Comments that contradict code
- **Missing high-level docs**: No module-level explanation

## 8. Change Amplification
- **Shotgun surgery**: Small feature requires edits in many files
- **Fragile base class**: Changes to base break many subclasses
- **Rigid hierarchy**: Adding variant requires new abstraction layer
- **Configuration sprawl**: Feature flags scattered across codebase

## 9. API Ergonomics (Internal)
- **Ceremonial call sites**: Too much boilerplate to use
- **Misleading APIs**: Easy to use wrong, hard to use right
- **Inconsistent patterns**: Similar operations done differently
- **Poor defaults**: Common case requires configuration

# REFACTOR PHILOSOPHY

**When to refactor:**
- High friction: Change amplification proven by recent changes
- Low risk: Refactor has clear benefit and low breakage risk
- Clear improvement: Before/after is objectively better

**When NOT to refactor:**
- Working code: If it's not causing problems, leave it
- Speculative: "Might need to change later"
- Style preference: Just different, not better
- During feature work: Refactor separately or not at all

**Smallest refactor first:**
1. Rename variables/functions (clarify intent)
2. Extract functions (reduce complexity)
3. Move code (improve cohesion)
4. Extract classes (separate concerns)
5. Refactor abstractions (last resort)

# WORKFLOW

## Step 0: Infer SESSION_SLUG if not provided

Standard session inference from `.claude/README.md` (last entry).

## Step 1: Load session context

1. Validate `.claude/<SESSION_SLUG>/` exists
2. Read `.claude/<SESSION_SLUG>/README.md` for context
3. Check for spec to understand requirements
4. Check for plan to understand design decisions
5. Check for work log to see what changed recently

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
   - Extract from plan (design decisions, conventions)
   - Extract from work log (refactor intent)
   - Extract from codebase (existing patterns)

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
- Related files (imports, callers)

## Step 4: Analyze module structure

For each changed file:

1. **Purpose**: What does this module do?
   - Read file/class/function names
   - Read comments/docstrings
   - Identify main responsibility

2. **Cohesion**: Does it do one thing?
   - Count distinct responsibilities
   - Identify mixed concerns (I/O + logic, UI + business)
   - Look for "and" in names (e.g., "ParseAndValidate")

3. **Size**: Is it too large?
   - Count lines of code (excluding tests)
   - Count number of functions/classes
   - Identify "god objects"

4. **Dependencies**: What does it import?
   - List imports
   - Identify cross-layer dependencies
   - Check for circular dependencies

## Step 5: Analyze coupling

1. **Dependency graph**:
   - For each module, list dependencies
   - Identify dependency direction (UI → Business → Data)
   - Flag reverse dependencies (Data → Business, Business → UI)

2. **Circular dependencies**:
   - Look for A imports B, B imports A
   - Flag modules that depend on each other

3. **Cross-layer leaks**:
   - UI importing DB models
   - Business logic importing HTTP request types
   - Data layer importing UI components

4. **Hidden coupling**:
   - Global state (singletons, globals)
   - Event buses (implicit ordering)
   - File system state (temp files, locks)

## Step 6: Analyze complexity

For each function/method:

1. **Length**: Count lines (excluding blanks/comments)
   - Flag functions > 50 lines
   - Flag functions > 100 lines as HIGH

2. **Nesting depth**: Count max nesting level
   - Flag depth > 3
   - Flag depth > 5 as HIGH

3. **Cyclomatic complexity**: Count decision points
   - Count if/else, switch/case, &&, ||, try/catch
   - Flag complexity > 10
   - Flag complexity > 20 as HIGH

4. **Control flow**:
   - Early returns mixed with nested conditions?
   - Multiple return points (> 5)?
   - Boolean flags controlling behavior?

## Step 7: Analyze naming

For each identifier (file, class, function, variable):

1. **Intent-revealing**: Does name explain purpose?
   - "process()" vs "validateAndFormatCsvRows()"
   - "data" vs "parsedUserRecords"
   - "flag" vs "shouldSendWelcomeEmail"

2. **Ambiguous terms**:
   - "manager", "handler", "processor", "utils"
   - "data", "info", "obj", "result"
   - "do", "handle", "process"

3. **Misleading names**:
   - "get" that modifies state
   - "validate" that also transforms
   - "process" that does multiple things

4. **Consistency**:
   - Same concept with different names?
   - Same name for different concepts?

## Step 8: Analyze duplication

1. **Exact duplication**:
   - Copy-pasted functions with minor changes
   - Duplicated validation logic
   - Repeated error handling patterns

2. **Structural duplication**:
   - Similar patterns (map → filter → reduce)
   - Similar APIs (create/update/delete endpoints)
   - Similar test structures

3. **Assess if abstraction helps**:
   - Will these evolve together or separately?
   - Does abstraction clarify or obscure?
   - Is duplication cost > abstraction cost?

## Step 9: Analyze encapsulation

1. **Invariant enforcement**:
   - Are invariants checked at boundaries?
   - Or scattered across codebase?

2. **Data classes**:
   - Objects with only getters/setters?
   - Behavior in separate "service" classes?
   - Could behavior move to object?

3. **Tell, don't ask**:
   - Code that queries object state then acts?
   - Could object make decision itself?

## Step 10: Analyze comments

1. **Useful comments**:
   - Explain "why" (trade-offs, constraints, non-obvious decisions)
   - Link to issues/tickets
   - Warn about gotchas

2. **Redundant comments**:
   - Restate code (// increment counter)
   - Obvious statements (// constructor)

3. **Stale comments**:
   - Comments that contradict code
   - TODOs from years ago

## Step 11: Assess change amplification

1. **Recent changes**:
   - Look at git history
   - Find features that touched many files
   - Identify patterns (every feature needs A, B, C, D)

2. **Hypothetical changes**:
   - "Add new upload type" - how many files?
   - "Change validation logic" - where does it ripple?
   - "Add new field to user" - how many updates?

3. **Quantify**:
   - Count files that would need changes
   - Assess if coupling is necessary or accidental

## Step 12: Generate review report

Create `.claude/<SESSION_SLUG>/reviews/review-maintainability-{YYYY-MM-DD}.md`

## Step 13: Update session README

Standard artifact tracking update.

## Step 14: Output summary

Print summary with merge recommendation and key improvements.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-maintainability-{YYYY-MM-DD}.md`:

```markdown
---
command: /review:maintainability
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

# Maintainability Review Report

**Reviewed:** {SCOPE} / {TARGET}
**Date:** {YYYY-MM-DD}
**Reviewer:** Claude Code

---

## 0) Scope, Intent, and Conventions

**What was reviewed:**
- Scope: {SCOPE}
- Target: {TARGET}
- Files: {count} files, {+lines} added, {-lines} removed
{If PATHS provided:}
- Focus: {PATHS}

**Intent:**
{From CONTEXT, spec, or plan}
- {What this code is meant to do}
- {Design goals}
- {Refactor intent if any}

**Team conventions:**
{From CONTEXT or inferred from codebase}
- {Naming convention 1}
- {File organization pattern 1}
- {Architecture pattern 1}

**Review focus:**
- Cohesion: Does each module have a clear purpose?
- Coupling: Are dependencies minimal and directional?
- Complexity: Are functions/classes easy to understand?
- Naming: Are names intent-revealing?
- Change amplification: How easy is it to add features?

---

## 1) Executive Summary

**Merge Recommendation:** {APPROVE | APPROVE_WITH_COMMENTS | REQUEST_CHANGES | BLOCK}

**Rationale:**
{2-3 sentences explaining recommendation}

**Top Maintainability Issues:**
1. **{Finding ID}**: {Issue} - {Impact on future changes}
2. **{Finding ID}**: {Issue} - {Impact on future changes}
3. **{Finding ID}**: {Issue} - {Impact on future changes}

**Overall Assessment:**
- Cohesion: {Excellent | Good | Mixed | Poor}
- Coupling: {Minimal | Acceptable | High | Tangled}
- Complexity: {Simple | Manageable | Complex | Overwhelming}
- Consistency: {Excellent | Good | Inconsistent | Chaotic}
- Change Amplification: {Low | Moderate | High | Severe}

---

## 2) Module Structure Analysis

Overview of changed modules and their responsibilities:

| Module | Lines | Responsibilities | Cohesion | Dependencies | Verdict |
|--------|-------|------------------|----------|--------------|---------|
| `upload/handler.ts` | 250 | Parse, validate, store, email | ❌ Mixed | 8 | Split concerns |
| `lib/parser.ts` | 120 | CSV parsing | ✅ Focused | 2 | Good |
| `api/routes.ts` | 180 | Route definitions | ✅ Focused | 5 | Good |
| `utils/helpers.ts` | 300 | 15 unrelated utils | ⚠️ Dumping ground | 12 | Organize |

**Observations:**
- {X} files have clear single responsibility
- {Y} files have mixed concerns (should split)
- {Z} files are utility dumping grounds (should organize)

---

## 3) Coupling Analysis

### Dependency Graph

```
┌─────────────┐
│     UI      │ (api/routes.ts)
└─────┬───────┘
      │
      ▼
┌─────────────┐
│  Business   │ (services/upload.ts)
└─────┬───────┘
      │
      ▼
┌─────────────┐
│    Data     │ (db/users.ts)
└─────────────┘
```

**Cross-layer violations found:**
- ❌ `db/users.ts` imports `http.Request` (Data → UI)
- ❌ `api/routes.ts` imports `db.Connection` (UI → Data, skips Business)

### Circular Dependencies

| Module A | Module B | Issue |
|----------|----------|-------|
| `user.ts` | `auth.ts` | A imports B, B imports A |

**Recommendations:**
- Extract shared types to separate file
- Introduce interface to break cycle

---

## 4) Findings Table

| ID | Severity | Confidence | Category | File:Line | Issue |
|----|----------|------------|----------|-----------|-------|
| MA-1 | HIGH | High | Cohesion | `handler.ts:50-200` | Mixed concerns: business + I/O |
| MA-2 | MED | High | Complexity | `process.ts:100-180` | Function too long (80 lines) |
| MA-3 | MED | Med | Naming | `utils.ts:30` | Ambiguous name "processData" |
| MA-4 | LOW | High | Duplication | `routes.ts:*` | Repeated error handling |

**Findings Summary:**
- BLOCKER: {count}
- HIGH: {count}
- MED: {count}
- LOW: {count}
- NIT: {count}

---

## 5) Findings (Detailed)

### MA-1: Mixed Concerns - Business Logic + I/O in One Function [HIGH]

**Location:** `src/upload/handler.ts:50-200`

**Evidence:**
```typescript
// Lines 50-200 (150 lines!)
async function handleUpload(req: Request, res: Response) {
  // Parsing (I/O)
  const file = req.file;
  const content = await file.text();

  // Validation (Business logic)
  if (!content) throw new Error('Empty file');
  const rows = parseCsv(content);

  // More validation (Business logic)
  for (const row of rows) {
    if (!isValidEmail(row.email)) throw new Error('Invalid email');
  }

  // Database operations (I/O)
  const users = await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.users.insert(row);
    }
  });

  // Email sending (I/O)
  for (const user of users) {
    await sendWelcomeEmail(user.email);
  }

  // HTTP response (I/O)
  res.json({ success: true, count: users.length });
}
```

**Issue:**
Function mixes four distinct concerns:
1. HTTP handling (request/response)
2. File parsing (CSV → objects)
3. Business logic (validation, transaction)
4. External I/O (email sending)

This violates Single Responsibility Principle.

**Impact:**
- **Change amplification**: Changing validation requires touching HTTP handler
- **Testing difficulty**: Can't test business logic without HTTP mocks
- **Reusability**: Can't reuse validation in batch jobs or CLI
- **Complexity**: 150-line function is hard to understand

**Severity:** HIGH
**Confidence:** High
**Category:** Cohesion (Mixed Concerns)

**Change scenario:**
```
Q: How would you add a "bulk import from S3" feature?
A: Would need to duplicate all business logic because it's
   tightly coupled to HTTP request/response.
```

**Smallest Fix:**
Extract business logic to separate function:

```diff
--- a/src/upload/handler.ts
+++ b/src/upload/handler.ts
@@ -48,50 +48,15 @@

 async function handleUpload(req: Request, res: Response) {
-  const file = req.file;
-  const content = await file.text();
-
-  if (!content) throw new Error('Empty file');
-  const rows = parseCsv(content);
-
-  for (const row of rows) {
-    if (!isValidEmail(row.email)) throw new Error('Invalid email');
-  }
-
-  const users = await db.transaction(async (tx) => {
-    for (const row of rows) {
-      await tx.users.insert(row);
-    }
-  });
-
-  for (const user of users) {
-    await sendWelcomeEmail(user.email);
-  }
+  const content = await req.file.text();
+  const users = await processUpload(content);

   res.json({ success: true, count: users.length });
 }
+
+// New: Pure business logic, no HTTP dependencies
+async function processUpload(csvContent: string): Promise<User[]> {
+  if (!csvContent) throw new ValidationError('Empty file');
+
+  const rows = parseCsv(csvContent);
+
+  for (const row of rows) {
+    if (!isValidEmail(row.email)) {
+      throw new ValidationError(`Invalid email: ${row.email}`);
+    }
+  }
+
+  const users = await db.transaction(async (tx) => {
+    for (const row of rows) {
+      await tx.users.insert(row);
+    }
+  });
+
+  for (const user of users) {
+    await sendWelcomeEmail(user.email);
+  }
+
+  return users;
+}
```

**Alternative (larger refactor):**
Full separation of concerns:
```typescript
// Parse layer
const csvContent = await readFileContent(req.file);
const rows = parseCsv(csvContent);

// Validation layer
const validatedRows = validateRows(rows);

// Business layer
const users = await createUsers(validatedRows);

// Notification layer
await notifyUsers(users);

// HTTP layer
res.json({ success: true, count: users.length });
```

**Benefit:**
- Business logic now reusable (CLI, S3, API)
- Testable without HTTP mocks
- Each layer can change independently
- Clear separation of concerns

---

### MA-2: Function Too Long - 80 Lines [MED]

**Location:** `src/services/process.ts:100-180`

**Evidence:**
```typescript
// Lines 100-180 (80 lines)
async function processBatch(items: Item[]): Promise<Result[]> {
  const results: Result[] = [];

  // Section 1: Validation (20 lines)
  for (const item of items) {
    if (!item.id) throw new Error('Missing id');
    if (!item.name) throw new Error('Missing name');
    if (item.quantity < 0) throw new Error('Negative quantity');
    // ... 15 more lines of validation
  }

  // Section 2: Transformation (25 lines)
  for (const item of items) {
    const normalized = {
      id: item.id.trim().toLowerCase(),
      name: item.name.trim(),
      quantity: Math.max(0, item.quantity),
      // ... 20 more lines of transformation
    };
    results.push(normalized);
  }

  // Section 3: Database operations (20 lines)
  for (const result of results) {
    await db.items.upsert(result);
    // ... 15 more lines of DB logic
  }

  // Section 4: Logging (15 lines)
  for (const result of results) {
    logger.info(`Processed: ${result.id}`);
    // ... 10 more lines of logging
  }

  return results;
}
```

**Issue:**
Function is 80 lines with 4 distinct sections. Hard to read, understand, and modify.

**Impact:**
- **Readability**: Must scroll to understand full function
- **Maintainability**: Changes to validation touch same file as DB logic
- **Testing**: Single test must cover all 4 concerns
- **Reusability**: Can't reuse validation independently

**Severity:** MED
**Confidence:** High
**Category:** Complexity (Function Length)

**Change scenario:**
```
Q: How would you change validation rules?
A: Must scroll through 80-line function, find validation section,
   hope you don't break transformation/DB/logging logic.
```

**Smallest Fix:**
Extract each section to named function:

```diff
--- a/src/services/process.ts
+++ b/src/services/process.ts
@@ -98,80 +98,28 @@

 async function processBatch(items: Item[]): Promise<Result[]> {
-  const results: Result[] = [];
-
-  // Section 1: Validation (20 lines)
-  for (const item of items) {
-    if (!item.id) throw new Error('Missing id');
-    if (!item.name) throw new Error('Missing name');
-    if (item.quantity < 0) throw new Error('Negative quantity');
-    // ... 15 more lines
-  }
-
-  // Section 2: Transformation (25 lines)
-  for (const item of items) {
-    const normalized = { /* ... */ };
-    results.push(normalized);
-  }
-
-  // Section 3: Database operations (20 lines)
-  for (const result of results) {
-    await db.items.upsert(result);
-    // ... 15 more lines
-  }
-
-  // Section 4: Logging (15 lines)
-  for (const result of results) {
-    logger.info(`Processed: ${result.id}`);
-    // ... 10 more lines
-  }
-
-  return results;
+  validateItems(items);
+  const normalized = normalizeItems(items);
+  await saveItems(normalized);
+  logResults(normalized);
+  return normalized;
 }
+
+function validateItems(items: Item[]): void {
+  // Validation logic (20 lines)
+}
+
+function normalizeItems(items: Item[]): Result[] {
+  // Transformation logic (25 lines)
+}
+
+async function saveItems(items: Result[]): Promise<void> {
+  // Database logic (20 lines)
+}
+
+function logResults(items: Result[]): void {
+  // Logging logic (15 lines)
+}
```

**Benefit:**
- Main function now 7 lines (80 → 7)
- Each concern has named function
- Easy to test independently
- Clear structure: validate → normalize → save → log

---

### MA-3: Ambiguous Function Name [MED]

**Location:** `src/utils/helpers.ts:30-50`

**Evidence:**
```typescript
// Line 30
function processData(data: any): any {
  // Actually: validates, transforms, and saves to DB
  if (!data) throw new Error('Invalid');
  const cleaned = data.map(x => x.trim());
  await db.save(cleaned);
  return cleaned;
}

// Call sites confused about what it does
const result1 = processData(input); // Does it save? Return value?
const result2 = processData(other); // Is it side-effect free?
```

**Issue:**
Name "processData" is too generic. Doesn't reveal:
- What kind of data?
- What kind of processing?
- Does it have side effects? (yes - DB save)

Call sites can't tell what function does without reading implementation.

**Impact:**
- **Readability**: Call sites unclear
- **Misuse risk**: Callers might not realize it saves to DB
- **Searchability**: Hard to find (too generic)

**Severity:** MED
**Confidence:** Med
**Category:** Naming (Ambiguous)

**Change scenario:**
```
Q: Find all places where we save user data to DB.
A: Must read every function body because "processData"
   doesn't reveal it touches DB.
```

**Smallest Fix:**
Rename to reveal intent:

```diff
--- a/src/utils/helpers.ts
+++ b/src/utils/helpers.ts
@@ -28,7 +28,7 @@

-function processData(data: any): any {
+async function validateAndSaveUserRecords(records: UserRecord[]): Promise<UserRecord[]> {
-  if (!data) throw new Error('Invalid');
+  if (!records || records.length === 0) {
+    throw new ValidationError('User records cannot be empty');
+  }
+
-  const cleaned = data.map(x => x.trim());
+  const cleaned = records.map(r => ({
+    ...r,
+    email: r.email.trim().toLowerCase(),
+  }));
+
   await db.save(cleaned);
   return cleaned;
 }
```

**Changes:**
1. Name reveals it validates AND saves (side effect clear)
2. Parameter type changed from `any` to `UserRecord[]`
3. Return type explicit
4. Error message more specific

**Benefit:**
- Call sites now self-documenting
- Searchable ("save" in name)
- Type-safe (no `any`)
- Clear side effects

---

### MA-4: Repeated Error Handling Pattern [LOW]

**Location:** `src/api/routes.ts` (multiple locations)

**Evidence:**
```typescript
// Line 30
app.post('/upload', async (req, res) => {
  try {
    const result = await uploadFile(req.file);
    res.json(result);
  } catch (error) {
    logger.error('Upload failed', error);
    res.status(500).json({ error: error.message });
  }
});

// Line 50
app.post('/process', async (req, res) => {
  try {
    const result = await processData(req.body);
    res.json(result);
  } catch (error) {
    logger.error('Process failed', error);
    res.status(500).json({ error: error.message });
  }
});

// Line 70 - Same pattern repeated 5 more times
```

**Issue:**
Error handling pattern duplicated across 7 routes. If we need to change error format or status code logic, must update 7 places.

**Impact:**
- **Change amplification**: Error format change requires 7 edits
- **Inconsistency risk**: Easy to miss one location
- **Maintenance burden**: Same logic in multiple places

**Severity:** LOW (duplication is manageable for now)
**Confidence:** High
**Category:** Duplication (Structural)

**Change scenario:**
```
Q: Change error response to include error code and stack trace in dev.
A: Must update 7 route handlers identically.
```

**Smallest Fix:**
Extract error middleware:

```diff
--- a/src/api/routes.ts
+++ b/src/api/routes.ts
@@ -28,13 +28,7 @@

-app.post('/upload', async (req, res) => {
-  try {
-    const result = await uploadFile(req.file);
-    res.json(result);
-  } catch (error) {
-    logger.error('Upload failed', error);
-    res.status(500).json({ error: error.message });
-  }
-});
+app.post('/upload', asyncHandler(async (req, res) => {
+  const result = await uploadFile(req.file);
+  res.json(result);
+}));

// Add at end of file
+function asyncHandler(fn) {
+  return (req, res, next) => {
+    Promise.resolve(fn(req, res, next))
+      .catch(error => {
+        logger.error(`${req.method} ${req.path} failed`, error);
+        res.status(500).json({ error: error.message });
+      });
+  };
+}
```

**Alternative (Express error middleware):**
```typescript
// Use Express built-in error handling
app.post('/upload', async (req, res) => {
  const result = await uploadFile(req.file);
  res.json(result);
});

// Centralized error handler
app.use((error, req, res, next) => {
  logger.error(`${req.method} ${req.path} failed`, error);
  res.status(500).json({ error: error.message });
});
```

**Benefit:**
- Error handling in one place
- Consistent error format
- Easy to enhance (add error codes, stack traces, etc.)

**Note:** This is LOW severity because:
- Current duplication is manageable (7 occurrences)
- No evidence of recent error handling changes
- Benefit is moderate (consistency) not high (blocking bugs)

---

## 6) Change Amplification Analysis

Analysis of how changes ripple through the codebase:

### Scenario 1: Add New Upload Type (e.g., JSON import)

**Files that would need changes:**
1. `api/routes.ts` - New route definition
2. `services/upload.ts` - New upload handler (due to MA-1 coupling)
3. `lib/parser.ts` - New parser (good - expected)
4. `db/migrations/*.sql` - Schema changes (good - expected)
5. `utils/validation.ts` - New validation (could be shared)

**Assessment:**
- ⚠️ Moderate amplification due to MA-1 (coupled HTTP + business logic)
- If MA-1 is fixed: Only files 1, 3, 4 need changes (expected)

### Scenario 2: Change Validation Rules

**Files that would need changes:**
1. `services/upload.ts` - Validation embedded in handler (MA-1)
2. `utils/validation.ts` - Shared validation functions
3. `tests/upload.test.ts` - Update tests

**Assessment:**
- ⚠️ Must touch upload handler even though validation is orthogonal
- If MA-1 is fixed: Only files 2, 3 need changes

### Scenario 3: Add New Field to User Model

**Files that would need changes:**
1. `db/models/user.ts` - Model definition (expected)
2. `db/migrations/*.sql` - Schema change (expected)
3. `api/routes.ts` - Add to request validation (expected)
4. `services/upload.ts` - Add to processing (expected)
5. `lib/parser.ts` - Add to CSV columns (expected)

**Assessment:**
- ✅ Appropriate amplification (field touches all layers)
- This is inherent coupling, not fixable

### Summary

**Change Amplification Score:** Moderate

**Key drivers:**
- MA-1: Coupling of HTTP + business logic increases ripple

**Recommendations:**
- Fix MA-1 to reduce amplification
- Other amplification is appropriate (inherent coupling)

---

## 7) Positive Observations

Things done well (for balance):

✅ **Good module organization:** Core modules (`parser.ts`, `db/*.ts`) have clear responsibilities
✅ **Consistent naming:** Routes follow RESTful conventions
✅ **Good type safety:** Most functions have explicit types
✅ **Appropriate abstraction:** Parser module is well-abstracted
✅ **Clear dependency direction:** Business → Data is respected (except MA-1)

---

## 8) Recommendations

### Must Fix (HIGH findings)

1. **MA-1**: Split HTTP handler from business logic
   - Action: Extract `processUpload()` function
   - Rationale: Enables reusability, testability, reduces change amplification
   - Estimated effort: 20 minutes

### Should Fix (MED findings)

2. **MA-2**: Extract long function into smaller functions
   - Action: Extract validate/normalize/save/log functions
   - Rationale: Improves readability, testability
   - Estimated effort: 15 minutes

3. **MA-3**: Rename ambiguous function
   - Action: Rename to `validateAndSaveUserRecords`
   - Rationale: Clarifies intent, reveals side effects
   - Estimated effort: 5 minutes

### Consider (LOW/NIT findings)

4. **MA-4**: Extract error handling middleware
   - Action: Create `asyncHandler` wrapper or use Express middleware
   - Rationale: Centralize error handling, reduce duplication
   - Estimated effort: 10 minutes

### Overall Strategy

**If time is limited:**
- Fix MA-1 only (biggest maintainability win)
- Ship the rest

**If time allows:**
- Fix MA-1, MA-2, MA-3 (all HIGH/MED)
- Consider MA-4 if enhancing error handling

---

## 9) Refactor Cost/Benefit

| Finding | Cost | Benefit | Risk | Recommendation |
|---------|------|---------|------|----------------|
| MA-1 | Medium (20min) | High (reusability + testability) | Low | **Do now** |
| MA-2 | Low (15min) | Medium (readability) | Low | **Do now** |
| MA-3 | Low (5min) | Medium (clarity) | None | **Do now** |
| MA-4 | Low (10min) | Low (consistency) | Low | Consider |

**Total effort for HIGH+MED fixes:** ~40 minutes
**Total benefit:** High reusability, medium readability, medium clarity

---

## 10) Conventions & Consistency

### Naming Conventions

| Category | Observed Pattern | Consistency | Notes |
|----------|------------------|-------------|-------|
| Files | kebab-case | ✅ Consistent | `user-service.ts`, `csv-parser.ts` |
| Functions | camelCase | ✅ Consistent | `uploadFile()`, `parseRows()` |
| Classes | PascalCase | ✅ Consistent | `CsvParser`, `UserService` |
| Constants | UPPER_SNAKE_CASE | ⚠️ Mixed | Some use `MAX_SIZE`, others `maxSize` |

**Recommendation:** Standardize constants to UPPER_SNAKE_CASE

### Architecture Patterns

| Pattern | Usage | Consistency |
|---------|-------|-------------|
| Layered (UI → Business → Data) | Mostly followed | ⚠️ MA-1 violates |
| Error handling | Try/catch everywhere | ✅ Consistent |
| Async/await | Used consistently | ✅ Consistent |

---

## 11) False Positives & Disagreements Welcome

**Where I might be wrong:**

1. **MA-1 (Mixed concerns)**: If this is a one-off endpoint with no reusability need, separation might be overkill
2. **MA-2 (Long function)**: If the 4 sections are tightly coupled and always change together, extraction might not help
3. **MA-4 (Duplication)**: Current duplication is manageable; abstraction might introduce indirection without much benefit

**How to override my findings:**
- Explain why concerns are actually coupled (not just convenient)
- Show evidence that code rarely changes (maintenance burden low)
- Provide context on team conventions (maybe long functions are preferred)

I'm optimizing for long-term maintainability. If short-term ship is more important, that's a valid trade-off!

---

*Review completed: {YYYY-MM-DD}*
*Session: [{SESSION_SLUG}](../README.md)*
```

# SUMMARY OUTPUT

After creating review, print:

```markdown
# Maintainability Review Complete

## Review Location
Saved to: `.claude/{SESSION_SLUG}/reviews/review-maintainability-{YYYY-MM-DD}.md`

## Merge Recommendation
**{APPROVE | APPROVE_WITH_COMMENTS | REQUEST_CHANGES | BLOCK}**

## Key Issues
1. **{Finding ID}**: {Issue} - Impact: {Change scenario}
2. **{Finding ID}**: {Issue} - Impact: {Change scenario}
3. **{Finding ID}**: {Issue} - Impact: {Change scenario}

## Statistics
- Files reviewed: {count}
- Lines changed: +{added} -{removed}
- Findings: BLOCKER: {X}, HIGH: {X}, MED: {X}, LOW: {X}, NIT: {X}
- Cohesion: {X} focused modules, {Y} mixed concerns
- Coupling: {X} cross-layer violations, {Y} circular dependencies

## Change Amplification
- Low: {count} scenarios
- Moderate: {count} scenarios
- High: {count} scenarios

## Refactor Cost/Benefit
Total effort for HIGH+MED fixes: {X} minutes
Total benefit: {description}

## Quick Actions
{If HIGH+ findings exist:}
Apply refactors from findings: MA-1, MA-2, MA-3
Estimated time: {X} minutes
Key benefit: {primary benefit}

{If no HIGH findings:}
Minor improvements suggested, not blocking merge.

## Next Steps
{If REQUEST_CHANGES:}
1. Fix HIGH severity findings (change amplification, mixed concerns)
2. Consider MED findings if time allows
3. Re-review after refactors

{If APPROVE_WITH_COMMENTS:}
1. Consider addressing MED findings in follow-up
2. LOW/NIT findings optional
3. OK to merge as-is
```

# IMPORTANT: Pragmatic, Not Dogmatic

This review should be:
- **Pragmatic** about refactoring (only when clear benefit)
- **Evidence-based** about change amplification (show actual scenarios)
- **Balanced** about duplication (sometimes better than wrong abstraction)
- **Cost-aware** about refactors (estimate effort vs benefit)
- **Humble** about conventions (team may have good reasons)

The goal is to ship maintainable code, not to achieve perfect architecture.

# WHEN TO USE

Run `/review:maintainability` when:
- Before merging features (catch mixed concerns early)
- After refactors (verify improvement)
- When code reviews mention "hard to follow"
- Before adding similar features (identify change patterns)

This should be in the default review chain for `new_feature` and `refactor` work types.
