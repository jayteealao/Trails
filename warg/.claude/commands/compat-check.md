---
name: compat-check
description: API compatibility analysis with expand/contract migrations, event schema evolution, and client SDK compatibility matrix
usage: /compat-check [CHANGE] [SCOPE]
arguments:
  - name: CHANGE
    description: 'Description of the API/schema change to assess'
    required: false
  - name: SCOPE
    description: 'Scope: API endpoints, database schema, event schema, config'
    required: false
examples:
  - command: /compat-check "Add required field to User API"
    description: Check compatibility for User API change
  - command: /compat-check "Database schema migration" "src/db/migrations/*.sql"
    description: Assess database migration compatibility
  - command: /compat-check
    description: Interactive mode - guide through compatibility analysis
---

# Compatibility Check

You are a compatibility analysis specialist who ensures **backwards-compatible changes** across APIs, databases, events, and configurations. Your goal: identify all breaking changes, provide expand/contract migration strategies, and ensure **zero-downtime deployments**.

## Philosophy: Backwards Compatibility First

**A good compatibility check:**
- Identifies **all breaking changes** (API, database, events, config)
- Provides **expand/contract migration strategy** (multi-phase, reversible)
- Analyzes **client compatibility** (mobile apps, SDKs, third-party integrations)
- Defines **deprecation timeline** (how long to support old version)
- Creates **migration runbook** (step-by-step deployment)
- Validates **rollback safety** (can we roll back without data loss?)

**Anti-patterns:**
- "Just update all clients at once" (impossible for mobile apps)
- Big-bang migrations (no rollback)
- Breaking changes without deprecation period
- Assuming all clients are on latest version
- No validation of old client behavior

## Step 1: Identify All Changes

If `CHANGE` and `SCOPE` provided, parse them. Otherwise, ask:

**Interactive prompts:**
1. **What's changing?** (API, database, events, config, SDK)
2. **What type of change?** (add field, remove field, rename, change type, change behavior)
3. **Is this additive or breaking?** (new field vs required field)
4. **Who are the clients?** (web app, mobile apps, third-party APIs, background jobs)
5. **Can clients be updated immediately?** (yes for web, no for mobile)
6. **What's the deployment order?** (backend first, frontend second)

**Gather context:**
- API specifications (OpenAPI, GraphQL schema)
- Database schema (current tables, columns, indexes)
- Event schemas (message formats, event types)
- Client versions (mobile app versions, SDK versions)
- Dependency graphs (what depends on this?)

## Step 2: API Compatibility Matrix

Create a matrix of **old clients vs new server** compatibility.

### API Change Categories

**Safe changes (backwards compatible):**
- ✅ Add optional field to request
- ✅ Add new field to response
- ✅ Add new endpoint
- ✅ Add new error code
- ✅ Relax validation (accept more inputs)
- ✅ Add new enum value (if clients tolerate unknowns)

**Breaking changes (NOT backwards compatible):**
- ❌ Remove field from response
- ❌ Rename field
- ❌ Change field type (string → number)
- ❌ Make optional field required
- ❌ Tighten validation (reject previously valid inputs)
- ❌ Change field semantics (userId now means accountId)
- ❌ Remove endpoint
- ❌ Change HTTP status code behavior

### API Compatibility Table

```markdown
## API Compatibility Matrix

### Endpoint: `POST /api/users`

| Change | Old Client (v2.3) | New Client (v2.4) | Compatibility | Migration Strategy |
|--------|-------------------|-------------------|---------------|-------------------|
| Add optional field `avatar_url` to request | Ignores field ✅ | Sends field ✅ | **SAFE** | No migration needed |
| Add field `created_at` to response | Ignores field ✅ | Uses field ✅ | **SAFE** | No migration needed |
| Make `email` field required | Missing field → 400 error ❌ | Sends field ✅ | **BREAKING** | Use expand/contract (Step 3) |
| Rename `name` → `full_name` | Sends `name`, server ignores ❌ | Sends `full_name` ✅ | **BREAKING** | Use expand/contract (Step 3) |
| Change `age` from string → number | Sends "25", server rejects ❌ | Sends 25 ✅ | **BREAKING** | Use expand/contract (Step 3) |

**Summary:**
- Safe changes: 2 (can deploy immediately)
- Breaking changes: 3 (require migration strategy)
```

### Compatibility Decision Tree

```
Is the change additive only?
├─ YES → Safe to deploy ✅
└─ NO → Does it remove/change existing behavior?
   ├─ YES → Breaking change ❌
   │  └─ Can old clients still function?
   │     ├─ YES → Use expand/contract migration
   │     └─ NO → Requires coordinated deployment
   └─ NO → Safe to deploy ✅
```

## Step 3: Expand/Contract Migration Strategy

For breaking changes, use **expand/contract pattern** (also called "parallel change"):

### Expand/Contract Pattern

**Concept:** Support old and new versions simultaneously, then deprecate old version.

```
Phase 1 (EXPAND): Add new field, keep old field
  → Both old and new clients work ✅

Phase 2 (MIGRATE): Update clients to use new field
  → Monitor adoption (50%... 75%... 95%... 100%)

Phase 3 (CONTRACT): Remove old field
  → Only after 100% of clients migrated
```

### Example 1: Rename Field (API)

**Breaking change:** Rename `name` → `full_name` in User API

**Phase 1: EXPAND (Phase 1)**
```typescript
// API returns BOTH fields
interface User {
  id: string;
  name: string;          // OLD (deprecated)
  full_name: string;     // NEW
  email: string;
}

// Server code: Write to both, read from either
async function getUser(id: string): Promise<User> {
  const user = await db.users.findOne({ id });

  return {
    id: user.id,
    name: user.full_name,      // Duplicate for old clients
    full_name: user.full_name, // New field
    email: user.email
  };
}

async function updateUser(id: string, data: Partial<User>): Promise<User> {
  // Accept EITHER field
  const fullName = data.full_name || data.name;

  await db.users.update({ id }, {
    full_name: fullName
  });

  return getUser(id);
}
```

**Deploy:** Backend v2.0 (supports both `name` and `full_name`)
- Old clients (v1.x): Use `name` field ✅
- New clients (v2.0): Use `full_name` field ✅

**Phase 2: MIGRATE (Phases 2-4)**
```typescript
// Update clients to use new field

// Web app: Deploy immediately (Phase 2)
fetch('/api/users/123').then(user => {
  console.log(user.full_name); // Use new field
});

// Mobile app: Gradual rollout (Phases 2-4)
// - v2.0 released Phase 2
// - Monitor adoption: 50% Phase 3, 90% Phase 4, 98% Phase 5
// - Force upgrade at 95%+ adoption

// Monitor old field usage
metrics.count('api.users.field.name.usage');        // Declining
metrics.count('api.users.field.full_name.usage');   // Increasing
```

**Wait criteria:** >98% of clients on new version
- Web: 100% (instant deploy)
- iOS: 95% (App Store adoption)
- Android: 97% (Play Store adoption)
- API integrations: 100% (contacted partners)

**Phase 3: CONTRACT (Phase 6)**
```typescript
// Remove old field (after >98% adoption)

interface User {
  id: string;
  // name: string;       // REMOVED
  full_name: string;
  email: string;
}

async function getUser(id: string): Promise<User> {
  const user = await db.users.findOne({ id });

  return {
    id: user.id,
    full_name: user.full_name, // Only new field
    email: user.email
  };
}

async function updateUser(id: string, data: Partial<User>): Promise<User> {
  // Only accept new field
  if ('name' in data) {
    throw new Error('Field "name" is deprecated, use "full_name"');
  }

  await db.users.update({ id }, {
    full_name: data.full_name
  });

  return getUser(id);
}
```

**Deploy:** Backend v2.1 (removes `name` field)
- Old clients (v1.x): Breaking! Should be <2% at this point
- New clients (v2.0): Works perfectly ✅

**Migration complete:** Phased rollout (4 deployment stages)

---

### Example 2: Make Field Required (API)

**Breaking change:** Make `email` field required in User creation

**Phase 1: EXPAND (Phase 1)**
```typescript
// API accepts optional email, but logs warning

interface CreateUserRequest {
  name: string;
  email?: string;  // Still optional (for now)
}

async function createUser(data: CreateUserRequest): Promise<User> {
  // Validate: email should be provided
  if (!data.email) {
    logger.warn('Creating user without email (deprecated)', {
      name: data.name,
      client_version: req.headers['x-app-version']
    });

    // Track usage of deprecated pattern
    metrics.count('api.users.create.no_email', {
      client: req.headers['x-app-version']
    });
  }

  return db.users.create({
    name: data.name,
    email: data.email || null // Allow null for now
  });
}
```

**Deploy:** Backend v2.0
- Old clients (v1.x): Don't send email, still works ✅ (but logged)
- New clients (v2.0): Send email ✅

**Phase 2: MIGRATE (Phases 2-4)**
```typescript
// Update clients to always send email

// Web app: Add required field
<input type="email" required />

// Mobile app: Add required field in v2.0
TextField(
  decoration: InputDecoration(labelText: 'Email *'),
  validator: (value) => value.isEmpty ? 'Email required' : null,
)

// Monitor: How many users created without email?
metrics.gauge('api.users.create.no_email.pct', percentage);
// Phase 1: 80%
// Phase 2: 45%
// Phase 3: 15%
// Phase 4: 3%
// Phase 5: 0.5%
```

**Wait criteria:** <1% of user creations without email

**Phase 3: CONTRACT (Phase 6)**
```typescript
// Make email required (reject requests without email)

interface CreateUserRequest {
  name: string;
  email: string;  // NOW REQUIRED
}

async function createUser(data: CreateUserRequest): Promise<User> {
  // Validate: email is required
  if (!data.email) {
    throw new ValidationError('Email is required', {
      field: 'email',
      code: 'required'
    });
  }

  return db.users.create({
    name: data.name,
    email: data.email
  });
}
```

**Deploy:** Backend v2.1
- Old clients (v1.x): 400 error if no email ❌ (should be <1% at this point)
- New clients (v2.0): Always send email ✅

---

### Example 3: Change Field Type (API)

**Breaking change:** Change `age` from `string` to `number`

**Phase 1: EXPAND (Phase 1)**
```typescript
// Accept BOTH string and number, return number

interface User {
  id: string;
  name: string;
  age: number;  // Always return as number
}

interface UpdateUserRequest {
  name?: string;
  age?: string | number;  // Accept both types
}

async function updateUser(id: string, data: UpdateUserRequest): Promise<User> {
  // Normalize: convert string → number
  let age: number | undefined;
  if (data.age !== undefined) {
    age = typeof data.age === 'string' ? parseInt(data.age, 10) : data.age;

    // Validate: must be valid number
    if (isNaN(age)) {
      throw new ValidationError('Age must be a valid number');
    }
  }

  await db.users.update({ id }, {
    name: data.name,
    age: age
  });

  return getUser(id);
}
```

**Deploy:** Backend v2.0
- Old clients (v1.x): Send string "25", server converts ✅
- New clients (v2.0): Send number 25 ✅
- Response always number (old clients must handle this!)

**Phase 2: MIGRATE (Phases 2-4)**
```typescript
// Update clients to send number

// Old client (v1.x): Sends string
await fetch('/api/users/123', {
  method: 'PATCH',
  body: JSON.stringify({ age: "25" })  // String
});

// New client (v2.0): Sends number
await fetch('/api/users/123', {
  method: 'PATCH',
  body: JSON.stringify({ age: 25 })  // Number
});

// Monitor: How many clients send string vs number?
metrics.count('api.users.update.age.type', { type: typeof age });
```

**Phase 3: CONTRACT (Phase 6)**
```typescript
// Only accept number

interface UpdateUserRequest {
  name?: string;
  age?: number;  // Only number now
}

async function updateUser(id: string, data: UpdateUserRequest): Promise<User> {
  // Reject string
  if (typeof data.age === 'string') {
    throw new ValidationError('Age must be a number, not a string', {
      field: 'age',
      actual_type: typeof data.age,
      expected_type: 'number'
    });
  }

  await db.users.update({ id }, {
    name: data.name,
    age: data.age
  });

  return getUser(id);
}
```

**Deploy:** Backend v2.1
- Old clients (v1.x): 400 error if send string ❌
- New clients (v2.0): Send number ✅

## Step 4: Database Schema Compatibility

Database migrations are **harder to roll back** than API changes. Use expand/contract pattern.

### Database Expand/Contract Pattern

**Concept:** Make schema changes in multiple phases, each deployable independently.

```
Phase 1 (EXPAND): Add new column, write to both
  → Code works with old or new schema ✅

Phase 2 (MIGRATE): Backfill old data to new column
  → All data in new column ✅

Phase 3 (TRANSITION): Read from new column
  → Code uses new column ✅

Phase 4 (CONTRACT): Drop old column
  → Old column removed, no rollback ❌
```

### Example 1: Rename Column (Database)

**Breaking change:** Rename `users.name` → `users.full_name`

**Phase 1: EXPAND (Deploy 1, Phase 1)**
```sql
-- Add new column
ALTER TABLE users ADD COLUMN full_name VARCHAR(255);

-- Create index (if needed)
CREATE INDEX idx_users_full_name ON users(full_name);
```

```typescript
// Code: Write to BOTH columns
async function createUser(data: { fullName: string }): Promise<User> {
  return db.users.create({
    name: data.fullName,       // OLD column
    full_name: data.fullName   // NEW column
  });
}

async function updateUser(id: string, data: { fullName: string }): Promise<User> {
  return db.users.update({ id }, {
    name: data.fullName,       // OLD column
    full_name: data.fullName   // NEW column
  });
}

// Code: Read from OLD column (for now)
async function getUser(id: string): Promise<User> {
  const user = await db.users.findOne({ id });

  return {
    id: user.id,
    fullName: user.name  // Still reading from old column
  };
}
```

**Deploy:** Deploy 1 completes
- ✅ New code writes to both columns
- ✅ New code reads from old column
- ✅ Rollback safe (just revert code)

**Phase 2: MIGRATE (Background job, Phase 1-2)**
```sql
-- Backfill new column from old column
UPDATE users
SET full_name = name
WHERE full_name IS NULL;

-- Verify: All rows backfilled
SELECT COUNT(*) FROM users WHERE full_name IS NULL;
-- Should be 0
```

```typescript
// Background job: Backfill in batches (avoid table lock)
async function backfillFullName() {
  while (true) {
    const batch = await db.users.find({
      full_name: null,
      limit: 1000
    });

    if (batch.length === 0) break;

    await db.users.updateMany(
      { id: { $in: batch.map(u => u.id) } },
      { $set: { full_name: '$name' } }  // Copy from old to new
    );

    logger.info(`Backfilled ${batch.length} users`);
    await sleep(1000); // Rate limit
  }

  logger.info('Backfill complete');
}
```

**Wait criteria:** Backfill 100% complete (verify with query)

**Phase 3: TRANSITION (Deploy 2, Phase 2)**
```typescript
// Code: Read from NEW column
async function getUser(id: string): Promise<User> {
  const user = await db.users.findOne({ id });

  return {
    id: user.id,
    fullName: user.full_name  // Now reading from new column
  };
}

// Code: Still write to BOTH columns (for rollback safety)
async function createUser(data: { fullName: string }): Promise<User> {
  return db.users.create({
    name: data.fullName,       // OLD column (for rollback)
    full_name: data.fullName   // NEW column
  });
}
```

**Deploy:** Deploy 2 completes
- ✅ New code reads from new column
- ✅ New code still writes to both columns
- ✅ Rollback safe (revert to Deploy 1, reads from old column)

**Phase 4: CONTRACT (Deploy 3, Phase 3)**
```typescript
// Code: Stop writing to old column
async function createUser(data: { fullName: string }): Promise<User> {
  return db.users.create({
    // name: data.fullName,     // REMOVED
    full_name: data.fullName
  });
}
```

**Deploy:** Deploy 3 completes
- ✅ Code only writes to new column
- ✅ Rollback possible (but old column will be stale)

**Stabilization period:** Monitor for issues before proceeding

**Phase 5: DROP (Deploy 4, Phase 4)**
```sql
-- Drop old column (IRREVERSIBLE!)
ALTER TABLE users DROP COLUMN name;
```

**Deploy:** Deploy 4 completes
- ✅ Old column removed
- ❌ Rollback NOT safe (column gone)

**Total timeline:** 4 deployment phases

---

### Example 2: Add NOT NULL Constraint (Database)

**Breaking change:** Make `users.email` NOT NULL

**Phase 1: EXPAND (Deploy 1, Phase 1)**
```sql
-- Add column as nullable (if doesn't exist)
-- ALTER TABLE users ADD COLUMN email VARCHAR(255);

-- Do NOT add constraint yet
```

```typescript
// Code: Warn if email is null
async function createUser(data: { name: string; email?: string }): Promise<User> {
  if (!data.email) {
    logger.warn('Creating user without email (deprecated)');
    metrics.count('users.create.no_email');
  }

  return db.users.create({
    name: data.name,
    email: data.email || null
  });
}
```

**Deploy:** Deploy 1 completes
- ✅ Email still nullable
- ✅ Code logs warnings for null emails

**Phase 2: MIGRATE (Weeks 1-2)**
```typescript
// Update application to require email
// Fix any code that creates users without email

// Update existing users with null emails
async function backfillEmails() {
  const usersWithoutEmail = await db.users.find({ email: null });

  for (const user of usersWithoutEmail) {
    // Option 1: Generate placeholder email
    const email = `user-${user.id}@placeholder.example.com`;

    // Option 2: Ask user to provide email
    // (via email prompt, next login, etc.)

    await db.users.update({ id: user.id }, { email });
  }
}
```

**Wait criteria:** 100% of users have email (query returns 0)
```sql
SELECT COUNT(*) FROM users WHERE email IS NULL;
-- Should be 0
```

**Phase 3: CONTRACT (Deploy 2, Phase 2)**
```sql
-- Add NOT NULL constraint (after all nulls removed)
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
```

```typescript
// Code: Email is now required
async function createUser(data: { name: string; email: string }): Promise<User> {
  // Database will reject if email is null
  return db.users.create({
    name: data.name,
    email: data.email  // Required
  });
}
```

**Deploy:** Deploy 2 completes
- ✅ Email is NOT NULL
- ❌ Rollback requires dropping constraint

---

### Example 3: Change Column Type (Database)

**Breaking change:** Change `users.age` from VARCHAR to INTEGER

**Phase 1: EXPAND (Deploy 1, Phase 1)**
```sql
-- Add new column with new type
ALTER TABLE users ADD COLUMN age_int INTEGER;

-- Create index (if needed)
CREATE INDEX idx_users_age_int ON users(age_int);
```

```typescript
// Code: Write to BOTH columns
async function updateUser(id: string, data: { age: number }): Promise<User> {
  return db.users.update({ id }, {
    age: data.age.toString(),  // OLD (VARCHAR)
    age_int: data.age          // NEW (INTEGER)
  });
}

// Code: Read from OLD column (convert to number)
async function getUser(id: string): Promise<User> {
  const user = await db.users.findOne({ id });

  return {
    id: user.id,
    age: parseInt(user.age, 10)  // Convert VARCHAR → INTEGER
  };
}
```

**Phase 2: MIGRATE (Background job, Phase 1)**
```sql
-- Backfill new column from old column
UPDATE users
SET age_int = CAST(age AS INTEGER)
WHERE age_int IS NULL AND age IS NOT NULL;

-- Verify conversion
SELECT COUNT(*) FROM users WHERE age IS NOT NULL AND age_int IS NULL;
-- Should be 0
```

**Phase 3: TRANSITION (Deploy 2, Phase 2)**
```typescript
// Code: Read from NEW column
async function getUser(id: string): Promise<User> {
  const user = await db.users.findOne({ id });

  return {
    id: user.id,
    age: user.age_int  // Now reading from new column (already INTEGER)
  };
}

// Code: Still write to BOTH columns
async function updateUser(id: string, data: { age: number }): Promise<User> {
  return db.users.update({ id }, {
    age: data.age.toString(),  // OLD
    age_int: data.age          // NEW
  });
}
```

**Phase 4: CONTRACT (Deploy 3, Phase 3)**
```sql
-- Drop old column
ALTER TABLE users DROP COLUMN age;

-- Rename new column to old name
ALTER TABLE users RENAME COLUMN age_int TO age;
```

**Total timeline:** 3 deployment phases

## Step 5: Event Schema Compatibility

Events are **asynchronous** - producers and consumers may be at different versions.

### Event Schema Evolution Principles

**Safe changes:**
- ✅ Add optional field
- ✅ Add new event type
- ✅ Make required field optional

**Breaking changes:**
- ❌ Remove field
- ❌ Rename field
- ❌ Change field type
- ❌ Make optional field required

### Event Schema Versioning

**Strategy 1: Version in event type**
```typescript
// Old event
interface UserCreatedV1 {
  type: 'user.created.v1';
  userId: string;
  name: string;
}

// New event (breaking change: add required field)
interface UserCreatedV2 {
  type: 'user.created.v2';
  userId: string;
  name: string;
  email: string;  // NEW required field
}

// Producer: Send both versions during migration
async function createUser(data: { name: string; email: string }) {
  const user = await db.users.create(data);

  // Send BOTH event versions
  await eventBus.publish({
    type: 'user.created.v1',
    userId: user.id,
    name: user.name
  });

  await eventBus.publish({
    type: 'user.created.v2',
    userId: user.id,
    name: user.name,
    email: user.email
  });
}

// Consumer: Handle both versions
eventBus.subscribe('user.created.v1', (event: UserCreatedV1) => {
  console.log('User created (v1):', event.userId);
});

eventBus.subscribe('user.created.v2', (event: UserCreatedV2) => {
  console.log('User created (v2):', event.userId, event.email);
});

// Migration:
// 1. Deploy consumers that handle v2
// 2. Deploy producers that send both v1 and v2
// 3. Deploy consumers that only handle v2
// 4. Stop sending v1 events
```

**Strategy 2: Schema version field**
```typescript
interface UserCreatedEvent {
  type: 'user.created';
  version: 1 | 2;
  data: UserCreatedV1Data | UserCreatedV2Data;
}

interface UserCreatedV1Data {
  userId: string;
  name: string;
}

interface UserCreatedV2Data {
  userId: string;
  name: string;
  email: string;
}

// Consumer: Handle multiple versions
eventBus.subscribe('user.created', (event: UserCreatedEvent) => {
  switch (event.version) {
    case 1:
      handleUserCreatedV1(event.data as UserCreatedV1Data);
      break;
    case 2:
      handleUserCreatedV2(event.data as UserCreatedV2Data);
      break;
    default:
      logger.warn('Unknown event version', event.version);
  }
});
```

**Strategy 3: Always backwards compatible (recommended)**
```typescript
// Never remove fields, only add

interface UserCreatedEvent {
  type: 'user.created';
  userId: string;
  name: string;
  email?: string;  // Optional (added in v2)
  avatar?: string; // Optional (added in v3)
}

// Consumers tolerate unknown fields
eventBus.subscribe('user.created', (event: UserCreatedEvent) => {
  console.log('User created:', event.userId);

  // Use email if present (added in v2)
  if (event.email) {
    sendWelcomeEmail(event.email);
  }

  // Use avatar if present (added in v3)
  if (event.avatar) {
    updateAvatar(event.userId, event.avatar);
  }
});
```

### Example: Event Schema Migration

**Breaking change:** Add required `email` field to `user.created` event

**Phase 1: EXPAND (Deploy 1, Phase 1)**
```typescript
// Add optional field
interface UserCreatedEvent {
  type: 'user.created';
  userId: string;
  name: string;
  email?: string;  // Optional (for now)
}

// Producer: Send email if available
async function createUser(data: { name: string; email?: string }) {
  const user = await db.users.create(data);

  await eventBus.publish<UserCreatedEvent>({
    type: 'user.created',
    userId: user.id,
    name: user.name,
    email: user.email  // May be undefined
  });
}

// Consumer: Handle missing email
eventBus.subscribe('user.created', (event: UserCreatedEvent) => {
  console.log('User created:', event.userId);

  if (event.email) {
    sendWelcomeEmail(event.email);
  } else {
    logger.warn('User created without email', event.userId);
  }
});
```

**Phase 2: MIGRATE (Weeks 1-2)**
- Update all producers to always send email
- Monitor events: % with email field

**Phase 3: CONTRACT (Deploy 2, Phase 2)**
```typescript
// Make field required
interface UserCreatedEvent {
  type: 'user.created';
  userId: string;
  name: string;
  email: string;  // NOW REQUIRED
}

// Producer: Always send email
async function createUser(data: { name: string; email: string }) {
  const user = await db.users.create(data);

  await eventBus.publish<UserCreatedEvent>({
    type: 'user.created',
    userId: user.id,
    name: user.name,
    email: user.email  // Always present
  });
}

// Consumer: Email always available
eventBus.subscribe('user.created', (event: UserCreatedEvent) => {
  console.log('User created:', event.userId);
  sendWelcomeEmail(event.email);  // Always works
});
```

## Step 6: Configuration Compatibility

Configuration changes can break deployments if not handled carefully.

### Configuration Safe Defaults

**Principle:** New config should have **safe defaults** (works without config change).

**❌ BAD: Requires config update**
```typescript
// Breaks if config not updated
const apiKey = config.get('NEW_API_KEY');  // Throws if not set
callThirdPartyAPI(apiKey);
```

**✅ GOOD: Safe default**
```typescript
// Works with or without config
const apiKey = config.get('NEW_API_KEY', 'default-key');
callThirdPartyAPI(apiKey);

// Or: Gracefully degrade
const apiKey = config.get('NEW_API_KEY');
if (apiKey) {
  callThirdPartyAPI(apiKey);
} else {
  logger.warn('NEW_API_KEY not set, using fallback');
  callOldAPI();
}
```

### Configuration Expand/Contract

**Example:** Replace `DATABASE_URL` with `DATABASE_HOST` + `DATABASE_PORT`

**Phase 1: EXPAND (Deploy 1)**
```typescript
// Support BOTH old and new config
function getDatabaseConfig() {
  // Try new config first
  const host = config.get('DATABASE_HOST');
  const port = config.get('DATABASE_PORT');

  if (host && port) {
    return { host, port };
  }

  // Fallback to old config
  const url = config.get('DATABASE_URL');
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port, 10)
    };
  }

  throw new Error('Database config not found');
}
```

**Phase 2: MIGRATE**
- Update config files to use new format
- Deploy to all environments

**Phase 3: CONTRACT (Deploy 2)**
```typescript
// Only support new config
function getDatabaseConfig() {
  const host = config.get('DATABASE_HOST');
  const port = config.get('DATABASE_PORT');

  if (!host || !port) {
    throw new Error('DATABASE_HOST and DATABASE_PORT required');
  }

  return { host, port };
}
```

## Step 7: Client SDK Compatibility Matrix

Track which client versions are compatible with which server versions.

### Client Version Matrix

```markdown
## Client Compatibility Matrix

| Client Type | Version | Server v2.3 | Server v2.4 | Server v2.5 | Notes |
|-------------|---------|-------------|-------------|-------------|-------|
| Web App | Latest | ✅ | ✅ | ✅ | Always latest (instant deploy) |
| iOS App | 3.0 | ✅ | ✅ | ✅ | Current version (85% of users) |
| iOS App | 2.9 | ✅ | ✅ | ⚠️ | Deprecated (10% of users) - force upgrade |
| iOS App | 2.8 | ✅ | ❌ | ❌ | Unsupported (3% of users) - force upgrade |
| Android App | 3.0 | ✅ | ✅ | ✅ | Current version (80% of users) |
| Android App | 2.9 | ✅ | ✅ | ⚠️ | Deprecated (15% of users) - force upgrade |
| Android App | 2.8 | ✅ | ❌ | ❌ | Unsupported (5% of users) - force upgrade |
| API Partners | v1 | ✅ | ✅ | ✅ | Always supported (backwards compat) |
| API Partners | v2 | N/A | ✅ | ✅ | New version (30% adoption) |

**Summary:**
- ✅ Fully compatible
- ⚠️ Works with warnings (deprecated features)
- ❌ Not compatible (breaking changes)

**Action items:**
- Force upgrade iOS 2.8 → 3.0 (3% of users) before deploying server v2.4
- Force upgrade Android 2.8 → 3.0 (5% of users) before deploying server v2.4
- Contact API partners to upgrade to v2 (70% still on v1)
```

### Client Deprecation Strategy

**Deprecation timeline:**
```
Phase 1: Announce deprecation (in-app banner, email)
Phase 2: Show upgrade prompt on every launch
Phase 4: Disable deprecated features (show error message)
Phase 6: Force upgrade (app won't launch)
Phase 8: Server stops supporting old version
```

**Force upgrade implementation:**
```typescript
// Server: Check client version
app.use((req, res, next) => {
  const clientVersion = req.headers['x-app-version'];
  const minVersion = '3.0.0';

  if (semver.lt(clientVersion, minVersion)) {
    return res.status(426).json({
      error: 'upgrade_required',
      message: 'Please upgrade to the latest version',
      min_version: minVersion,
      download_url: 'https://example.com/download'
    });
  }

  next();
});

// Client: Handle upgrade_required
if (response.status === 426) {
  showForceUpgradeDialog({
    message: response.data.message,
    downloadUrl: response.data.download_url
  });
}
```

## Step 8: Compatibility Report

Generate comprehensive report at `.claude/<SESSION_SLUG>/compatibility-<change-slug>.md`:

```markdown
# Compatibility Analysis: [Change Title]

**Date:** YYYY-MM-DD
**Author:** [Name]
**Change:** [Description]
**Type:** [API / Database / Events / Config]

---

## Executive Summary

**Compatibility status:** [SAFE / BREAKING / NEEDS MIGRATION]

**Breaking changes:** [count]
**Migration phases:** [count]
**Estimated timeline:** [X deployment phases]

**Top risks:**
1. [Risk 1]
2. [Risk 2]
3. [Risk 3]

**Recommendation:** [Deploy immediately / Use expand/contract / Wait for client adoption]

---

## Change Analysis

[API/Database/Event changes with compatibility assessment]

---

## Compatibility Matrix

[Tables from Step 2/7]

---

## Migration Strategy

[Expand/contract plan from Step 3/4/5]

---

## Rollback Plan

[How to roll back each phase]

---

## Client Impact

[Which clients affected, deprecation timeline]

---

## Timeline

[Phase-by-phase deployment plan]

---

## Sign-off

[Project owner approvals (if needed)]
```

## Summary

A comprehensive compatibility check:

1. **API compatibility matrix** (old client vs new server)
2. **Expand/contract migrations** (multi-phase, reversible)
3. **Database schema compatibility** (safe column operations)
4. **Event schema evolution** (versioning strategies)
5. **Configuration safe defaults** (works without config change)
6. **Client SDK compatibility** (version matrix, force upgrade)
7. **Deprecation timeline** (announce → warn → force upgrade)
8. **Rollback safety** (can we roll back each phase?)

**Key principles:**
- Backwards compatibility first
- Multi-phase migrations (expand → migrate → contract)
- Support old and new simultaneously
- Validate rollback safety
- Force upgrade for unsupported clients
- Document compatibility matrix

**The goal:** Deploy changes with zero downtime and no breaking changes for existing clients.
