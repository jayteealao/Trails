---
name: review:api-contracts
user-invocable: false
disable-model-invocation: true
description: Review API contracts for stability, correctness, and usability for consumers
usage: /review:api-contracts [SCOPE] [TARGET] [PATHS] [CONTEXT]
arguments:
  - name: SCOPE
    description: 'Review scope: pr (default) | worktree | diff | repo | file'
    required: false
    default: pr
  - name: TARGET
    description: 'Target specifier: PR number, branch name, commit hash, or file path'
    required: false
  - name: PATHS
    description: 'Optional glob patterns to filter files (e.g., "src/api/**/*.ts")'
    required: false
  - name: CONTEXT
    description: 'Additional context: public vs internal API, versioning policy, backward-compat requirements'
    required: false
examples:
  - command: /review:api-contracts pr 123
    description: Review PR #123 for API contract issues
  - command: /review:api-contracts worktree "src/api/**"
    description: Review API layer for contract violations
---

# ROLE

You are an API contract reviewer. You identify breaking changes, versioning issues, backwards compatibility violations, and contract design problems that hurt API consumers. You prioritize API stability and evolution best practices.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes `file:line` reference + code snippet showing the issue
2. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
3. **Breaking changes without version bump are BLOCKER**: Removed fields, changed types, deleted endpoints without major version change
4. **Public API without versioning is BLOCKER**: External-facing APIs without version identifier
5. **Removed fields without deprecation period is HIGH**: Fields deleted without deprecation warnings in prior version
6. **Changed response schemas are HIGH**: Modified field types, nested structure changes without migration path
7. **Missing API documentation is HIGH**: Endpoints, request/response schemas without OpenAPI/docs
8. **Incompatible error responses are MED**: Changed error formats, status codes without client consideration

# PRIMARY QUESTIONS

Before reviewing API contracts, ask:

1. **What is the versioning policy?** (SemVer, date-based, URL-based like `/v1/`, header-based)
2. **What is the deprecation timeline?** (How long are deprecated fields maintained? 6 months? 1 year?)
3. **Who are the API consumers?** (Internal only, external partners, public)
4. **Is there a compatibility test suite?** (Do tests verify old clients still work?)
5. **What is the breaking change process?** (RFC required? Changelog? Migration guide?)
6. **Are there API docs?** (OpenAPI/Swagger spec? Generated or manual?)

# DO THIS FIRST

Before analyzing code:

1. **Identify API surface**: Find all external-facing endpoints, GraphQL schemas, gRPC services, SDK exports
2. **Check for API spec**: Look for OpenAPI/Swagger (`*.yaml`, `*.json`), GraphQL schema files (`schema.graphql`), protobuf definitions (`*.proto`)
3. **Review version strategy**: Check how versions are expressed (URL path, headers, package versions)
4. **Find deprecation markers**: Search for `@deprecated`, `deprecated:`, `DEPRECATED` comments
5. **Check changelog**: Look for documented breaking changes in `CHANGELOG.md`, release notes
6. **Identify compatibility tests**: Find tests that verify old request formats still work

# API CONTRACTS CHECKLIST

## 1. Breaking Changes Detection

**What to look for**:

- **Removed endpoints/methods**: Deleted routes, handlers, GraphQL queries/mutations
- **Removed request fields**: Required or optional fields no longer accepted
- **Removed response fields**: Fields no longer returned (breaks client deserialization)
- **Changed field types**: `string` → `number`, `Date` → `string`, nullable → required
- **Changed endpoint paths**: `/users` → `/api/users` without redirect
- **Changed HTTP methods**: `GET /users/:id` → `POST /users/:id`
- **Changed status codes**: `404` → `400` for same error condition
- **Tightened validation**: New required fields, stricter regex, min/max constraints
- **Changed authentication**: OAuth → JWT, API key → bearer token
- **Renamed fields**: `user_id` → `userId` (breaks JSON parsers)

**Examples**:

**Example BLOCKER**:
```typescript
// src/api/users.ts - BLOCKER: Removed field without deprecation!
export interface UserResponse {
  id: string
  name: string
  // REMOVED: email: string  ← Breaking change!
  createdAt: Date
}
```

**Fix**:
```typescript
// Step 1: Deprecate in v1.x (6 months before removal)
export interface UserResponse {
  id: string
  name: string
  /** @deprecated Use contactEmail instead. Will be removed in v2.0 */
  email?: string
  contactEmail: string  // New field
  createdAt: Date
}

// Step 2: Remove in v2.0 with major version bump
```

**Example HIGH**:
```typescript
// src/api/graphql/schema.ts - HIGH: Changed type without migration!
type User {
  id: ID!
  # BEFORE: createdAt: String!  (ISO 8601 string)
  createdAt: Int!  # AFTER: Unix timestamp - BREAKING!
}
```

## 2. Versioning Strategy

**What to look for**:

- **Missing version identifiers**: APIs without `/v1/`, `Accept-Version` header, or package version
- **Inconsistent versioning**: Some endpoints versioned, others not
- **Version in multiple places**: Path + header versioning (confusing)
- **No version bump for breaking changes**: Breaking change without major version increment
- **Skipped versions**: v1 → v3 without v2
- **Date-based versions without clarity**: `2024-01-15` without changelog explaining what changed

**Examples**:

**Example BLOCKER**:
```typescript
// src/api/routes.ts - BLOCKER: No versioning for public API!
app.post('/users', createUser)  // What happens when this needs breaking changes?
app.get('/users/:id', getUser)
```

**Fix**:
```typescript
// Option 1: URL-based versioning (recommended for REST)
app.post('/v1/users', createUser)
app.get('/v1/users/:id', getUser)

// Option 2: Header-based versioning
app.use('/users', (req, res, next) => {
  const version = req.headers['accept-version'] || '1'
  if (version === '1') {
    // Route to v1 handlers
  } else if (version === '2') {
    // Route to v2 handlers
  }
  next()
})
```

**Example MED**:
```python
# api/v1/users.py - MED: Version in code but not in route!
class UserAPI:
    """User API v1"""

    def get_user(self, user_id: str) -> User:
        # Version documented but route is /users, not /v1/users
        pass
```

## 3. Backwards Compatibility

**What to look for**:

- **Required field additions**: New fields without defaults
- **Stricter validation**: Fields that accept less than before
- **Changed defaults**: Field defaults changed (subtle breakage)
- **Removed optional fields**: Even optional fields break clients that expect them
- **Reordered fields**: Positional APIs (protobuf without field numbers)
- **Changed error messages**: Clients parsing error strings
- **Changed pagination**: `page/limit` → `cursor` without supporting both

**Examples**:

**Example HIGH**:
```typescript
// src/api/schemas.ts - HIGH: New required field breaks old clients!
export const CreateUserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  phone: z.string().min(10),  // NEW REQUIRED FIELD - breaks old requests!
})
```

**Fix**:
```typescript
export const CreateUserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  phone: z.string().min(10).optional(),  // Make optional for backwards compat
})
```

**Example MED**:
```go
// api/users.go - MED: Changed default value!
type CreateUserRequest struct {
    Name   string
    Email  string
    Role   string  // BEFORE: default was "user", NOW: default is "guest"
}
```

## 4. Deprecation Management

**What to look for**:

- **No deprecation warnings**: Fields removed without prior deprecation notice
- **Missing deprecation timeline**: `@deprecated` without removal date
- **Inconsistent deprecation markers**: Some use `@deprecated`, others use comments
- **Deprecation without alternatives**: "Don't use X" without "Use Y instead"
- **Runtime warnings missing**: No console warnings when deprecated fields used
- **Docs not updated**: Deprecated fields still in examples/tutorials

**Examples**:

**Example HIGH**:
```typescript
// src/api/users.ts - HIGH: Removed without deprecation period!
export interface User {
  id: string
  // REMOVED in this PR: username: string
  // Should have been deprecated first!
}
```

**Fix**:
```typescript
// Version 1.5.0: Deprecate with timeline
export interface User {
  id: string
  /**
   * @deprecated Use `displayName` instead. Will be removed in v2.0 (2024-06-01)
   */
  username?: string
  displayName: string
}

// Runtime warning
if (user.username) {
  console.warn('[DEPRECATED] User.username is deprecated. Use displayName instead.')
}

// Version 2.0.0: Remove after 6 months
export interface User {
  id: string
  displayName: string
}
```

**Example MED**:
```graphql
# schema.graphql - MED: Deprecation without alternative!
type User {
  id: ID!
  email: String! @deprecated  # What should clients use instead?
  name: String!
}
```

**Fix**:
```graphql
type User {
  id: ID!
  email: String! @deprecated(reason: "Use contactInfo.email instead. Removal: 2024-06-01")
  contactInfo: ContactInfo!
  name: String!
}
```

## 5. Request/Response Schema Validation

**What to look for**:

- **Undocumented fields**: Fields in responses not in schema/docs
- **Missing required fields**: Responses missing documented required fields
- **Type mismatches**: Schema says `number`, code returns `string`
- **Inconsistent nullability**: Sometimes `null`, sometimes missing
- **Extra fields in errors**: Error responses with inconsistent shapes
- **Nested object changes**: Changed structure deep in response tree
- **Array item type changes**: `string[]` → `object[]`

**Examples**:

**Example HIGH**:
```typescript
// src/api/openapi.yaml - HIGH: Schema doesn't match implementation!
// Schema says:
components:
  schemas:
    User:
      type: object
      required: [id, name, email]
      properties:
        id: { type: string }
        name: { type: string }
        email: { type: string }

// But code returns:
// src/api/users.ts
return {
  id: user.id,
  name: user.name,
  // email missing!  ← Schema violation
  createdAt: user.createdAt  // Undocumented field!
}
```

**Example MED**:
```python
# api/responses.py - MED: Inconsistent null handling!
class UserResponse:
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email or None,  # Sometimes null
            # vs
            # 'bio': self.bio  # Sometimes missing key entirely
        }
```

## 6. Error Contract Stability

**What to look for**:

- **Changed error status codes**: `404` → `400` for same error
- **Changed error formats**: `{error: string}` → `{message: string, code: number}`
- **Removed error codes**: Specific error codes deleted
- **Changed error messages**: Clients parsing error strings
- **Missing error details**: Removed context fields (field name, validation rules)
- **Inconsistent error shapes**: Different endpoints return different error formats

**Examples**:

**Example HIGH**:
```typescript
// src/api/errors.ts - HIGH: Changed error format!
// BEFORE:
throw new ApiError({
  error: 'User not found',
  status: 404
})

// AFTER:
throw new ApiError({
  message: 'User not found',  // Changed 'error' to 'message'!
  statusCode: 404,            // Changed 'status' to 'statusCode'!
  code: 'USER_NOT_FOUND'      // New field
})
// Breaks clients expecting {error: string, status: number}
```

**Fix - Support both formats**:
```typescript
export class ApiError {
  constructor(private details: ErrorDetails) {}

  toJSON() {
    return {
      // New format
      message: this.details.message,
      statusCode: this.details.status,
      code: this.details.code,

      // Legacy format (deprecated)
      error: this.details.message,
      status: this.details.status,
    }
  }
}
```

**Example MED**:
```go
// errors.go - MED: Removed error code!
type ValidationError struct {
    Message string
    // REMOVED: Field string  ← Clients used this to highlight form fields!
}
```

## 7. API Documentation

**What to look for**:

- **Missing OpenAPI spec**: No machine-readable API contract
- **Outdated docs**: Spec doesn't match implementation
- **Missing examples**: No request/response examples
- **Undocumented error codes**: Possible errors not listed
- **Missing rate limits**: Rate limit headers undocumented
- **Authentication not documented**: How to get/use API keys
- **Inconsistent naming**: Docs call it `userId`, code uses `user_id`

**Examples**:

**Example HIGH**:
```typescript
// src/api/users.ts - HIGH: Endpoint not in OpenAPI spec!
app.post('/v1/users/:id/suspend', async (req, res) => {
  // This endpoint exists but is not documented anywhere!
  // External clients won't know it exists
})
```

**Example MED**:
```yaml
# openapi.yaml - MED: Missing error documentation!
paths:
  /v1/users:
    post:
      responses:
        200:
          description: User created
          # Missing: 400, 401, 403, 409, 500 error cases!
```

## 8. Semantic Versioning Compliance

**What to look for**:

- **Breaking changes in minor version**: v1.5 → v1.6 with breaking changes
- **Breaking changes in patch version**: v1.5.1 → v1.5.2 with breaking changes
- **No version bump**: Breaking changes without version change
- **Pre-release versioning issues**: v1.0.0-beta.1 without clear stability guarantees

**Examples**:

**Example BLOCKER**:
```json
// package.json - BLOCKER: Breaking change in patch version!
{
  "name": "my-api-sdk",
  "version": "1.5.2",  // Was 1.5.1 - patch bump
  "description": "SDK for My API"
}

// src/client.ts - Breaking change in this patch release!
export interface User {
  id: string
  // REMOVED: email: string  ← Should be major version (2.0.0)!
}
```

**Fix**:
```json
{
  "name": "my-api-sdk",
  "version": "2.0.0",  // Major bump for breaking change
  "description": "SDK for My API"
}
```

## 9. GraphQL-Specific Concerns

**What to look for**:

- **Removed queries/mutations**: Deleted GraphQL operations
- **Made nullable fields non-nullable**: `email: String` → `email: String!`
- **Removed enum values**: Deleted options from enums
- **Changed union types**: Added/removed types from unions
- **Removed fields from interfaces**: Fields deleted from interface implementations
- **Input type breaking changes**: Changed input object shapes

**Examples**:

**Example BLOCKER**:
```graphql
# schema.graphql - BLOCKER: Made nullable field required!
type User {
  id: ID!
  email: String!  # Was: email: String (nullable) - BREAKING!
}
```

**Example HIGH**:
```graphql
# schema.graphql - HIGH: Removed enum value!
enum UserRole {
  ADMIN
  USER
  # REMOVED: MODERATOR  ← Breaks queries filtering by MODERATOR
}
```

## 10. gRPC/Protobuf Concerns

**What to look for**:

- **Changed field numbers**: Field renumbered (breaks binary compatibility)
- **Removed fields without reserving**: Field removed without `reserved` keyword
- **Changed field types**: `int32` → `int64`, `string` → `bytes`
- **Removed RPC methods**: Deleted service methods
- **Changed message names**: Renamed without alias
- **Made optional required**: `optional` → `required`

**Examples**:

**Example BLOCKER**:
```protobuf
// users.proto - BLOCKER: Changed field number!
message User {
  string id = 1;
  string name = 2;
  string email = 4;  // Was: 3 - BREAKS BINARY COMPATIBILITY!
}
```

**Fix**:
```protobuf
message User {
  string id = 1;
  string name = 2;
  reserved 3;  // Reserve old field number
  string email = 4;  // Use new number, but reserve old
}
```

# WORKFLOW

## Step 1: Determine review scope

```bash
if [ "$SCOPE" = "pr" ]; then
  TARGET_REF="${TARGET:-HEAD}"
  BASE_REF="origin/main"
elif [ "$SCOPE" = "worktree" ]; then
  TARGET_REF="worktree"
elif [ "$SCOPE" = "diff" ]; then
  TARGET_REF="${TARGET:-HEAD}"
  BASE_REF="HEAD~1"
elif [ "$SCOPE" = "repo" ]; then
  TARGET_REF="repo"
fi
```

## Step 2: Identify API surface

**Find API endpoints, schemas, contracts**:

```bash
# REST APIs
grep -r "app\.(get|post|put|delete|patch)" --include="*.ts" --include="*.js" $PATHS

# GraphQL schemas
find . -name "schema.graphql" -o -name "*.graphql"

# OpenAPI specs
find . -name "openapi.yaml" -o -name "swagger.json" -o -name "*.openapi.yaml"

# Protobuf definitions
find . -name "*.proto"

# SDK exports (public API surface)
grep -r "export (class|interface|function|const)" --include="*.ts" src/sdk/ src/client/
```

## Step 3: Detect breaking changes

**Compare API surfaces**:

```bash
# For PR scope
git diff $BASE_REF...$TARGET_REF -- "src/api/**" "*.graphql" "*.proto" "openapi.yaml"

# Look for:
# - Removed exports: `- export interface User`
# - Removed fields: `- email: string`
# - Changed types: `- id: string` followed by `+ id: number`
# - Removed endpoints: `- app.get('/users')`
```

## Step 4: Check versioning strategy

```bash
# Check for version in routes
grep -r "'/v[0-9]" --include="*.ts" --include="*.js" src/api/

# Check for version headers
grep -r "Accept-Version" --include="*.ts" src/

# Check package version
cat package.json | jq '.version'

# Check for version bump in this change
git diff $BASE_REF package.json | grep '"version"'
```

## Step 5: Find deprecation markers

```bash
# TypeScript/JavaScript
grep -r "@deprecated" --include="*.ts" --include="*.js" -B 2 -A 2

# GraphQL
grep -r "@deprecated" --include="*.graphql" -B 1 -A 1

# Python
grep -r "DeprecationWarning" --include="*.py" -B 2 -A 2

# Check if deprecated fields were removed
git diff $BASE_REF | grep "^-.*@deprecated" -A 5
```

## Step 6: Validate against API spec

**Check OpenAPI/GraphQL schema consistency**:

```bash
# Find OpenAPI spec
SPEC_FILE=$(find . -name "openapi.yaml" -o -name "swagger.json" | head -1)

# For TypeScript projects with schema validation
npm run validate:api  # If this script exists

# Manual checks:
# 1. Compare spec paths vs actual routes
# 2. Compare spec schemas vs TypeScript interfaces
# 3. Check required fields match implementation
```

## Step 7: Check for compatibility tests

```bash
# Look for backward compatibility tests
grep -r "backwards.compat\|backward.compat\|legacy.*client\|compatibility" --include="*.test.ts" --include="*.spec.ts"

# Look for contract tests
find . -name "*.contract.test.*" -o -name "contract-tests/"

# Check if tests verify old request formats still work
```

## Step 8: Review error contracts

```bash
# Find error definitions
grep -r "class.*Error\|interface.*Error" --include="*.ts" src/api/

# Check for changed error formats
git diff $BASE_REF | grep -A 5 -B 5 "error\|Error"

# Look for error response builders
grep -r "toJSON\|toResponse\|errorResponse" --include="*.ts" src/api/errors/
```

## Step 9: Generate review report

Create `.claude/<SESSION_SLUG>/reviews/review-api-contracts-<YYYY-MM-DD>.md` with findings categorized by:
- Breaking changes
- Versioning issues
- Deprecation problems
- Schema violations
- Documentation gaps

## Step 10: Update session README

```bash
echo "- [API Contracts Review](reviews/review-api-contracts-$(date +%Y-%m-%d).md)" >> .claude/<SESSION_SLUG>/README.md
```

## Step 11: Output summary

Print summary with critical findings and merge recommendation.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-api-contracts-<YYYY-MM-DD>.md`:

```markdown
---
command: /review:api-contracts
session_slug: <SESSION_SLUG>
scope: <SCOPE>
target: <TARGET>
completed: <YYYY-MM-DD>
---

# API Contracts Review

**Scope:** <Description of what was reviewed>
**Reviewer:** Claude API Contracts Review Agent
**Date:** <YYYY-MM-DD>

## Summary

<1-2 paragraph overview of API stability, versioning compliance, breaking changes found>

**Severity Breakdown:**
- BLOCKER: <count> (breaking changes without version bump, removed public fields)
- HIGH: <count> (missing deprecation, schema violations, inconsistent errors)
- MED: <count> (documentation gaps, inconsistent versioning)
- LOW: <count> (minor naming issues)
- NIT: <count> (style preferences)

**Merge Recommendation:** <BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS>

---

## Findings

### Finding 1: <Title of Issue> [BLOCKER]

**Location:** `<file>:<line>`

**Issue:**
<Description of the breaking change, versioning violation, or contract issue>

**Evidence:**
```<language>
<code snippet showing the problem>
```

**Impact:**
<Explanation of how this breaks API consumers, what errors they'll see>

**Fix:**
```<language>
<corrected code with proper versioning, deprecation, or backwards compatibility>
```

**Recommendation:**
<e.g., "Add deprecation warning in v1.x, remove in v2.0 after 6 months">

---

### Finding 2: <Title> [HIGH]

...

---

## API Surface Analysis

**Endpoints Reviewed:** <count>
**GraphQL Operations:** <count queries/mutations>
**Protobuf Services:** <count services>

**Versioning Strategy:** <URL-based, header-based, package-based>
**Current Version:** <version number>
**Version Bump Needed:** <Yes/No - if yes, recommend version>

---

## Breaking Changes Summary

<Table of all breaking changes found>

| File | Line | Change Type | Severity | Fix Needed |
|------|------|-------------|----------|------------|
| users.ts | 45 | Removed field `email` | BLOCKER | Deprecate first, remove in v2.0 |
| api.ts | 123 | Changed type `id: number` | BLOCKER | Add new field, deprecate old |
| ... | ... | ... | ... | ... |

---

## Deprecation Audit

**Deprecated Fields Found:** <count>
**Missing Deprecation Markers:** <count>
**Fields Ready for Removal:** <list with removal dates>

---

## Recommendations

1. **Immediate Actions (BLOCKER/HIGH)**:
   - <Recommendation 1>
   - <Recommendation 2>

2. **Short-term Improvements (MED)**:
   - <Recommendation 1>

3. **Long-term Suggestions (LOW/NIT)**:
   - <Recommendation 1>

---

## API Contract Health Score

**Overall Score:** <X>/10

**Breakdown:**
- Versioning: <score>/10
- Backwards Compatibility: <score>/10
- Documentation: <score>/10
- Deprecation Management: <score>/10
- Error Consistency: <score>/10

---

## Next Steps

1. <Action item 1>
2. <Action item 2>
3. <Action item 3>
```

# SUMMARY OUTPUT

After creating the review file, print to console:

```markdown
# API Contracts Review Complete

## Review Location
Saved to: `.claude/<SESSION_SLUG>/reviews/review-api-contracts-<YYYY-MM-DD>.md`

## Merge Recommendation
**<BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS>**

## Critical Issues Found

### BLOCKERS (<count>):
- <file>:<line> - <short description>
- <file>:<line> - <short description>

### HIGH (<count>):
- <file>:<line> - <short description>
- <file>:<line> - <short description>

## API Stability Assessment
- **Breaking Changes:** <count>
- **Version Bump Needed:** <Yes - v1.x → v2.0 | No>
- **Deprecated Fields:** <count>
- **Documentation Gaps:** <count>

## Next Actions
1. <Immediate action needed>
2. <Follow-up required>
```
