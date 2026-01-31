---
name: review:docs
user-invocable: false
disable-model-invocation: true
description: Review documentation completeness and accuracy for behavior/config/API changes
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
    description: Optional file path globs to focus review (e.g., "docs/**/*.md")
    required: false
---

# ROLE
You review documentation completeness and accuracy for behavior/config/API changes. You optimize for a reader who did not write the code.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding shows what changed in code and what's missing in docs
2. **Show the gap**: Quote code change + missing documentation
3. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
4. **Suggest documentation**: Provide example text for missing docs
5. **Verify accuracy**: Check existing docs against actual code behavior

# PRIMARY QUESTIONS

1. What user-visible behavior changed? Is it documented?
2. Are setup/config instructions still accurate?
3. Can a reader who didn't write the code understand the change?
4. Are examples realistic and copy-pasteable?
5. Does terminology match between code and docs?

# DOCS CHECKLIST

## 1. Public Behavior Changes
- **What changed**: Clear description of new/modified behavior
- **Why changed**: Motivation, problem solved
- **Impact**: Who is affected, breaking vs non-breaking
- **Migration guide**: How to adapt existing code (if breaking)

## 2. Setup/Run Instructions
- **Environment variables**: New vars, changed defaults
- **Config files**: New keys, deprecated keys, format changes
- **Ports/endpoints**: New ports, changed URLs
- **Commands**: Installation, build, run, test commands
- **Dependencies**: New requirements, version changes

## 3. Configuration Documentation
- **Purpose**: What does this config control?
- **Default value**: What's the default? What happens if omitted?
- **Examples**: Common values, edge cases
- **Safe values**: Valid range, formats, constraints
- **Gotchas**: Performance implications, security notes, common mistakes

## 4. API Documentation
- **Endpoints**: New/changed routes, methods
- **Request format**: Parameters, body schema, headers
- **Response format**: Success/error schemas, status codes
- **Error handling**: Error codes, error messages, retry behavior
- **Examples**: Realistic request/response pairs with curl/code snippets

## 5. Migration/Upgrade Notes
- **Breaking changes**: What will break, how to fix
- **Rollout steps**: How to deploy safely
- **Rollback procedure**: How to undo if needed
- **Version compatibility**: Which versions work together
- **Data migrations**: Schema changes, data transformations

## 6. Examples
- **Copy-pasteable**: No `...` placeholders, complete code
- **Realistic**: Real-world scenarios, not toy examples
- **Self-contained**: Include all necessary setup
- **Explained**: Comments or prose explaining what it does
- **Tested**: Examples actually work (verified)

## 7. Diagrams/Architecture
- **Only if needed**: Complex flows, non-obvious relationships
- **Keep minimal**: Just enough to clarify, not exhaustive
- **Up-to-date**: Reflects current architecture
- **Clear labels**: Components/flows are labeled

## 8. Changelog/Release Notes
- **User-facing changes**: What users will notice
- **Breaking changes**: Clearly marked, with migration guide
- **Bug fixes**: What was broken, now fixed
- **Deprecations**: What's deprecated, timeline, alternatives

## 9. Consistency
- **Terminology**: Same names as in code (class names, config keys)
- **Accuracy**: Docs don't promise unsupported behavior
- **Completeness**: All public APIs/configs documented
- **No lies**: Docs match actual implementation

# WORKFLOW

## Step 0: Infer SESSION_SLUG if not provided

Standard session inference from `.claude/README.md` (last entry).

## Step 1: Load session context

1. Validate `.claude/<SESSION_SLUG>/` exists
2. Read `.claude/<SESSION_SLUG>/README.md` for context
3. Check spec for user-facing behavior
4. Check plan for documentation strategy
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
   - Review all changed code + docs
   - Can be narrowed with globs

4. **CONTEXT** (if not provided)
   - Infer audience from spec/plan
   - Look for existing docs to determine style

## Step 3: Gather changed files

Based on SCOPE:
- For `pr`: Get diff from PR
- For `worktree`: Get git diff HEAD
- For `diff`: Get git diff for range
- For `file`: Read specific file(s)
- For `repo`: Scan recent changes

Categorize files:
- **Source code changes**: `src/**/*.ts`, `lib/**/*.py`
- **Documentation changes**: `docs/**/*.md`, `README.md`, `CHANGELOG.md`
- **Config changes**: `config/*.yaml`, `.env.example`
- **Test changes**: `tests/**/*.test.ts` (for example verification)

## Step 4: Identify documentable changes

For each source file changed:

1. **Public API changes**:
   - New/modified exported functions, classes, endpoints
   - Changed function signatures (parameters, return types)
   - New/modified HTTP routes

2. **Configuration changes**:
   - New environment variables
   - New config file keys
   - Changed defaults
   - Deprecated configs

3. **Behavior changes**:
   - Changed error handling
   - Changed validation rules
   - Changed business logic
   - Performance characteristics

4. **Breaking changes**:
   - Removed functions/endpoints
   - Changed response formats
   - Changed error codes
   - Required parameters

5. **Setup/deployment changes**:
   - New dependencies
   - Changed build steps
   - New infrastructure requirements

## Step 5: Find existing documentation

Look for docs in common locations:

1. **README.md**: Project overview, setup, usage
2. **docs/**: Detailed documentation
3. **API.md / api-docs/**: API reference
4. **CHANGELOG.md**: Version history
5. **CONTRIBUTING.md**: Development setup
6. **config/README.md**: Configuration guide
7. **examples/**: Code examples
8. **Inline comments**: JSDoc, docstrings, comments

## Step 6: Check documentation coverage

For each documentable change:

1. **Is it documented?**
   - Search docs for function/config/endpoint name
   - Check if mentioned in CHANGELOG
   - Look for related examples

2. **Is documentation accurate?**
   - Compare docs against actual code
   - Check examples still work
   - Verify default values match

3. **Is documentation complete?**
   - Purpose explained?
   - Examples provided?
   - Edge cases covered?
   - Errors documented?

4. **Is documentation up-to-date?**
   - Old behavior removed?
   - New behavior added?
   - Examples updated?

## Step 7: Verify examples

For each code example in docs:

1. **Is it complete?**
   - No `...` placeholders?
   - All imports included?
   - All setup shown?

2. **Is it accurate?**
   - Matches current API?
   - Correct parameter names?
   - Correct return types?

3. **Does it work?**
   - Can it be copy-pasted and run?
   - Are there syntax errors?
   - Does it match test code?

## Step 8: Check consistency

1. **Terminology consistency**:
   - Compare names in docs vs code
   - Check for outdated terms
   - Look for ambiguous terms

2. **Format consistency**:
   - Consistent heading levels
   - Consistent code block formatting
   - Consistent example format

3. **Cross-reference consistency**:
   - Internal links work
   - References to code are accurate
   - Version numbers match

## Step 9: Generate findings

For each gap or inaccuracy:

1. **Severity**:
   - BLOCKER: Critical breaking change undocumented
   - HIGH: Public API undocumented or wrong
   - MED: Config/setup docs incomplete
   - LOW: Example quality issues
   - NIT: Minor formatting, typos

2. **Confidence**:
   - High: Clear code change, no corresponding docs
   - Med: Might be documented elsewhere
   - Low: Might be internal-only change

3. **Evidence**:
   - Code change (file:line, snippet)
   - Existing docs (if any, what's wrong)
   - Gap description (what's missing)

4. **Suggested documentation**:
   - Example text to add
   - Where to add it
   - Format to match existing docs

## Step 10: Generate review report

Create `.claude/<SESSION_SLUG>/reviews/review-docs-{YYYY-MM-DD}.md`

## Step 11: Update session README

Standard artifact tracking update.

## Step 12: Output summary

Print summary with critical doc gaps.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-docs-{YYYY-MM-DD}.md`:

```markdown
---
command: /review:docs
session_slug: {SESSION_SLUG}
date: {YYYY-MM-DD}
scope: {SCOPE}
target: {TARGET}
paths: {PATHS}
audience: {developers | users | operators}
related:
  session: ../README.md
  spec: ../spec/spec-crystallize.md (if exists)
  plan: ../plan/research-plan*.md (if exists)
  work: ../work/work*.md (if exists)
---

# Documentation Review Report

**Reviewed:** {SCOPE} / {TARGET}
**Date:** {YYYY-MM-DD}
**Reviewer:** Claude Code

---

## 0) Scope, Audience, and Context

**What was reviewed:**
- Scope: {SCOPE}
- Target: {TARGET}
- Files changed: {count} source, {count} docs
- Lines changed: +{added} -{removed}
{If PATHS provided:}
- Focus: {PATHS}

**Audience:**
{From CONTEXT or inferred}
- Primary: {developers | end users | operators | contributors}
- Secondary: {other audiences}

**Documentation locations:**
- README.md
- docs/
- CHANGELOG.md
- API documentation
- Inline comments

**Changes requiring documentation:**
1. New function: `uploadFile()` - Public API
2. New config: `MAX_FILE_SIZE` - Environment variable
3. Changed error handling - Breaking change
4. New endpoint: `POST /upload` - HTTP API

---

## 1) Executive Summary

**Merge Recommendation:** {APPROVE | APPROVE_WITH_COMMENTS | REQUEST_CHANGES | BLOCK}

**Rationale:**
{2-3 sentences explaining recommendation}

**Documentation Coverage:** {60}% of user-visible changes documented

**Critical Gaps:**
1. **{Finding ID}**: {Change} - No documentation
2. **{Finding ID}**: {Change} - Documentation inaccurate
3. **{Finding ID}**: {Change} - Example broken

**Overall Assessment:**
- Completeness: {Complete | Good | Gaps | Missing}
- Accuracy: {Accurate | Mostly Accurate | Outdated | Wrong}
- Examples: {Excellent | Good | Poor | Missing}
- Consistency: {Consistent | Mostly Consistent | Inconsistent}

---

## 2) Coverage Matrix

| Change | Type | Documented? | Location | Status |
|--------|------|-------------|----------|--------|
| `uploadFile()` | Public API | ❌ No | - | Missing |
| `MAX_FILE_SIZE` | Config | ⚠️ Partial | README.md:50 | Incomplete |
| Error handling | Breaking | ❌ No | - | Missing |
| POST /upload | API | ✅ Yes | docs/api.md:20 | Good |

**Coverage Summary:**
- ✅ Documented: {1} change
- ⚠️ Partially documented: {1} change
- ❌ Not documented: {2} changes

---

## 3) Findings Table

| ID | Severity | Confidence | Category | Code:Line | Issue |
|----|----------|------------|----------|-----------|-------|
| DC-1 | HIGH | High | API Docs | `upload.ts:30` | New function undocumented |
| DC-2 | HIGH | High | Breaking | `errors.ts:20` | Breaking change undocumented |
| DC-3 | MED | High | Config | `config.ts:15` | Incomplete config docs |
| DC-4 | LOW | Med | Example | `README.md:100` | Example uses old API |

**Findings Summary:**
- BLOCKER: {count}
- HIGH: {count}
- MED: {count}
- LOW: {count}
- NIT: {count}

**Category Breakdown:**
- API documentation: {count}
- Configuration docs: {count}
- Breaking changes: {count}
- Examples: {count}
- Setup/deployment: {count}

---

## 4) Findings (Detailed)

### DC-1: New Public Function Undocumented [HIGH]

**Code Change:** `src/upload/upload.ts:30-50`

**What changed:**
```typescript
// Lines 30-50 - NEW PUBLIC API
/**
 * Uploads a file with validation and size checking.
 * @param file - The file to upload
 * @returns Promise<UploadResult>
 * @throws ValidationError if file invalid
 * @throws FileSizeError if file too large
 */
export async function uploadFile(file: File): Promise<UploadResult> {
  if (file.size > MAX_FILE_SIZE) {
    throw new FileSizeError(`File too large: ${file.size} bytes`);
  }

  const content = await file.text();
  return processFile(content);
}
```

**Documentation gap:**
- ❌ No mention in README.md
- ❌ No API docs entry
- ❌ Not in CHANGELOG.md
- ⚠️ JSDoc exists (good!) but not user-facing docs

**Why it matters:**
- This is a public API (exported function)
- Users need to know it exists
- Errors need to be documented (FileSizeError)
- File size limit needs to be documented

**Who needs this:**
- Developers integrating with this library
- Users uploading files

**Severity:** HIGH
**Confidence:** High
**Category:** API Documentation

**Suggested Documentation:**

**Location 1: README.md** (add to "Usage" section)

```markdown
### Uploading Files

Upload files with automatic validation and size checking:

\`\`\`typescript
import { uploadFile } from './upload';

try {
  const result = await uploadFile(file);
  console.log('Upload successful:', result);
} catch (error) {
  if (error instanceof FileSizeError) {
    console.error('File too large. Max size: 10MB');
  } else if (error instanceof ValidationError) {
    console.error('Invalid file:', error.message);
  }
}
\`\`\`

**File size limit:** 10MB (configurable via `MAX_FILE_SIZE` env var)

**Supported file types:** CSV, JSON, XML

**Errors:**
- `FileSizeError` - File exceeds size limit
- `ValidationError` - File format invalid
```

**Location 2: docs/api.md** (add to API reference)

```markdown
## `uploadFile(file: File): Promise<UploadResult>`

Uploads a file with validation and size checking.

**Parameters:**
- `file` (File) - The file to upload

**Returns:**
- Promise<UploadResult> - Upload result with status and metadata

**Throws:**
- `FileSizeError` - If file exceeds MAX_FILE_SIZE (default: 10MB)
- `ValidationError` - If file format is invalid

**Example:**

\`\`\`typescript
const file = new File(['data'], 'data.csv', { type: 'text/csv' });
const result = await uploadFile(file);
// { success: true, id: '123', size: 1024 }
\`\`\`
```

**Location 3: CHANGELOG.md** (add to next version)

```markdown
## [Unreleased]

### Added
- New `uploadFile()` function for file uploads with validation
  - Validates file size (max 10MB by default)
  - Validates file format
  - Returns upload result with metadata
```

---

### DC-2: Breaking Change in Error Format Undocumented [HIGH]

**Code Change:** `src/lib/errors.ts:20-35`

**What changed:**
```diff
--- a/src/lib/errors.ts
+++ b/src/lib/errors.ts
@@ -18,10 +18,15 @@

-export class ValidationError extends Error {
-  constructor(message: string) {
-    super(message);
+// ❌ BREAKING: Error format changed, no docs
+export class ValidationError extends Error {
+  public readonly code: string;
+  public readonly details: Record<string, any>;
+
+  constructor(message: string, code: string, details = {}) {
+    super(message);
+    this.code = code;
+    this.details = details;
   }
 }
```

**Documentation gap:**
- ❌ No mention in CHANGELOG.md "Breaking Changes"
- ❌ No migration guide
- ❌ README examples use old format
- ❌ No update to error handling docs

**Why it's breaking:**
Old code expecting simple Error:
```typescript
// This will break - no 'code' field
catch (error) {
  console.error(error.message); // ✅ Still works
  console.error(error.code);    // ❌ Undefined (was not there before)
}
```

**Who is affected:**
- Anyone catching ValidationError
- Anyone serializing errors to JSON
- Anyone checking error types

**Severity:** HIGH (breaking change)
**Confidence:** High
**Category:** Breaking Change

**Suggested Documentation:**

**Location 1: CHANGELOG.md** (add to "Breaking Changes")

```markdown
## [Unreleased]

### Breaking Changes

#### Error Format Changed

**What changed:**
All error classes now include `code` and `details` fields for better error handling.

**Before:**
\`\`\`typescript
throw new ValidationError('Invalid email');
// Error: { message: 'Invalid email' }
\`\`\`

**After:**
\`\`\`typescript
throw new ValidationError('Invalid email', 'INVALID_EMAIL', { field: 'email' });
// Error: { message: 'Invalid email', code: 'INVALID_EMAIL', details: { field: 'email' } }
\`\`\`

**Migration:**

If you're catching errors and accessing `.code` or `.details`, no changes needed (new fields available).

If you're constructing ValidationError in your code:
\`\`\`diff
-throw new ValidationError('Invalid input');
+throw new ValidationError('Invalid input', 'INVALID_INPUT', {});
\`\`\`

**Error Codes:**
- `INVALID_EMAIL` - Email format invalid
- `INVALID_FILE_TYPE` - File type not supported
- `INVALID_FILE_SIZE` - File size exceeds limit
- `INVALID_INPUT` - Generic validation failure
```

**Location 2: docs/errors.md** (create or update)

```markdown
# Error Handling

All errors include the following fields:

- `message` (string) - Human-readable error message
- `code` (string) - Machine-readable error code
- `details` (object) - Additional context (field names, values, etc.)

## Error Codes

| Code | Class | Description | Details |
|------|-------|-------------|---------|
| `INVALID_EMAIL` | ValidationError | Email format invalid | `{ field: 'email', value: '...' }` |
| `FILE_TOO_LARGE` | FileSizeError | File exceeds size limit | `{ size: 123, limit: 10485760 }` |
| `FILE_NOT_FOUND` | NotFoundError | File not found | `{ path: '...' }` |

## Example

\`\`\`typescript
try {
  await uploadFile(file);
} catch (error) {
  console.error(`Error ${error.code}: ${error.message}`);
  console.error('Details:', error.details);
}
\`\`\`
```

**Location 3: README.md** (update examples)

Find all error handling examples and add `code` and `details`:
```diff
-} catch (error) {
-  console.error(error.message);
+} catch (error) {
+  console.error(`Error ${error.code}: ${error.message}`);
+  if (error.details.field) {
+    console.error(`Invalid field: ${error.details.field}`);
+  }
 }
```

---

### DC-3: Environment Variable Incompletely Documented [MED]

**Code Change:** `src/config/config.ts:15-20`

**What changed:**
```typescript
// Lines 15-20 - NEW CONFIG
export const MAX_FILE_SIZE = parseInt(
  process.env.MAX_FILE_SIZE || '10485760', // 10MB default
  10
);
```

**Existing documentation:** README.md:50

```markdown
## Configuration

Set `MAX_FILE_SIZE` environment variable to control file size limit.
```

**What's missing:**
- ❌ No default value shown
- ❌ No units specified (bytes? MB?)
- ❌ No example
- ❌ No range constraints
- ❌ No gotchas (what happens if invalid?)

**Why it matters:**
- Users need to know default (10MB)
- Users need to know format (bytes, not MB)
- Users need to know what happens if invalid (falls back to default)

**Severity:** MED
**Confidence:** High
**Category:** Configuration Documentation

**Suggested Documentation:**

**Location: README.md** (expand existing section)

```diff
 ## Configuration

-Set `MAX_FILE_SIZE` environment variable to control file size limit.
+### Environment Variables

+#### `MAX_FILE_SIZE`

+Controls the maximum file size for uploads.

+- **Default:** `10485760` (10MB)
+- **Format:** Bytes (integer)
+- **Example:** `MAX_FILE_SIZE=52428800` (50MB)
+- **Valid range:** 1 to 104857600 (100MB)
+
+**Common values:**
+- 1MB: `1048576`
+- 10MB: `10485760` (default)
+- 50MB: `52428800`
+- 100MB: `104857600`
+
+**Gotchas:**
+- Must be a valid integer (no units like "10MB")
+- Invalid values fall back to default (10MB)
+- Setting too high may cause memory issues
+
+**Example:**
+\`\`\`bash
+# Set 50MB limit
+export MAX_FILE_SIZE=52428800
+npm start
+\`\`\`
```

---

### DC-4: Example Uses Deprecated API [LOW]

**Code Change:** `src/api/routes.ts:30-40`

**What changed:**
```diff
--- a/src/api/routes.ts
+++ b/src/api/routes.ts
@@ -28,7 +28,7 @@

-app.post('/upload', uploadHandler);
+app.post('/api/v1/upload', uploadHandler); // ❌ URL changed
```

**Outdated documentation:** README.md:100

```markdown
### Example

\`\`\`bash
curl -X POST http://localhost:3000/upload \
  -F "file=@data.csv"
\`\`\`
```

**What's wrong:**
- ❌ Example uses old URL (`/upload`)
- ✅ Should use new URL (`/api/v1/upload`)
- ⚠️ Old URL might still work (redirect?) but docs should show new URL

**Why it matters:**
- Users will copy-paste and get 404 (or redirect)
- Example should demonstrate best practices (new API)

**Severity:** LOW (old URL might still work)
**Confidence:** Med (depends on if old URL redirects)
**Category:** Example Accuracy

**Suggested Fix:**

**Location: README.md** (update example)

```diff
 ### Example

 \`\`\`bash
-curl -X POST http://localhost:3000/upload \
+curl -X POST http://localhost:3000/api/v1/upload \
   -F "file=@data.csv"
 \`\`\`
```

**Also check:**
- All curl examples in docs/
- All code examples using fetch/axios
- All Postman collections (if any)

---

## 5) Accuracy Issues

Documentation that exists but is incorrect or outdated:

### Outdated Setup Instructions

**Location:** README.md:20-30

**Issue:**
```markdown
## Installation

\`\`\`bash
npm install
npm start
\`\`\`
```

**What's wrong:**
Code now requires environment variables to start:
```typescript
// src/index.ts:5
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL required');
}
```

**Fix:**
```diff
 ## Installation

 \`\`\`bash
 npm install
+
+# Set required environment variables
+export DATABASE_URL=postgresql://localhost/mydb
+export MAX_FILE_SIZE=10485760
+
 npm start
 \`\`\`
```

---

## 6) Example Quality Assessment

### Good Examples ✅

**README.md:150** - TypeScript usage example
- ✅ Complete (includes imports)
- ✅ Copy-pasteable (no `...` placeholders)
- ✅ Realistic (real-world scenario)
- ✅ Explained (comments describing each step)

### Poor Examples ❌

**docs/api.md:50** - API request example
```markdown
\`\`\`bash
curl -X POST /api/upload -F file=@data.csv
\`\`\`
```

**Problems:**
- ❌ Missing hostname (where to send request?)
- ❌ Missing port (3000? 8080?)
- ❌ No response example (what does success look like?)

**Better:**
```markdown
\`\`\`bash
curl -X POST http://localhost:3000/api/v1/upload \
  -F "file=@data.csv"
\`\`\`

**Response (success):**
\`\`\`json
{
  "success": true,
  "id": "abc-123",
  "size": 1024
}
\`\`\`

**Response (error):**
\`\`\`json
{
  "error": {
    "code": "FILE_TOO_LARGE",
    "message": "File size exceeds limit",
    "details": { "size": 20971520, "limit": 10485760 }
  }
}
\`\`\`
```

---

## 7) Consistency Issues

### Terminology Inconsistencies

| In Code | In Docs | Should Be |
|---------|---------|-----------|
| `uploadFile()` | `upload()` | `uploadFile()` |
| `ValidationError` | `ValidationException` | `ValidationError` |
| `MAX_FILE_SIZE` | `maxFileSize` | `MAX_FILE_SIZE` |

**Fix:** Update docs to match code exactly.

### Format Inconsistencies

- README.md uses JavaScript examples
- docs/api.md uses TypeScript examples
- docs/guide.md mixes both

**Recommendation:** Standardize on TypeScript (matches codebase).

---

## 8) Missing Documentation

### High Priority (PUBLIC API)

1. **`uploadFile()` function** - No docs (DC-1)
2. **`MAX_FILE_SIZE` config** - Incomplete (DC-3)
3. **Error format change** - Breaking, no migration guide (DC-2)

### Medium Priority (SETUP/CONFIG)

4. **`DATABASE_URL` requirement** - Not in setup docs
5. **Port configuration** - Default port not documented
6. **Build requirements** - Node version not specified

### Low Priority (NICE-TO-HAVE)

7. **Architecture diagram** - Complex flow, could use visual
8. **Troubleshooting guide** - Common errors not documented
9. **Performance notes** - File size limits, concurrent uploads

---

## 9) Positive Observations

Things done well (for balance):

✅ **Good JSDoc coverage:** Most functions have inline docs
✅ **Clear README:** Well-organized, good structure
✅ **Changelog exists:** Shows commitment to release notes
✅ **API docs exist:** docs/api.md is a good start
✅ **Examples present:** README has usage examples

---

## 10) Recommendations

### Must Fix (BLOCKER/HIGH)

1. **DC-1**: Document `uploadFile()` function
   - Action: Add to README, docs/api.md, CHANGELOG
   - Rationale: Public API must be documented
   - Estimated effort: 20 minutes

2. **DC-2**: Document breaking error format change
   - Action: Add breaking change notice + migration guide
   - Rationale: Breaking changes must have migration path
   - Estimated effort: 30 minutes

### Should Fix (MED)

3. **DC-3**: Complete `MAX_FILE_SIZE` documentation
   - Action: Add default, examples, gotchas
   - Rationale: Config needs complete documentation
   - Estimated effort: 10 minutes

4. **Setup instructions**: Add required env vars
   - Action: Update README installation section
   - Rationale: Setup must be complete and accurate
   - Estimated effort: 5 minutes

### Consider (LOW/NIT)

5. **DC-4**: Update examples to use new API
   - Action: Update URLs in examples
   - Rationale: Examples should show current API
   - Estimated effort: 5 minutes

6. **Terminology**: Fix naming inconsistencies
   - Action: Update docs to match code names exactly
   - Rationale: Consistency reduces confusion
   - Estimated effort: 10 minutes

### Long-term

7. **Example validation**: Add test to verify examples work
8. **Automated docs**: Generate API docs from code
9. **Doc review checklist**: Add to PR template

---

## 11) Documentation Checklist

Progress on documentation requirements:

- [ ] Public API changes documented
  - [x] Endpoints documented (POST /api/v1/upload)
  - [ ] Functions documented (`uploadFile()` missing)
  - [ ] Classes documented
- [ ] Breaking changes documented
  - [ ] Error format change (DC-2)
  - [ ] Migration guide needed
- [ ] Configuration documented
  - [~] MAX_FILE_SIZE (incomplete)
  - [ ] DATABASE_URL (missing)
- [ ] Setup instructions updated
  - [ ] Environment variables (incomplete)
  - [x] Installation steps
  - [x] Build commands
- [ ] Examples updated
  - [~] README examples (need update)
  - [x] API examples
  - [ ] Code samples tested
- [ ] Changelog updated
  - [ ] New features listed
  - [ ] Breaking changes noted
  - [ ] Migration notes added

**Completion:** {40}% of documentation requirements met

---

## 12) Suggested Documentation Priorities

**If time is limited (30 minutes):**
1. Fix DC-1 (document `uploadFile()` in README)
2. Fix DC-2 (add breaking change notice)
3. Fix setup instructions (env vars)

**If time allows (60 minutes):**
1. All HIGH findings
2. Complete config docs (DC-3)
3. Update all examples
4. Fix terminology inconsistencies

**Full documentation (2 hours):**
1. All findings addressed
2. Add architecture diagram
3. Add troubleshooting section
4. Write comprehensive API docs

---

## 13) False Positives & Disagreements Welcome

**Where I might be wrong:**

1. **DC-1 (missing docs)**: If this is internal-only API (not exported), no public docs needed
2. **DC-2 (breaking change)**: If old API still works (backward compat), might not be breaking
3. **DC-4 (old example)**: If old URL redirects transparently, low priority fix

**How to override my findings:**
- Show documentation I missed (different location)
- Explain change is internal-only (not user-facing)
- Provide evidence old API still works (backward compat)

I'm optimizing for reader clarity. If there's a good reason for gaps, let's discuss!

---

*Review completed: {YYYY-MM-DD}*
*Session: [{SESSION_SLUG}](../README.md)*
```

# SUMMARY OUTPUT

After creating review, print:

```markdown
# Documentation Review Complete

## Review Location
Saved to: `.claude/{SESSION_SLUG}/reviews/review-docs-{YYYY-MM-DD}.md`

## Merge Recommendation
**{APPROVE | APPROVE_WITH_COMMENTS | REQUEST_CHANGES | BLOCK}**

## Documentation Coverage
**{60}%** of user-visible changes documented

## Critical Gaps
1. **{Finding ID}**: {Change} - {What's missing}
2. **{Finding ID}**: {Change} - {What's missing}
3. **{Finding ID}**: {Change} - {What's missing}

## Statistics
- Files changed: {X} source, {Y} docs
- Findings: BLOCKER: {X}, HIGH: {X}, MED: {X}, LOW: {X}, NIT: {X}
- Documented: {X}%, Partially: {Y}%, Missing: {Z}%
- Examples: {X} good, {Y} need fixing
- Accuracy issues: {count}

## Coverage Breakdown
- ✅ Documented: {X} changes
- ⚠️ Partially documented: {Y} changes
- ❌ Not documented: {Z} changes

## Quick Actions
{If HIGH+ gaps exist:}
Add documentation from findings: DC-1, DC-2, DC-3
Estimated time: {X} minutes

**Priority documentation:**
1. {Finding ID}: {Description} ({time})
2. {Finding ID}: {Description} ({time})

**Total effort for HIGH+MED fixes:** {X} minutes

## Next Steps
{If REQUEST_CHANGES:}
1. Document critical changes (DC-1, DC-2)
2. Update examples to match current API
3. Add migration guide for breaking changes
4. Re-review documentation

{If APPROVE_WITH_COMMENTS:}
1. Consider adding recommended docs (MED priority)
2. Update examples in follow-up
3. OK to merge as-is

## Documentation Locations
{Where to add docs:}
- README.md: Usage examples, setup
- docs/api.md: API reference
- CHANGELOG.md: Version history, breaking changes
- docs/errors.md: Error handling guide
```

# IMPORTANT: Reader-Centric, Not Writer-Centric

This review should be:
- **Reader-focused**: Optimize for someone who didn't write the code
- **Concrete**: Show exact text to add, where to add it
- **Actionable**: Provide copy-pasteable documentation
- **Evidence-based**: Show code change + doc gap
- **Prioritized**: Focus on public APIs and breaking changes first

The goal is complete, accurate, usable documentation.

# WHEN TO USE

Run `/review:docs` when:
- Before merging features (ensure docs added)
- Before releases (verify changelog complete)
- After API changes (verify docs updated)
- When users report confusion (check doc accuracy)

This should be in the default review chain for all work types, especially `new_feature`.
