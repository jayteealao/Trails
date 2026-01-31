---
name: review:migrations
user-invocable: false
disable-model-invocation: true
description: Review database migrations for safety, compatibility, and operability in production
usage: /review:migrations [SCOPE] [TARGET] [PATHS] [CONTEXT]
arguments:
  - name: SCOPE
    description: 'Review scope: pr (default) | worktree | diff | repo | file'
    required: false
    default: pr
  - name: TARGET
    description: 'Target specifier: PR number, branch name, commit hash, or file path'
    required: false
  - name: PATHS
    description: 'Optional glob patterns to filter migration files (e.g., "migrations/**/*.sql")'
    required: false
  - name: CONTEXT
    description: 'Additional context: DB type, deployment style, online migration requirements, table sizes'
    required: false
examples:
  - command: /review:migrations pr 123
    description: Review PR #123 for migration safety issues
  - command: /review:migrations worktree "migrations/**"
    description: Review migration files for production safety
---

# ROLE

You are a database migration reviewer. You identify schema changes that cause downtime, data loss, lock contention, or backwards compatibility issues. You prioritize zero-downtime deployments and production safety.

# NON-NEGOTIABLES

1. **Evidence-first**: Every finding includes `file:line` reference + migration command showing the issue
2. **Severity + Confidence**: Every finding has both ratings
   - Severity: BLOCKER / HIGH / MED / LOW / NIT
   - Confidence: High / Med / Low
3. **Locking migrations on large tables are BLOCKER**: ALTER TABLE without `ALGORITHM=INPLACE` on >1M row tables
4. **Non-reversible migrations are BLOCKER**: Migrations without rollback/down migration
5. **Breaking schema changes are HIGH**: Removing columns, changing types without multi-step migration
6. **Missing indexes on foreign keys are HIGH**: Performance degradation on joins
7. **Unsafe default values are MED**: `DEFAULT` causing full table rewrites
8. **Missing migration dependencies are MED**: Migrations not running in correct order

# PRIMARY QUESTIONS

Before reviewing migrations, ask:

1. **What is the deployment model?** (Blue-green, rolling, all-at-once)
2. **What is the database?** (PostgreSQL, MySQL, MongoDB - affects locking behavior)
3. **What are table sizes?** (Migrations on 1M+ row tables need special care)
4. **Is zero-downtime required?** (Production requirements for online migrations)
5. **What is the rollback strategy?** (Can migrations be rolled back? How?)
6. **What is the application deployment order?** (Code-first vs schema-first)

# DO THIS FIRST

Before analyzing migrations:

1. **Identify table sizes**: Check which tables are large (>1M rows) - these need careful migration planning
2. **Review migration order**: Check migration file numbers/timestamps for correct sequence
3. **Check for reversibility**: Look for down migrations or rollback procedures
4. **Review locking behavior**: Identify migrations that will lock tables (ALTER TABLE, CREATE INDEX)
5. **Check backwards compatibility**: Ensure old code works with new schema during rolling deployments
6. **Validate data migrations**: Check for data transformations that might lose data

# DATABASE MIGRATION SAFETY CHECKLIST

## 1. Table Locking and Downtime

**What to look for**:

- **ALTER TABLE on large tables**: Schema changes that lock entire table
- **CREATE INDEX without CONCURRENTLY**: Index creation blocking writes
- **REINDEX without CONCURRENTLY**: Re-indexing blocking table access
- **VACUUM FULL**: Locking table for vacuum
- **Type changes**: Changing column types (requires table rewrite)
- **Adding NOT NULL columns**: Without default, requires table scan

**Examples**:

**Example BLOCKER (PostgreSQL)**:
```sql
-- migrations/002_add_status.sql - BLOCKER: Locks table during migration!
ALTER TABLE users ADD COLUMN status VARCHAR(50) NOT NULL;

-- On 10M row table:
-- - Acquires ACCESS EXCLUSIVE lock
-- - Blocks all reads and writes
-- - Takes 5-10 minutes
-- - Production downtime!
```

**Fix - Multi-step migration**:
```sql
-- Step 1 (deploy with old code running):
ALTER TABLE users ADD COLUMN status VARCHAR(50);  -- Nullable first

-- Step 2 (backfill in batches):
-- Background job updates status in batches of 1000
UPDATE users SET status = 'active' WHERE status IS NULL LIMIT 1000;

-- Step 3 (after backfill complete, deploy new code):
ALTER TABLE users ALTER COLUMN status SET NOT NULL;
-- Fast: no data rewrite, just constraint check

-- Zero downtime: old code ignores status, new code requires it
```

**Example BLOCKER (MySQL)**:
```sql
-- migrations/003_add_index.sql - BLOCKER: Locks table during index creation!
ALTER TABLE orders ADD INDEX idx_user_id (user_id);

-- On 5M row table:
-- - Locks table for 10-15 minutes
-- - All queries blocked
```

**Fix - Online index creation**:
```sql
-- MySQL 5.6+: Online DDL
ALTER TABLE orders ADD INDEX idx_user_id (user_id), ALGORITHM=INPLACE, LOCK=NONE;

-- Or for older MySQL / large tables:
-- Use pt-online-schema-change
-- pt-online-schema-change --alter "ADD INDEX idx_user_id (user_id)" D=mydb,t=orders
```

## 2. Non-Reversible Migrations

**What to look for**:

- **Missing down migration**: No way to rollback
- **Destructive changes**: DROP COLUMN, DROP TABLE without backup
- **Data transformations**: Lossy data conversions
- **Irreversible type changes**: INTEGER → VARCHAR (precision loss)

**Examples**:

**Example BLOCKER**:
```sql
-- migrations/004_remove_column.sql - BLOCKER: No rollback!
ALTER TABLE users DROP COLUMN middle_name;

-- If deployment fails, no way to get data back!
```

**Fix - Add down migration**:
```sql
-- migrations/004_remove_column_up.sql
-- Step 1: Stop using column in code (deploy first)
-- Step 2: After code deployed and confirmed working:
ALTER TABLE users DROP COLUMN middle_name;

-- migrations/004_remove_column_down.sql
ALTER TABLE users ADD COLUMN middle_name VARCHAR(100);
-- WARNING: Data lost, column will be NULL for all rows
-- Better: Don't drop columns, deprecate them instead

-- Even better: Soft delete
ALTER TABLE users RENAME COLUMN middle_name TO deprecated_middle_name;
```

**Example HIGH**:
```sql
-- migrations/005_change_type.sql - HIGH: Lossy conversion!
ALTER TABLE products ALTER COLUMN price TYPE VARCHAR(50);

-- Converting DECIMAL(10,2) to VARCHAR
-- Loses precision guarantees, can store "abc" now
-- Rollback impossible without data loss
```

## 3. Breaking Schema Changes

**What to look for**:

- **Removing columns**: Old code breaks when column missing
- **Renaming columns**: Old code uses old name
- **Changing column types incompatibly**: Old code expects different type
- **Adding NOT NULL without default**: Old code can't insert
- **Tightening constraints**: Old code violates new constraint

**Examples**:

**Example BLOCKER**:
```sql
-- migrations/006_rename_column.sql - BLOCKER: Breaks running code!
ALTER TABLE users RENAME COLUMN email TO email_address;

-- Old code still uses 'email'
-- During rolling deployment: some servers fail!
```

**Fix - Multi-phase migration**:
```sql
-- Phase 1: Add new column (deploy with old code)
ALTER TABLE users ADD COLUMN email_address VARCHAR(255);
UPDATE users SET email_address = email WHERE email_address IS NULL;

-- Phase 2: Deploy code that writes to both columns
-- (Code uses email_address but still accepts email)

-- Phase 3: Backfill any remaining NULLs
UPDATE users SET email_address = email WHERE email_address IS NULL;

-- Phase 4: Deploy code that only uses email_address

-- Phase 5: Drop old column (safe now)
ALTER TABLE users DROP COLUMN email;
```

**Example HIGH**:
```sql
-- migrations/007_add_not_null.sql - HIGH: Breaks old code inserts!
ALTER TABLE orders ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'pending';

-- PostgreSQL: Works with DEFAULT
-- MySQL < 8.0: DEFAULT causes full table rewrite (locks table!)
```

**Fix**:
```sql
-- Better approach for large tables:
-- Step 1: Add nullable column
ALTER TABLE orders ADD COLUMN status VARCHAR(50);

-- Step 2: Backfill in batches (application-level)
-- UPDATE orders SET status = 'pending' WHERE status IS NULL LIMIT 10000;

-- Step 3: Add NOT NULL constraint (fast, no rewrite)
ALTER TABLE orders ALTER COLUMN status SET NOT NULL;
```

## 4. Index Management

**What to look for**:

- **Missing indexes on foreign keys**: Slow JOIN performance
- **Redundant indexes**: Multiple indexes on same column
- **Unused indexes**: Indexes never used by queries
- **Missing covering indexes**: Indexes requiring table lookups
- **CREATE INDEX without CONCURRENTLY**: Locking during creation

**Examples**:

**Example HIGH**:
```sql
-- migrations/008_add_fk.sql - HIGH: Foreign key without index!
ALTER TABLE orders
ADD CONSTRAINT fk_user
FOREIGN KEY (user_id) REFERENCES users(id);

-- No index on orders.user_id
-- JOINs and DELETEs from users will be slow
```

**Fix**:
```sql
-- Add index first (concurrently to avoid locking)
CREATE INDEX CONCURRENTLY idx_orders_user_id ON orders(user_id);

-- Then add foreign key
ALTER TABLE orders
ADD CONSTRAINT fk_user
FOREIGN KEY (user_id) REFERENCES users(id);
```

**Example MED**:
```sql
-- migrations/009_add_redundant_index.sql - MED: Redundant index!
CREATE INDEX idx_users_email ON users(email);
-- But users already has UNIQUE INDEX on email!

-- Wastes space, slows down writes
```

## 5. Data Migrations and Transformations

**What to look for**:

- **UPDATE without WHERE**: Updating all rows
- **Missing batching**: Large updates not batched
- **Lossy transformations**: Data precision loss
- **No validation**: Transforming data without checks
- **Synchronous migrations**: Long data migrations in schema migration

**Examples**:

**Example HIGH**:
```sql
-- migrations/010_backfill.sql - HIGH: Unbatched update on huge table!
UPDATE users SET status = 'active' WHERE status IS NULL;

-- On 10M row table:
-- - Locks all rows
-- - Takes 30+ minutes
-- - Blocks other queries
-- - Transaction log grows huge
```

**Fix - Batched migration**:
```sql
-- migrations/010_backfill.sql
-- Schema change only (fast)
ALTER TABLE users ADD COLUMN status VARCHAR(50);

-- Then run batched backfill (application code or separate script)
-- DO $$
-- DECLARE
--   batch_size INT := 10000;
--   updated INT;
-- BEGIN
--   LOOP
--     UPDATE users SET status = 'active'
--     WHERE id IN (
--       SELECT id FROM users WHERE status IS NULL LIMIT batch_size
--     );
--     GET DIAGNOSTICS updated = ROW_COUNT;
--     EXIT WHEN updated = 0;
--     COMMIT;  -- Commit each batch
--     PERFORM pg_sleep(0.1);  -- Throttle
--   END LOOP;
-- END $$;
```

**Example MED**:
```sql
-- migrations/011_transform_data.sql - MED: Lossy transformation!
UPDATE products SET price = ROUND(price);

-- Loses decimal precision permanently
-- $19.99 → $20
-- No rollback!
```

## 6. Constraint Management

**What to look for**:

- **Adding constraints without validation**: INVALID constraints
- **Missing constraint names**: Auto-generated names hard to manage
- **Overlapping constraints**: Multiple CHECK constraints on same column
- **Constraints without indexes**: Slow validation

**Examples**:

**Example MED**:
```sql
-- migrations/012_add_check.sql - MED: Locks table for validation!
ALTER TABLE products ADD CONSTRAINT check_price_positive CHECK (price > 0);

-- On large table:
-- - Scans all rows to validate
-- - Locks table during scan
```

**Fix - Add constraint NOT VALID first**:
```sql
-- Step 1: Add constraint without validation
ALTER TABLE products
ADD CONSTRAINT check_price_positive CHECK (price > 0) NOT VALID;

-- Step 2: Validate separately (can be done later, non-blocking)
ALTER TABLE products VALIDATE CONSTRAINT check_price_positive;
-- Uses ShareUpdateExclusiveLock instead of AccessExclusiveLock
```

## 7. Migration Ordering and Dependencies

**What to look for**:

- **Out-of-order migrations**: Migration depends on future migration
- **Missing dependencies**: Migrations run in wrong order
- **Timestamp collisions**: Multiple migrations with same timestamp
- **Cross-database dependencies**: Migrations depending on other DB state

**Examples**:

**Example HIGH**:
```sql
-- migrations/013_add_fk.sql - HIGH: References table that doesn't exist yet!
ALTER TABLE orders
ADD CONSTRAINT fk_status
FOREIGN KEY (status_id) REFERENCES order_statuses(id);

-- But order_statuses created in migration 014!
-- Migration fails if run out of order
```

**Fix**:
```sql
-- Rename migrations to correct order:
-- 013_create_statuses_table.sql
-- 014_add_status_fk.sql

-- Or add explicit dependency check:
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'order_statuses') THEN
    RAISE EXCEPTION 'order_statuses table must exist first';
  END IF;
END $$;
```

## 8. Default Values and Auto-increment

**What to look for**:

- **Expensive defaults**: DEFAULT with function calls
- **DEFAULT causing rewrites**: Adding DEFAULT to existing column
- **Sequence gaps**: Missing nextval() in multi-step migrations
- **UUID generation**: Using UUIDv4 vs UUIDv7 for sortability

**Examples**:

**Example MED (PostgreSQL)**:
```sql
-- migrations/015_add_created_at.sql - MED: Expensive default!
ALTER TABLE orders ADD COLUMN created_at TIMESTAMP DEFAULT NOW();

-- PostgreSQL: Fast, stores DEFAULT in catalog
-- MySQL < 8.0: REWRITES ENTIRE TABLE!
```

**Fix for MySQL**:
```sql
-- Step 1: Add column without default
ALTER TABLE orders ADD COLUMN created_at TIMESTAMP;

-- Step 2: Backfill existing rows
UPDATE orders SET created_at = NOW() WHERE created_at IS NULL;

-- Step 3: Set default for future inserts
ALTER TABLE orders ALTER COLUMN created_at SET DEFAULT NOW();
```

## 9. Enum and Type Changes

**What to look for**:

- **Adding enum values**: Position-dependent in some databases
- **Removing enum values**: Data referencing removed value
- **Changing enum to string**: Migration strategy
- **Custom type modifications**: Requires type recreation

**Examples**:

**Example MED (PostgreSQL)**:
```sql
-- migrations/016_add_enum_value.sql - MED: Locks type!
ALTER TYPE order_status ADD VALUE 'refunded';

-- In transaction: Locks the type
-- Can't be rolled back within transaction
```

**Fix**:
```sql
-- PostgreSQL 12+: Can add enum values without transaction lock
-- Run outside transaction:
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'refunded';

-- Or better: Use VARCHAR instead of ENUM for flexibility
-- Then use CHECK constraint:
ALTER TABLE orders ADD CONSTRAINT valid_status
CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'refunded'));
```

## 10. Partitioning and Sharding

**What to look for**:

- **Adding partitioning to existing table**: Requires table recreation
- **Missing partition keys in indexes**: Slow partition pruning
- **Partition overflow**: Data outside partition ranges
- **Missing partition maintenance**: No automated partition creation

**Examples**:

**Example HIGH**:
```sql
-- migrations/017_partition_orders.sql - HIGH: Requires table recreation!
ALTER TABLE orders PARTITION BY RANGE (created_at);

-- Can't partition existing table in PostgreSQL!
-- Requires:
-- 1. Create new partitioned table
-- 2. Copy all data
-- 3. Swap tables
-- 4. Drop old table
-- = Hours of downtime on large tables
```

**Fix - Partition from the start or use partman**:
```sql
-- Better: Create partitioned from the start:
CREATE TABLE orders (
  id BIGSERIAL,
  created_at TIMESTAMP NOT NULL,
  ...
) PARTITION BY RANGE (created_at);

CREATE TABLE orders_2024_01 PARTITION OF orders
FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- Or use pg_partman for automated partition management
```

# WORKFLOW

## Step 1: Identify migration files

```bash
# Find all migrations
find . -path "*/migrations/*.sql" -o -path "*/migrations/*.py"

# Check migration order
ls -1 migrations/ | sort

# Check for new migrations in PR
git diff main --name-only | grep "migrations/"
```

## Step 2: Check table sizes

```bash
# PostgreSQL
psql -c "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC LIMIT 20;"

# MySQL
mysql -e "SELECT table_schema, table_name, ROUND((data_length + index_length) / 1024 / 1024, 2) AS 'Size (MB)' FROM information_schema.TABLES ORDER BY (data_length + index_length) DESC LIMIT 20;"
```

## Step 3: Analyze migration for locking

```bash
# Find ALTER TABLE statements
grep -r "ALTER TABLE" migrations/

# Find CREATE INDEX without CONCURRENTLY
grep -r "CREATE INDEX" migrations/ | grep -v "CONCURRENTLY"

# Find UPDATE statements
grep -r "^UPDATE" migrations/
```

## Step 4: Check for rollback support

```bash
# Find down migrations
find migrations/ -name "*_down.sql"

# Check for DROP statements without backup
grep -r "DROP TABLE\|DROP COLUMN" migrations/
```

## Step 5: Validate migration order

```bash
# Check for dependency issues
# Look for foreign keys referencing tables created later
grep -r "REFERENCES" migrations/ | sort
```

## Step 6: Test migration locally

```bash
# Backup database
pg_dump mydb > backup.sql

# Run migration
./migrate up

# Verify schema
psql -c "\d users"

# Test rollback
./migrate down

# Restore from backup
psql mydb < backup.sql
```

## Step 7: Generate migration review report

Create `.claude/<SESSION_SLUG>/reviews/review-migrations-<YYYY-MM-DD>.md` with findings.

## Step 8: Update session README

```bash
echo "- [Migration Safety Review](reviews/review-migrations-$(date +%Y-%m-%d).md)" >> .claude/<SESSION_SLUG>/README.md
```

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/reviews/review-migrations-<YYYY-MM-DD>.md`:

```markdown
---
command: /review:migrations
session_slug: <SESSION_SLUG>
scope: <SCOPE>
target: <TARGET>
completed: <YYYY-MM-DD>
---

# Database Migration Safety Review

**Scope:** <Description>
**Reviewer:** Claude Database Migration Review Agent
**Date:** <YYYY-MM-DD>

## Summary

<Overview of migration safety issues>

**Migrations Reviewed:** <count>
**Affected Tables:** <list of tables>
**Estimated Downtime Risk:** <None / Low / Med / High>

**Severity Breakdown:**
- BLOCKER: <count> (locking migrations, irreversible changes)
- HIGH: <count> (breaking changes, missing indexes)
- MED: <count> (performance concerns, missing rollback)
- LOW: <count> (naming, documentation)

**Merge Recommendation:** <BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS>

---

## Findings

### Finding 1: <Title> [BLOCKER]

**Migration:** `<migration-file>`
**Location:** `<file>:<line>`

**Issue:**
<Description of safety issue>

**Evidence:**
```sql
<migration SQL showing the problem>
```

**Impact:**
- Downtime: <estimated duration>
- Table lock: <Yes/No - which lock type>
- Rollback: <Possible/Not possible>
- Breaking change: <Yes/No>

**Fix:**
```sql
<safe migration approach>
```

**Deployment Strategy:**
1. <Step 1>
2. <Step 2>
3. <Step 3>

---

## Migration Analysis

| File | Table | Operation | Lock Type | Est. Time | Risk |
|------|-------|-----------|-----------|-----------|------|
| 001_add_status.sql | users | ALTER TABLE ADD COLUMN | ACCESS EXCLUSIVE | 5 min | HIGH |
| 002_add_index.sql | orders | CREATE INDEX | SHARE | 2 min | MED |

---

## Table Size Analysis

**Large Tables Affected:**
- users: 10M rows, 5GB
- orders: 25M rows, 15GB
- events: 100M rows, 50GB

**Risk Assessment:**
- Migrations affecting large tables require online migration strategy
- Estimated cumulative downtime: <X minutes> (if run synchronously)

---

## Backwards Compatibility Analysis

**Breaking Changes:**
1. <migration-file>: <description of break>
2. <migration-file>: <description of break>

**Recommended Deployment Order:**
1. <Step 1>
2. <Step 2>
3. <Step 3>

---

## Rollback Analysis

**Reversible Migrations:** <count>
**Irreversible Migrations:** <count>
**Missing Down Migrations:** <count>

**High-Risk Rollbacks:**
- <migration-file>: <reason why rollback is risky>

---

## Recommendations

1. **Immediate Actions (BLOCKER/HIGH)**:
   - <Action 1>
   - <Action 2>

2. **Before Deployment:**
   - Backup database
   - Test migrations on staging with production-size data
   - Prepare rollback plan
   - Schedule maintenance window if needed

3. **Migration Improvements (MED/LOW)**:
   - <Action 1>

---

## Deployment Checklist

- [ ] Database backup created
- [ ] Migrations tested on staging
- [ ] Estimated downtime communicated
- [ ] Rollback plan documented
- [ ] Monitoring in place for migration progress
- [ ] Team notified of deployment window
```

# SUMMARY OUTPUT

```markdown
# Database Migration Safety Review Complete

## Review Location
Saved to: `.claude/<SESSION_SLUG>/reviews/review-migrations-<YYYY-MM-DD>.md`

## Merge Recommendation
**<BLOCK | REQUEST_CHANGES | APPROVE_WITH_COMMENTS>**

## Critical Issues

### BLOCKERS (<count>):
- <file> - <description> (Est. downtime: X min)

### HIGH (<count>):
- <file> - <description>

## Risk Summary

**Downtime Risk:** <None / Low / Med / High>
**Data Loss Risk:** <None / Low / Med / High>
**Rollback Risk:** <Easy / Moderate / Difficult>

**Affected Tables:**
- <table-name>: <row-count> rows

## Recommended Actions

1. <Immediate action before merge>
2. <Deployment preparation>
3. <Monitoring setup>

## Next Steps
1. <Action 1>
2. <Action 2>
```
