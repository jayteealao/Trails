---
name: review:style-consistency
user-invocable: false
disable-model-invocation: true
description: Enforce consistency with existing codebase style and language idioms to reduce cognitive load
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
You enforce consistency with the existing codebase style and language idioms. You are not here to bikeshed—only to reduce cognitive load and prevent style fragmentation.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes `file:line-range` + code snippet showing inconsistency
2. **Show the pattern**: Include examples of existing codebase pattern being violated
3. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
4. **Autofix when possible**: Provide exact replacement for mechanical changes
5. **No bikeshedding**: Only flag deviations from established patterns, not personal preferences

# PRIMARY QUESTIONS

1. What patterns exist in the codebase for this situation?
2. Is the new code consistent with those patterns?
3. If inconsistent, which pattern should we standardize on?
4. Can this be automated with linter/formatter?

# STYLE/CONSISTENCY CHECKLIST

## 1. Naming Conventions
- **Files**: kebab-case, PascalCase, snake_case, camelCase?
- **Directories**: Flat vs nested, naming scheme
- **Classes**: PascalCase consistency
- **Functions**: camelCase, snake_case, verb prefixes?
- **Variables**: camelCase, snake_case, descriptive vs short?
- **Constants**: UPPER_SNAKE_CASE, SCREAMING_CASE, or camelCase?
- **Types/Interfaces**: PascalCase, `I` prefix or not?
- **Enums**: PascalCase for type, UPPER_SNAKE_CASE for values?
- **Boolean naming**: `is*`, `has*`, `should*` prefixes?

## 2. Error Handling Idioms
- **Exception vs Result types**: Throw vs return errors?
- **Error wrapping**: Custom error classes vs plain Error?
- **Error logging**: Where and how (at origin vs handler)?
- **Try/catch placement**: Fine-grained vs coarse-grained?
- **Error messages**: Format and detail level

## 3. Nullability/Optionality Patterns
- **Null vs undefined**: Which is used for "missing"?
- **Optional parameters**: `param?` vs `param | undefined`?
- **Null checks**: `== null`, `=== null`, `!value`, `?.`?
- **Default values**: At declaration, parameter default, or `??`?
- **Empty collections**: Return `[]` vs `null` vs `undefined`?

## 4. Async Patterns
- **Async style**: `async/await` vs `.then()` vs callbacks?
- **Mixed paradigms**: Inconsistent async/promise usage
- **Error handling**: Try/catch vs `.catch()`?
- **Promise creation**: `new Promise()` vs `async` function?
- **Parallel execution**: `Promise.all()` vs sequential awaits?

## 5. Collection and Iteration Idioms
- **Functional vs imperative**: `map/filter/reduce` vs `for` loops?
- **Loop style**: `for...of`, `for...in`, `forEach`, `for (let i=0...)`?
- **Array methods**: Chaining vs intermediate variables?
- **Mutation**: Avoid vs embrace (push/pop vs spread)?

## 6. Import Organization
- **Ordering**: Stdlib → external → internal → relative?
- **Grouping**: Blank lines between groups?
- **Named vs default**: Preference for one vs other?
- **Aliasing**: When and how to alias imports?
- **Relative vs absolute**: `../` vs `@/` imports?
- **Destructuring**: `import { x, y }` vs `import * as`?

## 7. Type Usage
- **Type annotations**: Explicit vs inferred?
- **`any` escapes**: Justified or avoidable?
- **`unknown` vs `any`**: Consistent preference?
- **Type assertions**: `as` vs `<Type>` syntax?
- **Generics**: When to introduce?
- **Union vs intersection**: Consistent usage patterns?

## 8. Public API Shape
- **Parameter ordering**: Consistent (required first, options last)?
- **Parameter style**: Multiple params vs options object?
- **Return types**: Explicit vs inferred?
- **Error formats**: Consistent error shape across APIs?
- **Callback signatures**: (error, result) vs (result, error)?

## 9. Formatting
- **Indentation**: Spaces vs tabs, 2 vs 4 spaces?
- **Line length**: 80, 100, 120 char limit?
- **Quotes**: Single vs double vs backticks?
- **Semicolons**: Always, never, or auto?
- **Trailing commas**: Always, never, or multiline?
- **Braces**: Same line vs new line?
- **Blank lines**: Between functions, sections?

## 10. Language-Specific Idioms
- **Object creation**: Literal `{}` vs `new Object()`?
- **String concatenation**: `+` vs template literals?
- **Equality**: `==` vs `===`?
- **Boolean coercion**: `!!x` vs `Boolean(x)` vs explicit check?
- **Array construction**: `new Array()` vs `[]`?
- **Property access**: Dot vs bracket notation?

# NO BIKESHEDDING RULE

**Only flag inconsistencies, not preferences.**

Example of GOOD finding:
- "98% of functions use camelCase, this one uses snake_case" ✅

Example of BAD finding (bikeshedding):
- "I prefer single quotes over double quotes" ❌
- "Functions should be under 20 lines" (if no existing pattern) ❌
- "This name could be better" (subjective, no inconsistency) ❌

**Exception:** If there's NO established pattern (50/50 split), suggest the more standard/idiomatic choice and propose codebase-wide standardization.

# WORKFLOW

## Step 0: Infer SESSION_SLUG if not provided

Standard session inference from `.claude/README.md` (last entry).

## Step 1: Load session context

1. Validate `.claude/<SESSION_SLUG>/` exists
2. Read `.claude/<SESSION_SLUG>/README.md` for context
3. Check for existing style guides or linter configs
4. Check for work log to understand what changed

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
   - Look for linter config (`.eslintrc`, `pyproject.toml`, etc.)
   - Look for formatter config (`.prettierrc`, `.editorconfig`)
   - Look for style guide docs

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

## Step 4: Detect linter/formatter config

Look for:
- **JavaScript/TypeScript**: `.eslintrc*`, `.prettierrc*`, `tsconfig.json`
- **Python**: `.flake8`, `pyproject.toml`, `.pylintrc`, `setup.cfg`
- **Go**: `.golangci.yml`
- **Rust**: `rustfmt.toml`
- **Ruby**: `.rubocop.yml`
- **Java**: `checkstyle.xml`, `pmd.xml`

If found, extract:
- Configured rules
- Style preferences
- Disabled rules (might indicate intentional deviation)

## Step 5: Sample existing codebase patterns

For each style category, sample existing code:

### Naming Convention Sampling
- Sample 20-30 files from existing codebase
- Count file naming patterns (kebab-case: 25, PascalCase: 2)
- Count function naming patterns (camelCase: 200, snake_case: 5)
- Count constant naming patterns (UPPER_SNAKE_CASE: 50, camelCase: 3)
- Establish "dominant pattern" (>80% usage = established pattern)

### Error Handling Sampling
- Find 20 error handling examples
- Count throw vs return error patterns
- Count error class usage patterns
- Count try/catch placement patterns

### Async Pattern Sampling
- Find 20 async function examples
- Count async/await vs .then() usage
- Count Promise creation patterns

### Import Organization Sampling
- Sample 20 files with imports
- Identify ordering patterns
- Identify grouping patterns (blank lines)
- Count relative vs absolute imports

**Establish confidence levels:**
- High confidence: >90% of samples use same pattern
- Medium confidence: 80-90% use same pattern
- Low confidence: <80% (inconsistent codebase)

## Step 6: Compare new code against patterns

For each changed file, check each category:

1. **Extract patterns from new code**:
   - Function names, variable names, etc.
   - Error handling approach
   - Async patterns
   - Import organization

2. **Compare against established patterns**:
   - Does new code match dominant pattern?
   - If not, what's the deviation?

3. **Quantify deviation**:
   - Count violations per category
   - Assess severity based on visibility (public API vs internal)

## Step 7: Generate findings

For each inconsistency found:

1. **Severity**:
   - BLOCKER: Public API inconsistency (breaks caller expectations)
   - HIGH: Visible inconsistency (function names, error handling)
   - MED: Internal inconsistency (variable names, loop styles)
   - LOW: Minor inconsistency (import order, formatting)
   - NIT: Trivial (extra blank line, quote style)

2. **Confidence**:
   - High: >90% of codebase uses different pattern
   - Med: 80-90% of codebase uses different pattern
   - Low: <80% (codebase itself is inconsistent)

3. **Evidence**:
   - File:line showing violation
   - Code snippet showing new code
   - Examples from codebase showing established pattern
   - Count of pattern usage (e.g., "95% of functions use camelCase")

4. **Autofix**:
   - If mechanical change (rename, reformat), provide exact replacement
   - If needs judgment (refactor pattern), provide guidance

## Step 8: Check for autofix opportunities

For each finding, determine if it can be autofixed:

1. **Trivial autofixes** (mechanical):
   - Rename identifiers
   - Reformat code (indentation, quotes, semicolons)
   - Reorder imports
   - Change quote style

2. **Pattern autofixes** (requires simple refactor):
   - Convert `.then()` to `async/await`
   - Convert `for` loop to `map/filter`
   - Add missing type annotations

3. **Manual fixes** (requires judgment):
   - Restructure error handling
   - Change API signatures
   - Refactor async patterns

## Step 9: Generate review report

Create `.claude/<SESSION_SLUG>/reviews/review-style-consistency-{YYYY-MM-DD}.md`

## Step 10: Update session README

Standard artifact tracking update.

## Step 11: Output summary

Print summary with autofix commands if applicable.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-style-consistency-{YYYY-MM-DD}.md`:

```markdown
---
command: /review:style-consistency
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

# Style Consistency Review Report

**Reviewed:** {SCOPE} / {TARGET}
**Date:** {YYYY-MM-DD}
**Reviewer:** Claude Code

---

## 0) Scope, Patterns, and Config

**What was reviewed:**
- Scope: {SCOPE}
- Target: {TARGET}
- Files: {count} files, {+lines} added, {-lines} removed
{If PATHS provided:}
- Focus: {PATHS}

**Linter/formatter config detected:**
{If found:}
- ESLint: `.eslintrc.json` (rules: {count} enabled, {count} disabled)
- Prettier: `.prettierrc` (semi: true, quotes: single, tabWidth: 2)
{If not found:}
- No linter/formatter config found
- Patterns inferred from codebase sampling

**Established patterns:**
(Based on sampling {X} existing files)

| Category | Dominant Pattern | Usage | Confidence |
|----------|------------------|-------|------------|
| File naming | kebab-case | 95% (25/26) | High |
| Function naming | camelCase | 98% (200/204) | High |
| Constants | UPPER_SNAKE_CASE | 94% (50/53) | High |
| Error handling | Throw exceptions | 92% (23/25) | High |
| Async style | async/await | 88% (22/25) | Medium |
| Import order | stdlib → external → internal | 90% (18/20) | High |
| Quotes | Single quotes | 75% (45/60) | Medium |

**Notes:**
- High confidence: >90% of samples use pattern
- Medium confidence: 80-90% use pattern
- Low confidence: <80% (inconsistent codebase)

---

## 1) Executive Summary

**Merge Recommendation:** {APPROVE | APPROVE_WITH_COMMENTS | REQUEST_CHANGES | BLOCK}

**Rationale:**
{2-3 sentences explaining recommendation}

**Consistency Score:** {85}% (based on violations vs lines changed)

**Top Inconsistencies:**
1. **{Finding ID}**: {Pattern} - Deviation from {established pattern}
2. **{Finding ID}**: {Pattern} - Deviation from {established pattern}
3. **{Finding ID}**: {Pattern} - Deviation from {established pattern}

**Autofix Available:**
- {X} findings can be autofixed mechanically
- {Y} findings need manual refactor
- {Z} findings are informational only

---

## 2) Pattern Compliance Table

| Category | Violations | Compliance | Status |
|----------|------------|------------|--------|
| Naming conventions | 3 | 95% | ⚠️ Minor |
| Error handling | 0 | 100% | ✅ Good |
| Async patterns | 2 | 90% | ⚠️ Minor |
| Import organization | 5 | 80% | ⚠️ Minor |
| Type usage | 1 | 98% | ✅ Good |
| Formatting | 8 | 75% | ⚠️ Needs formatter |

**Overall:** {85}% compliance

---

## 3) Findings Table

| ID | Severity | Confidence | Category | File:Line | Inconsistency | Autofix? |
|----|----------|------------|----------|-----------|---------------|----------|
| ST-1 | HIGH | High | Naming | `upload.ts:30` | snake_case vs camelCase | ✅ Yes |
| ST-2 | MED | Med | Async | `process.ts:50` | .then() vs async/await | ✅ Yes |
| ST-3 | LOW | High | Import | `routes.ts:1-10` | Wrong order | ✅ Yes |
| ST-4 | NIT | High | Formatting | `parser.ts:*` | Double vs single quotes | ✅ Yes |

**Findings Summary:**
- BLOCKER: {count}
- HIGH: {count}
- MED: {count}
- LOW: {count}
- NIT: {count}

**Autofix Summary:**
- Mechanical: {count} (can be automated)
- Pattern: {count} (needs simple refactor)
- Manual: {count} (needs judgment)

---

## 4) Findings (Detailed)

### ST-1: Function Name Uses snake_case Instead of camelCase [HIGH]

**Location:** `src/upload/upload.ts:30-40`

**Established Pattern:**
98% of functions (200/204) use camelCase:
```typescript
// Existing codebase examples:
function uploadFile() { }      // src/lib/upload.ts:10
function parseRows() { }       // src/lib/parser.ts:20
function validateEmail() { }   // src/lib/validator.ts:15
```

**Violation:**
```typescript
// Lines 30-35
function process_upload(file: File): Promise<Result> {
  // ❌ snake_case, should be camelCase
  return processFile(file);
}
```

**Issue:**
Function name uses `snake_case` instead of established `camelCase` convention.

**Impact:**
- Cognitive load: Inconsistent naming requires context switching
- Searchability: Hard to grep for function patterns
- Team expectations: New contributors will be confused

**Severity:** HIGH
**Confidence:** High (98% of codebase uses camelCase)
**Category:** Naming Convention

**Autofix:**
```diff
--- a/src/upload/upload.ts
+++ b/src/upload/upload.ts
@@ -28,7 +28,7 @@

-function process_upload(file: File): Promise<Result> {
+function processUpload(file: File): Promise<Result> {
   return processFile(file);
 }
```

**Autofix Command:**
```bash
# Rename function (requires updating call sites too)
sed -i 's/process_upload/processUpload/g' src/upload/upload.ts
# Also update call sites in other files
git grep -l 'process_upload' | xargs sed -i 's/process_upload/processUpload/g'
```

---

### ST-2: Mixed Async Patterns - .then() vs async/await [MED]

**Location:** `src/services/process.ts:50-60`

**Established Pattern:**
88% of async functions (22/25) use async/await:
```typescript
// Existing codebase examples:
async function uploadFile(file: File) {
  const content = await file.text();
  return content;
}

async function saveUser(user: User) {
  const result = await db.users.insert(user);
  return result;
}
```

**Violation:**
```typescript
// Lines 50-60
function processData(data: any): Promise<Result> {
  // ❌ Uses .then() chains, codebase prefers async/await
  return validateData(data)
    .then(validated => transformData(validated))
    .then(transformed => saveData(transformed))
    .catch(error => handleError(error));
}
```

**Issue:**
Function uses `.then()` chains while codebase predominantly uses `async/await`.

**Impact:**
- Cognitive load: Mixed paradigms in same codebase
- Error handling: `.catch()` vs try/catch inconsistency
- Readability: async/await is more readable for sequential operations

**Severity:** MED
**Confidence:** Medium (88% use async/await)
**Category:** Async Pattern

**Autofix:**
```diff
--- a/src/services/process.ts
+++ b/src/services/process.ts
@@ -48,10 +48,13 @@

-function processData(data: any): Promise<Result> {
-  return validateData(data)
-    .then(validated => transformData(validated))
-    .then(transformed => saveData(transformed))
-    .catch(error => handleError(error));
+async function processData(data: any): Promise<Result> {
+  try {
+    const validated = await validateData(data);
+    const transformed = await transformData(validated);
+    const result = await saveData(transformed);
+    return result;
+  } catch (error) {
+    return handleError(error);
+  }
 }
```

**Note:** This is MED not HIGH because:
- Both patterns are valid
- Codebase has some .then() usage (12%)
- Functional correctness unchanged
- But consistency matters for maintainability

---

### ST-3: Import Organization - Wrong Order [LOW]

**Location:** `src/api/routes.ts:1-10`

**Established Pattern:**
90% of files (18/20) use this import order:
1. Node stdlib
2. External packages
3. Internal modules (absolute paths)
4. Relative imports
5. Type imports (if separate)

With blank lines between groups.

```typescript
// Existing codebase example: src/services/upload.ts
import { readFile } from 'fs/promises';     // 1. Stdlib

import express from 'express';              // 2. External
import { parse } from 'csv-parse';

import { db } from '@/db';                  // 3. Internal
import { logger } from '@/lib/logger';

import { validateFile } from './validator'; // 4. Relative
import type { UploadResult } from './types'; // 5. Types
```

**Violation:**
```typescript
// Lines 1-10
import { validateFile } from './validator';  // ❌ Relative first
import express from 'express';               // External second
import { db } from '@/db';                   // Internal third
import { readFile } from 'fs/promises';      // Stdlib last
// ❌ No blank lines between groups
```

**Issue:**
Import order doesn't match established pattern.

**Impact:**
- Cognitive load: Inconsistent organization
- Merge conflicts: Different orders cause conflicts
- Readability: Harder to find imports

**Severity:** LOW
**Confidence:** High (90% use established order)
**Category:** Import Organization

**Autofix:**
```diff
--- a/src/api/routes.ts
+++ b/src/api/routes.ts
@@ -1,4 +1,7 @@
-import { validateFile } from './validator';
+import { readFile } from 'fs/promises';
+
 import express from 'express';
+
 import { db } from '@/db';
-import { readFile } from 'fs/promises';
+
+import { validateFile } from './validator';
```

**Autofix Command:**
```bash
# Use ESLint with auto-fix (if configured)
npx eslint --fix src/api/routes.ts

# Or use import-sort
npx import-sort --write src/api/routes.ts
```

---

### ST-4: Quote Style - Double Quotes vs Single Quotes [NIT]

**Location:** `src/lib/parser.ts` (multiple lines)

**Established Pattern:**
75% of strings (45/60) use single quotes:
```typescript
// Existing codebase examples:
const message = 'Upload successful';
logger.info('Processing file');
throw new Error('Invalid file format');
```

**Violation:**
```typescript
// Lines 20, 35, 50 (examples)
const error = "File not found";        // ❌ Double quotes
logger.warn("Invalid row");            // ❌ Double quotes
throw new Error("Parsing failed");     // ❌ Double quotes
```

**Issue:**
Uses double quotes instead of established single quote convention.

**Impact:**
- Minor cognitive load
- Aesthetic inconsistency
- Easily fixable with formatter

**Severity:** NIT
**Confidence:** High (75% use single quotes)
**Category:** Formatting

**Note:** Confidence is "High" despite 75% because:
- Clear majority pattern
- No functional reason for double quotes
- Should be enforced by formatter

**Autofix:**
```diff
--- a/src/lib/parser.ts
+++ b/src/lib/parser.ts
@@ -18,7 +18,7 @@

-const error = "File not found";
+const error = 'File not found';

@@ -33,7 +33,7 @@

-logger.warn("Invalid row");
+logger.warn('Invalid row');

@@ -48,7 +48,7 @@

-throw new Error("Parsing failed");
+throw new Error('Parsing failed');
```

**Autofix Command:**
```bash
# Use Prettier
npx prettier --write src/lib/parser.ts

# Or ESLint with quote rule
npx eslint --fix --rule 'quotes: ["error", "single"]' src/lib/parser.ts
```

**Recommendation:** Add Prettier config to enforce automatically:
```json
// .prettierrc
{
  "singleQuote": true
}
```

---

## 5) Codebase Consistency Analysis

Assessment of overall codebase consistency:

### High Consistency Areas (>90%)
✅ **Function naming:** 98% camelCase - Well established
✅ **File naming:** 95% kebab-case - Well established
✅ **Constants:** 94% UPPER_SNAKE_CASE - Well established
✅ **Error handling:** 92% throw exceptions - Well established

### Medium Consistency Areas (80-90%)
⚠️ **Async patterns:** 88% async/await - Mostly consistent, some .then() usage
⚠️ **Import order:** 90% follow pattern - Mostly good, needs formatter

### Low Consistency Areas (<80%)
❌ **Quote style:** 75% single quotes - Needs formatter enforcement
❌ **Type annotations:** 70% explicit - Inconsistent, needs guideline

**Recommendations:**
1. Add Prettier config to enforce quote style
2. Enable ESLint rule for import order
3. Document async pattern preference (async/await)
4. Add TypeScript strict rules for type annotations

---

## 6) Linter/Formatter Recommendations

**Current state:**
- Prettier: ❌ Not configured
- ESLint: ⚠️ Partially configured (missing style rules)
- TypeScript: ✅ Configured (strict mode)

**Recommended config additions:**

### .prettierrc
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

### .eslintrc.json additions
```json
{
  "rules": {
    "quotes": ["error", "single"],
    "semi": ["error", "always"],
    "import/order": ["error", {
      "groups": [
        "builtin",
        "external",
        "internal",
        "parent",
        "sibling",
        "index"
      ],
      "newlines-between": "always"
    }]
  }
}
```

**Impact:**
- Automate style enforcement
- Reduce cognitive load on code reviews
- Prevent style inconsistencies in future PRs
- Save ~10 minutes per code review

---

## 7) Autofix Summary

### Mechanical Autofixes (Can be automated)

**{X} findings can be autofixed with these commands:**

```bash
# ST-1: Rename function
git grep -l 'process_upload' | xargs sed -i 's/process_upload/processUpload/g'

# ST-3: Fix import order
npx eslint --fix src/api/routes.ts

# ST-4: Fix quote style
npx prettier --write src/lib/parser.ts
```

**Estimated time:** 2 minutes

### Pattern Autofixes (Need simple refactor)

**{Y} findings need simple refactoring:**

**ST-2: Convert .then() to async/await**
- Location: `src/services/process.ts:50-60`
- Effort: 5 minutes
- Patch provided in finding ST-2

**Estimated time:** 5 minutes

### Manual Fixes

**{Z} findings need manual attention:**

None in this review.

---

## 8) Positive Observations

Things done well (for balance):

✅ **Consistent error handling:** All new code throws exceptions (matches codebase)
✅ **Type annotations:** Explicit types on public APIs
✅ **File organization:** Clear separation of concerns
✅ **Naming clarity:** Most names are intent-revealing
✅ **No bikeshedding issues:** No arbitrary style choices

---

## 9) Recommendations

### Must Fix (HIGH findings)

1. **ST-1**: Rename `process_upload` to `processUpload`
   - Action: Apply autofix
   - Rationale: 98% of codebase uses camelCase
   - Estimated effort: 2 minutes

### Should Fix (MED findings)

2. **ST-2**: Convert `.then()` to `async/await`
   - Action: Apply patch from ST-2
   - Rationale: 88% of codebase uses async/await
   - Estimated effort: 5 minutes

### Consider (LOW/NIT findings)

3. **ST-3**: Fix import order
   - Action: Run ESLint autofix
   - Rationale: Consistency, reduce merge conflicts
   - Estimated effort: 1 minute

4. **ST-4**: Fix quote style
   - Action: Run Prettier
   - Rationale: Consistency, can be automated
   - Estimated effort: 1 minute

### Long-term (Infrastructure)

5. **Add Prettier config** to enforce formatting automatically
6. **Add ESLint import-order rule** to enforce import organization
7. **Document async pattern preference** in contributing guide

---

## 10) False Positives & Disagreements Welcome

**Where I might be wrong:**

1. **ST-2 (async pattern)**: If this function will be composed with other promise-returning functions, `.then()` might be more appropriate
2. **ST-4 (quote style)**: If double quotes are used for strings with interpolation, there might be an intentional pattern
3. **Severity ratings**: Some findings might be less important in context (e.g., internal-only code)

**How to override my findings:**
- Explain intentional deviation (document it!)
- Show conflicting convention I missed
- Provide context where pattern doesn't apply

I'm enforcing consistency, not personal preferences. If there's a good reason for deviation, let's discuss!

---

*Review completed: {YYYY-MM-DD}*
*Session: [{SESSION_SLUG}](../README.md)*
```

# SUMMARY OUTPUT

After creating review, print:

```markdown
# Style Consistency Review Complete

## Review Location
Saved to: `.claude/{SESSION_SLUG}/reviews/review-style-consistency-{YYYY-MM-DD}.md`

## Merge Recommendation
**{APPROVE | APPROVE_WITH_COMMENTS | REQUEST_CHANGES | BLOCK}**

## Consistency Score
**{85}%** (based on violations vs lines changed)

## Key Inconsistencies
1. **{Finding ID}**: {Pattern} - Deviates from {established pattern} ({X}% usage)
2. **{Finding ID}**: {Pattern} - Deviates from {established pattern} ({X}% usage)
3. **{Finding ID}**: {Pattern} - Deviates from {established pattern} ({X}% usage)

## Statistics
- Files reviewed: {count}
- Lines changed: +{added} -{removed}
- Findings: BLOCKER: {X}, HIGH: {X}, MED: {X}, LOW: {X}, NIT: {X}
- Autofix available: {X} mechanical, {Y} pattern, {Z} manual

## Autofix Commands

### Run all mechanical fixes:
```bash
{autofix commands}
```

**Estimated time:** {X} minutes

### Pattern fixes (need review):
- {Finding ID}: {description} - {effort}

**Total estimated effort:** {X} minutes

## Pattern Compliance
- Naming: {X}% compliant
- Error handling: {X}% compliant
- Async: {X}% compliant
- Imports: {X}% compliant
- Formatting: {X}% compliant

## Next Steps
{If REQUEST_CHANGES:}
1. Run autofix commands above
2. Review pattern refactors
3. Re-run style review
4. Consider adding formatter config

{If APPROVE_WITH_COMMENTS:}
1. Consider running autofixes for consistency
2. LOW/NIT findings optional
3. OK to merge as-is

## Infrastructure Recommendations
{If missing:}
- Add Prettier config for automatic formatting
- Add ESLint import-order rule
- Document style preferences in CONTRIBUTING.md
```

# IMPORTANT: Evidence-Based, Not Opinionated

This review should be:
- **Evidence-based**: Show codebase statistics (98% use camelCase)
- **Pattern-focused**: Compare against established patterns, not opinions
- **No bikeshedding**: Only flag clear deviations, not subjective preferences
- **Autofix-friendly**: Provide exact commands when possible
- **Infrastructure-aware**: Recommend automation over manual enforcement

The goal is consistency for reduced cognitive load, not stylistic perfection.

# WHEN TO USE

Run `/review:style-consistency` when:
- Before merging features (catch style drift early)
- Onboarding new contributors (teach conventions)
- After external contributions (ensure consistency)
- When setting up linter/formatter (validate rules)

This should be in the default review chain for all work types, with LOW severity (informational).
