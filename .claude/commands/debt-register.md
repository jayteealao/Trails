---
name: debt-register
description: Convert review findings to prioritized backlog with impact/effort matrix, ROI justification, and dependency tracking
usage: /debt-register [SOURCE] [FORMAT]
arguments:
  - name: SOURCE
    description: 'Source of debt items: review results, file paths, manual input'
    required: false
  - name: FORMAT
    description: 'Output format: jira | github | markdown | csv'
    required: false
    default: markdown
examples:
  - command: /debt-register
    description: Interactive mode - collect and prioritize tech debt
  - command: /debt-register "review-results.md"
    description: Import debt items from review results
  - command: /debt-register "manual" "jira"
    description: Manually add items, output as JIRA tickets
---

# Technical Debt Register

You are a technical debt curator who converts **review findings into actionable backlog items** with clear priorities, ROI justification, and realistic effort estimates. Your goal: create a **prioritized debt register** that helps areas decide what to fix, what to defer, and what to ignore.

## Philosophy: Not All Debt Deserves Fixing

**The hard truth:**
- Most tech debt should be **ignored** (not worth the cost)
- Some debt should be **tracked** (fix when you're nearby)
- Little debt should be **prioritized** (fix proactively)

**Good debt register:**
- Prioritizes by **ROI** (impact ÷ effort)
- Identifies **quick wins** (high impact, low effort)
- Tracks **dependencies** (item A blocks item B)
- Has **acceptance criteria** (specific, testable)
- Includes **"do not do" list** (debt to ignore with rationale)

**Anti-patterns:**
- Treating all debt as equal priority
- Vague items ("improve performance")
- No effort estimates
- No justification for priority
- Backlog that grows forever without action

## Step 1: Gather Debt Items

If `SOURCE` provided, parse it. Otherwise, collect debt interactively.

**Interactive prompts:**
1. **What's the source?**
   - Review results (from `/review:*` commands)
   - Manual entry
   - Incident retrospectives
   - Developer frustrations
   - User pain points

2. **What categories?**
   - Code quality (duplication, complexity, coupling)
   - Architecture (boundaries, abstractions, scalability)
   - Performance (slow queries, N+1, memory leaks)
   - Security (vulnerabilities, exposure, compliance)
   - Testing (coverage, flakiness, slow tests)
   - Developer experience (build time, local setup, docs)
   - Operations (monitoring, alerts, runbooks)

**Parse review results:**
```typescript
// Example: Parse review results from /review:architecture
interface ReviewFinding {
  severity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  title: string;
  description: string;
  location: string;
  recommendation: string;
}

function parseReviewResults(markdown: string): ReviewFinding[] {
  // Extract findings from review markdown
  const findings: ReviewFinding[] = [];

  const sections = markdown.split(/^## /gm);

  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines[0];

    // Look for severity markers
    if (title.includes('BLOCKER') || title.includes('❌')) {
      findings.push({
        severity: 'BLOCKER',
        category: extractCategory(section),
        title: extractTitle(section),
        description: extractDescription(section),
        location: extractLocation(section),
        recommendation: extractRecommendation(section),
      });
    } else if (title.includes('HIGH') || title.includes('⚠️')) {
      findings.push({
        severity: 'HIGH',
        // ... parse HIGH findings
      });
    }
  }

  return findings;
}
```

## Step 2: Assess Impact and Effort

Use a **2-axis matrix** to prioritize:
- **Impact**: High / Medium / Low
- **Effort**: Small (~10-100 LOC) / Medium (~100-500 LOC) / Large (~500+ LOC)

### Impact Assessment

**High impact (must fix eventually):**
- Blocks new features
- Causes frequent incidents
- Slows down all developers
- Security vulnerability
- Significant user pain
- Compliance risk

**Medium impact (nice to fix):**
- Slows down some work
- Occasional incidents
- Developer frustration
- Minor performance issue
- Code smell

**Low impact (probably ignore):**
- Doesn't block anything
- No user impact
- Isolated to one file
- Aesthetic issue

### Effort Assessment

**Small effort (~10-100 LOC):**
- Rename variables
- Extract functions
- Add comments/docs
- Fix simple duplication
- Add logging

**Medium effort (~100-500 LOC):**
- Refactor large function
- Extract service
- Add test coverage
- Optimize query
- Add monitoring

**Large effort (~500+ LOC):**
- Rewrite component
- Change architecture
- Database migration
- Large refactoring
- New infrastructure

### Priority Matrix

```
           │ Small  │ Medium │ Large
───────────┼────────┼────────┼────────
High       │  P0    │   P1   │   P1
Impact     │ (NOW)  │ (SOON) │ (SOON)
───────────┼────────┼────────┼────────
Medium     │  P1    │   P2   │   P3
Impact     │ (SOON) │ (PLAN) │ (DEFER)
───────────┼────────┼────────┼────────
Low        │  P2    │   P3   │  SKIP
Impact     │ (PLAN) │ (DEFER)│ (NEVER)
```

**Priority definitions:**
- **P0 (NOW)**: Fix this sprint (high impact, quick win)
- **P1 (SOON)**: Fix in next 1-2 sprints
- **P2 (PLAN)**: Add to backlog, fix when nearby
- **P3 (DEFER)**: Only fix if very bored
- **SKIP (NEVER)**: Do not fix, not worth it

### ROI Calculation

```typescript
interface DebtItem {
  id: string;
  title: string;
  description: string;
  category: string;

  // Impact assessment
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  impact_details: {
    blocks_features?: boolean;
    incident_frequency?: 'weekly' | 'monthly' | 'rare';
    dev_time_waste_hours_per_week?: number;
    user_pain?: 'critical' | 'moderate' | 'minor';
    security_risk?: boolean;
  };

  // Effort assessment
  effort: 'SMALL' | 'MEDIUM' | 'LARGE';
  effort_days: number;

  // Priority (calculated from impact + effort)
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'SKIP';

  // ROI justification
  roi: {
    cost: string; // e.g., "~100-200 LOC developer time"
    benefit: string; // e.g., "Saves 5 effort saved, prevents incidents"
    payback_period: string; // e.g., "2 deployment phases"
  };

  // Metadata
  location: string;
  owner?: string;
  dependencies: string[]; // IDs of blocking items
  acceptance_criteria: string[];
  created: Date;
}

function calculatePriority(impact: Impact, effort: Effort): Priority {
  const matrix = {
    HIGH: { SMALL: 'P0', MEDIUM: 'P1', LARGE: 'P1' },
    MEDIUM: { SMALL: 'P1', MEDIUM: 'P2', LARGE: 'P3' },
    LOW: { SMALL: 'P2', MEDIUM: 'P3', LARGE: 'SKIP' },
  };

  return matrix[impact][effort];
}

function calculateROI(item: DebtItem): ROI {
  const cost = `${item.effort_days} LOC complexity`;

  let benefit = '';
  let paybackWeeks = 0;

  if (item.impact_details.dev_time_waste_hours_per_week) {
    const savedHours = item.impact_details.dev_time_waste_hours_per_week;
    const savedDays = savedHours / 8;
    paybackWeeks = item.effort_days / savedDays;

    benefit = `Saves ${savedHours} effort saved saved`;
  }

  if (item.impact_details.incident_frequency === 'weekly') {
    benefit += ', Prevents weekly incidents';
  }

  if (item.impact_details.blocks_features) {
    benefit += ', Unblocks new features';
  }

  return {
    cost,
    benefit,
    payback_period: `${Math.ceil(paybackWeeks)} deployment phases`,
  };
}
```

## Step 3: Identify Quick Wins (Top 5)

**Quick wins = High impact + Low effort**

Look for P0 items that deliver disproportionate value:

```typescript
function identifyQuickWins(items: DebtItem[]): DebtItem[] {
  return items
    .filter(item => item.priority === 'P0')
    .sort((a, b) => {
      // Sort by effort (lower = better)
      return a.effort_days - b.effort_days;
    })
    .slice(0, 5);
}
```

**Example: Top 5 Quick Wins**

```markdown
## Top 5 Quick Wins

These items deliver high value with minimal effort. **Fix these first.**

### 1. Add database indexes on users.email [P0]

**Impact:** HIGH
- Every login is slow (500ms → 50ms)
- 10k logins/day = 1.25 effort saved daily
- User-facing performance improvement

**Effort:** SMALL (~10-20 LOC)
- Add index: `CREATE INDEX idx_users_email ON users(email)`
- Deploy via migration
- No code changes needed

**ROI:**
- Cost: ~10-20 LOC
- Benefit: Saves 1.25 daily effort saved (37.5 monthly effort saved)
- Payback: ~10-20 LOC

**Acceptance criteria:**
- [ ] Index added to production database
- [ ] Login p95 latency < 100ms
- [ ] No increase in write latency

**Owner:** database work
**Location:** `database/schema.sql`

---

### 2. Remove N+1 query in /api/orders [P0]

**Impact:** HIGH
- Every order list is slow (2s → 200ms)
- Blocks mobile app release (timeout issues)
- 1000 requests/hour affected

**Effort:** SMALL (~30-50 LOC)
- Add `include: ['items', 'user']` to order query
- Test with 100 orders
- Deploy

**ROI:**
- Cost: ~30-50 LOC
- Benefit: Unblocks mobile release, saves 500ms × 24k requests/day = 3.3 daily effort saved
- Payback: ~10-100 LOC

**Acceptance criteria:**
- [ ] Order list endpoint < 300ms p95
- [ ] Only 2 SQL queries (orders + items, not N+1)
- [ ] Mobile app no longer times out

**Owner:** backend work
**Location:** `src/controllers/orders.ts:45`

---

### 3. Add circuit breaker to recommendation service [P0]

**Impact:** HIGH
- Recommendation service failures cascade to checkout
- 2 incidents in last month (SEV-1)
- Checkout unavailable when recommendations down

**Effort:** SMALL (~50-100 LOC)
- Add opossum circuit breaker
- Fallback to popular items
- Add monitoring

**ROI:**
- Cost: ~50-100 LOC
- Benefit: Prevents 2 SEV-1 incidents/month (~30-50 LOC × 2 = debugging effort saved)
- Payback: ~50-100 LOC

**Acceptance criteria:**
- [ ] Circuit breaker configured (50% error threshold, 30s reset)
- [ ] Fallback returns popular items
- [ ] Checkout works when recommendations down
- [ ] Alert when circuit opens

**Owner:** backend work
**Location:** `src/services/recommendations.ts`

---

### 4. Fix flaky test: test_payment_retry [P0]

**Impact:** HIGH
- Fails 30% of CI runs (false positives)
- Developers ignore CI failures
- Slows down PR merges

**Effort:** SMALL (~10-20 LOC)
- Add proper await for async operations
- Use fixed clock instead of setTimeout
- Increase timeout from 100ms to 1000ms

**ROI:**
- Cost: ~10-20 LOC
- Benefit: Saves 10 effort saved of developer time investigating false failures
- Payback: ~10-100 LOC

**Acceptance criteria:**
- [ ] Test passes 100 times in a row on CI
- [ ] Test duration < 2s
- [ ] No setTimeout or sleep()

**Owner:** testing work
**Location:** `tests/payment.test.ts:123`

---

### 5. Add log sampling to hot path [P0]

**Impact:** HIGH
- 80% of logs are DEBUG in production
- Log bill: $2,400/month (80% unnecessary)
- Can save $1,920/month

**Effort:** SMALL (~50-100 LOC)
- Remove DEBUG logs from hot path
- Add sampling (10% of success, 100% of errors)
- Adopt wide-event pattern

**ROI:**
- Cost: ~50-100 LOC
- Benefit: Saves $1,920/month = $23,040/year
- Payback: < 1 week

**Acceptance criteria:**
- [ ] No DEBUG logs in production
- [ ] Log volume < 50 GB/month
- [ ] Log bill < $500/month
- [ ] All errors still logged

**Owner:** observability work
**Location:** `src/middleware/logger.ts`
```

## Step 4: Track Dependencies

**Dependency graph:**
Some debt items block others. Track these dependencies to plan work order.

```typescript
interface DependencyGraph {
  items: Map<string, DebtItem>;
  edges: Map<string, string[]>; // item_id → [blocked_by_ids]
}

function buildDependencyGraph(items: DebtItem[]): DependencyGraph {
  const graph: DependencyGraph = {
    items: new Map(items.map(item => [item.id, item])),
    edges: new Map(),
  };

  for (const item of items) {
    if (item.dependencies.length > 0) {
      graph.edges.set(item.id, item.dependencies);
    }
  }

  return graph;
}

function findReadyItems(graph: DependencyGraph): DebtItem[] {
  // Items with no unresolved dependencies
  const ready: DebtItem[] = [];

  for (const [id, item] of graph.items) {
    const blockers = graph.edges.get(id) || [];
    const unresolvedBlockers = blockers.filter(blockerId => graph.items.has(blockerId));

    if (unresolvedBlockers.length === 0) {
      ready.push(item);
    }
  }

  return ready.sort((a, b) => {
    // Sort by priority
    const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3, SKIP: 4 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}
```

**Example: Dependency tracking**

```markdown
## Dependency Graph

```
┌─────────────────────────────────────┐
│ DEBT-001: Split payment service     │  P1, ~400-500 LOC
│ (Extract to microservice)           │
└────────────┬────────────────────────┘
             │ blocks
             ↓
┌─────────────────────────────────────┐
│ DEBT-002: Add payment circuit breaker│  P0, ~50-100 LOC
│ (Requires service boundary)          │
└─────────────────────────────────────┘
```

**Work order:**
1. First: Fix DEBT-001 (split payment service)
2. Then: Fix DEBT-002 (add circuit breaker)

**Note:** DEBT-002 is higher priority (P0) but blocked by DEBT-001.

---

```
┌─────────────────────────────────────┐
│ DEBT-003: Upgrade to Node.js 20     │  P1, ~100-200 LOC
└────────────┬────────────────────────┘
             │ blocks
             ↓
┌─────────────────────────────────────┐
│ DEBT-004: Use native test runner    │  P2, 3 days
│ (Node 20+ only)                      │
└─────────────────────────────────────┘
```

**Work order:**
1. First: Upgrade Node.js (P1, unblocks other work)
2. Then: Migrate to native test runner (P2)
```

## Step 5: Create "Do Not Do" List

**Not all debt should be fixed.** Document what to ignore and why.

```markdown
## Do Not Do List

These items are **not worth fixing**. Ignore them.

### 1. Rewrite authentication service ❌

**Why suggested:** "Auth code is old and messy"

**Why skip:**
- Works perfectly (zero incidents in 2 years)
- High risk (security-critical)
- Large effort (3 deployment phases)
- Low benefit (no user/developer pain)

**Decision:** Keep as-is. Only refactor if adding new auth methods.

---

### 2. Extract shared utility library ❌

**Why suggested:** "Same helper functions in 3 services"

**Why skip:**
- Only 50 lines of code duplicated
- Effort to extract: ~100-200 LOC
- Maintenance cost: ongoing versioning, compatibility
- Risk: Breaking changes affect all services

**Decision:** Duplication is cheaper than the wrong abstraction. Keep duplicated.

---

### 3. Achieve 100% test coverage ❌

**Why suggested:** "Only 75% coverage"

**Why skip:**
- Diminishing returns (75% → 100% = ~1000 LOC effort)
- Last 25% is trivial code (getters, setters, error branches)
- No evidence that 100% coverage prevents bugs better than 75%

**Decision:** 75% is sufficient. Focus on critical path coverage, not vanity metrics.

---

### 4. Migrate to latest React ❌

**Why suggested:** "React 16 is old"

**Why skip:**
- Current version works (no bugs, no performance issues)
- Migration effort: 2 deployment phases
- Breaking changes require extensive testing
- No user benefit

**Decision:** Upgrade only if we need new React features. Current version is fine.

---

### 5. Consolidate logging libraries ❌

**Why suggested:** "We use winston, bunyan, and pino"

**Why skip:**
- Each service is independent
- Standardizing requires coordinating 5 areas
- Effort: 1 deployment phase per service × 10 services = 10 deployment phases
- Benefit: Minimal (logs work fine)

**Decision:** Allow different logging libraries per service. Not worth the coordination cost.
```

## Step 6: Define Acceptance Criteria

**Every debt item needs specific, testable acceptance criteria.**

**Bad acceptance criteria:**
- ❌ "Code is cleaner"
- ❌ "Performance is better"
- ❌ "Tests are less flaky"

**Good acceptance criteria:**
- ✅ "Cyclomatic complexity < 10"
- ✅ "API p95 latency < 200ms"
- ✅ "Test passes 100 times consecutively on CI"

**Example: Acceptance criteria template**

```markdown
## DEBT-042: Optimize database connection pooling

**Acceptance criteria:**
- [ ] Connection pool size: 10-50 connections (was 5-100)
- [ ] Connection wait time p95 < 10ms (was 150ms)
- [ ] No "connection pool exhausted" errors in logs
- [ ] Database CPU < 60% under peak load (was 85%)
- [ ] Load test passes: 10k req/s for 10 minutes
- [ ] Documentation updated: docs/database.md
- [ ] Monitoring dashboard created: "Database Pool Health"

**Verification:**
```bash
# Load test
k6 run load-tests/api-stress.js

# Check metrics
curl http://localhost:9090/metrics | grep pool_connections

# Verify no errors
kubectl logs -l app=api --since=1h | grep "pool exhausted" | wc -l
# Expected: 0
```
```

## Step 7: Generate Debt Register Report

Produce complete prioritized backlog:

```markdown
# Technical Debt Register

**Generated:** 2024-01-15
**Source:** Architecture review, performance review, incident retrospectives
**Total items:** 42
**Total effort:** ~8700 LOC total

## Summary

| Priority | Count | Total Effort |
|----------|-------|--------------|
| P0 (NOW) | 5 | ~700 LOC |
| P1 (SOON) | 12 | ~2800 LOC |
| P2 (PLAN) | 15 | 3~100-200 LOC |
| P3 (DEFER) | 7 | ~2000 LOC |
| SKIP | 3 | - |

## Top 5 Quick Wins (Fix First)

**Total effort:** ~700 LOC
**Total value:** Prevent 2 SEV-1/month, save $24k/year, unblock 3 features

1. Add database indexes on users.email [2h] - Saves 37.5 monthly effort saved
2. Remove N+1 query in /api/orders [4h] - Unblocks mobile release
3. Add circuit breaker to recommendation service [1d] - Prevents 2 incidents/month
4. Fix flaky test: test_payment_retry [2h] - Saves 10 effort saved
5. Add log sampling to hot path [1d] - Saves $24k/year

**Recommendation:** Complete these 5 items this sprint.

---

## All Debt Items

### P0: NOW (Fix This Sprint)

#### DEBT-001: Add database indexes on users.email

**Category:** Performance
**Impact:** HIGH - Every login is slow (500ms → 50ms)
**Effort:** SMALL (~10-20 LOC)
**Priority:** P0

**Description:**
The `users` table has 500k rows but no index on `email` column. Every login query does a full table scan.

**ROI:**
- Cost: ~10-20 LOC
- Benefit: Saves 1.25 daily effort saved (37.5 monthly effort saved)
- Payback: ~10-20 LOC

**Location:** `database/schema.sql`

**Dependencies:** None

**Acceptance criteria:**
- [ ] Index added: `CREATE INDEX idx_users_email ON users(email)`
- [ ] Login p95 latency < 100ms
- [ ] No increase in write latency

**Owner:** database work

**Implementation plan:**
```sql
-- 1. Add index (online, non-blocking)
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);

-- 2. Verify index is used
EXPLAIN SELECT * FROM users WHERE email = 'test@example.com';
-- Should show "Index Scan using idx_users_email"

-- 3. Monitor query performance
SELECT
  query,
  mean_exec_time,
  calls
FROM pg_stat_statements
WHERE query LIKE '%users%email%'
ORDER BY mean_exec_time DESC;
```

---

#### DEBT-002: Remove N+1 query in /api/orders

**Category:** Performance
**Impact:** HIGH - Blocks mobile app release (timeout issues)
**Effort:** SMALL (~30-50 LOC)
**Priority:** P0

**Description:**
Order list endpoint loads orders, then makes 1 query per order for items (N+1). For 100 orders, this is 101 queries.

**ROI:**
- Cost: ~30-50 LOC
- Benefit: Unblocks mobile release, saves 500ms × 24k requests/day
- Payback: ~10-100 LOC

**Location:** `src/controllers/orders.ts:45`

**Dependencies:** None

**Acceptance criteria:**
- [ ] Order list endpoint < 300ms p95
- [ ] Only 2 SQL queries (orders + items)
- [ ] Mobile app no longer times out
- [ ] Load test passes: 1000 concurrent users

**Owner:** backend work

**Implementation:**
```typescript
// ❌ BEFORE: N+1 queries
async function getOrders(userId: string) {
  const orders = await db.orders.findMany({
    where: { userId },
  });

  for (const order of orders) {
    order.items = await db.orderItems.findMany({
      where: { orderId: order.id },
    });
  }

  return orders;
}

// ✅ AFTER: 2 queries with eager loading
async function getOrders(userId: string) {
  const orders = await db.orders.findMany({
    where: { userId },
    include: {
      items: true,
      user: { select: { email: true, name: true } },
    },
  });

  return orders;
}
```

---

#### DEBT-003: Add circuit breaker to recommendation service

**Category:** Reliability
**Impact:** HIGH - 2 SEV-1 incidents in last month
**Effort:** SMALL (~50-100 LOC)
**Priority:** P0

**Description:**
When recommendation service is down, checkout fails (cascade failure). Need circuit breaker with fallback.

**ROI:**
- Cost: ~50-100 LOC
- Benefit: Prevents 2 SEV-1 incidents/month (debugging effort saved)
- Payback: ~50-100 LOC

**Location:** `src/services/recommendations.ts`

**Dependencies:** None

**Acceptance criteria:**
- [ ] Circuit breaker configured (50% error threshold, 30s reset)
- [ ] Fallback returns top 10 popular items
- [ ] Checkout works when recommendations down
- [ ] Alert fires when circuit opens
- [ ] Runbook created: docs/runbooks/recommendations.md

**Owner:** backend work

**Implementation:**
```typescript
import CircuitBreaker from 'opossum';

const recommendationBreaker = new CircuitBreaker(fetchRecommendations, {
  timeout: 2000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
});

recommendationBreaker.fallback(async (userId: string) => {
  // Fallback: return popular items
  return getPopularItems(10);
});

recommendationBreaker.on('open', () => {
  logger.error('circuit_breaker_opened', { service: 'recommendations' });
  metrics.gauge('circuit_breaker.state', 1, { service: 'recommendations' });
});

async function getRecommendations(userId: string) {
  return await recommendationBreaker.fire(userId);
}
```

---

[Continue for DEBT-004, DEBT-005...]

---

### P1: SOON (Fix in Next 1-2 Sprints)

#### DEBT-006: Split payment service into microservice

**Category:** Architecture
**Impact:** HIGH - Blocks 3 areas working on payments
**Effort:** LARGE (~400-500 LOC)
**Priority:** P1

**Description:**
Payment logic is embedded in monolith. Need to extract to separate service for independent deployment and scaling.

**ROI:**
- Cost: ~400-500 LOC
- Benefit: Unblocks 3 areas, enables independent deploys, improves scalability
- Payback: 2 deployment phases

**Location:** `src/services/payment/**`

**Dependencies:** None

**Blocks:**
- DEBT-007: Add payment webhooks (needs service boundary)
- DEBT-008: Scale payment processing (needs independent scaling)

**Acceptance criteria:**
- [ ] New service: payment-api (Node.js + Express)
- [ ] REST API: POST /v1/charges, GET /v1/charges/:id
- [ ] Database: separate payment_db (not shared)
- [ ] Deployed: Kubernetes with 3 replicas
- [ ] Monitored: Datadog dashboard, alerts
- [ ] Documented: API docs, runbook
- [ ] Zero downtime migration (gradual traffic shift)
- [ ] Rollback tested

**Owner:** architecture work

**Implementation plan:**
1. Week 1: Create new service skeleton
2. Week 1: Extract payment logic from monolith
3. Week 1: Add API endpoints
4. Week 1: Add database migrations
5. Week 2: Deploy to staging, test
6. Week 2: Gradual rollout (1% → 10% → 100%)
7. Week 2: Remove old code from monolith

---

[Continue for DEBT-007 through DEBT-018...]

---

### P2: PLAN (Add to Backlog, Fix When Nearby)

[Continue for DEBT-019 through DEBT-033...]

---

### P3: DEFER (Fix If Very Bored)

[Continue for DEBT-034 through DEBT-040...]

---

### SKIP: DO NOT FIX

[List items that should NOT be fixed, with rationale...]

---

## Dependency Graph

**Critical path (must be done in order):**

```
1. DEBT-006: Split payment service [5d]
   └─→ DEBT-007: Add payment webhooks [2d]
       └─→ DEBT-008: Scale payment processing [3d]

Total: ~1000 LOC (sequential)
```

**Parallel work (can be done concurrently):**

```
Group A: Performance (~700 LOC)
- DEBT-001: Add database indexes [2h]
- DEBT-002: Remove N+1 queries [4h]
- DEBT-004: Optimize cache [1d]
- DEBT-005: Add query monitoring [1d]

Group B: Reliability (~400-500 LOC)
- DEBT-003: Add circuit breaker [1d]
- DEBT-009: Add retries [1d]
- DEBT-010: Add timeouts [1d]

Group C: Testing (~800 LOC)
- DEBT-011: Fix flaky tests [2d]
- DEBT-012: Add integration tests [3d]
- DEBT-013: Add contract tests [3d]

All groups can run in parallel by different contributors.
```

---

## Execution Plan

### Sprint 1 (This Sprint): Quick Wins

**Goal:** Fix top 5 quick wins
**Effort:** ~700 LOC
**Value:** Prevent 2 SEV-1/month, save $24k/year, unblock mobile release

**Items:**
- DEBT-001: Add database indexes [2h]
- DEBT-002: Remove N+1 query [4h]
- DEBT-003: Add circuit breaker [1d]
- DEBT-004: Fix flaky test [2h]
- DEBT-005: Add log sampling [1d]

**Success metrics:**
- Login latency < 100ms
- Order list latency < 300ms
- Zero SEV-1 incidents from recommendations
- CI flakiness < 1%
- Log bill < $500/month

---

### Sprint 2-3: High-Value P1 Items

**Goal:** Fix critical architecture and reliability issues
**Effort:** 1~400-500 LOC
**Value:** Unblock 3 areas, improve scalability, reduce incidents

**Items:**
- DEBT-006: Split payment service [5d]
- DEBT-007: Add payment webhooks [2d]
- DEBT-009: Add retries to external APIs [1d]
- DEBT-010: Add timeouts everywhere [1d]
- DEBT-011: Fix all flaky tests [2d]
- DEBT-012: Add integration test suite [3d]

---

### Sprint 4-6: Remaining P1 + High-Value P2

**Goal:** Address remaining high-priority items
**Effort:** ~2000 LOC

[Continue plan...]

---

## Metrics & Monitoring

**Track debt metrics:**
- Total debt items: 42
- P0 items: 5 → 0 (goal: fix this sprint)
- P1 items: 12 → 6 (goal: cut in half)
- Debt age: Median 4~400-500 LOC (goal: < 30 deployment phases for P0/P1)
- Completion rate: 5 items/sprint (goal: 8 items/sprint)

**Prevent new debt:**
- Require architecture review for new services
- Require performance testing for new features
- Add "technical debt" label in PRs
- Quarterly debt audit

**Celebrate wins:**
- Announce completed debt items in project meeting
- Track cost savings (e.g., "$24k/year saved from log optimization")
- Measure impact (e.g., "2 fewer incidents/month")

---

## Appendix: All Items by Category

### Performance (8 items, 1~100-200 LOC)
- DEBT-001: Add database indexes [P0, 2h]
- DEBT-002: Remove N+1 query [P0, 4h]
- DEBT-015: Optimize image loading [P1, 2d]
- DEBT-016: Add Redis cache [P1, 3d]
- DEBT-024: Lazy load components [P2, 1d]
- DEBT-025: Optimize bundle size [P2, 2d]
- DEBT-035: Add service worker [P3, 3d]
- DEBT-041: Optimize database schema [P3, 5d]

### Reliability (6 items, ~900 LOC)
- DEBT-003: Add circuit breaker [P0, 1d]
- DEBT-009: Add retries [P1, 1d]
- DEBT-010: Add timeouts [P1, 1d]
- DEBT-017: Add health checks [P1, 1d]
- DEBT-026: Add graceful shutdown [P2, 2d]
- DEBT-036: Add rate limiting [P3, 3d]

[Continue for other categories...]
```

## Examples

### Example 1: Review Results → Debt Register

**Input:** Architecture review found 12 issues

**Process:**
1. Parse review findings
2. Assess impact/effort for each
3. Calculate priorities
4. Identify dependencies
5. Create debt items with acceptance criteria

**Output:** 12 debt items, 3 P0, 5 P1, 3 P2, 1 P3

---

### Example 2: Performance Debt Items

```markdown
## DEBT-023: Database connection pool exhaustion

**Category:** Performance
**Impact:** HIGH
- 5 incidents in last month (connection timeout errors)
- Blocks all API requests when pool exhausted
- Requires manual restart

**Effort:** MEDIUM (~100-200 LOC)
- Investigate pool configuration
- Add connection monitoring
- Implement connection recycling
- Load test

**Priority:** P1

**ROI:**
- Cost: ~100-200 LOC
- Benefit: Prevents 5 incidents/month (10 debugging effort saved)
- Payback: 1 week

**Root cause:**
- Pool size: 10 connections
- Peak load: 50 concurrent requests
- Connections leak (not released)

**Solution:**
1. Increase pool size: 10 → 50
2. Add connection timeout: 30s
3. Add monitoring: alert when pool > 80% full
4. Fix connection leaks (use `finally` blocks)

**Acceptance criteria:**
- [ ] Pool size 20-50 connections
- [ ] No "connection timeout" errors in logs
- [ ] Alert fires when pool > 80% full
- [ ] Load test passes: 100 req/s for 10 minutes
- [ ] Connection leak detection: all connections released

**Location:** `src/database/pool.ts`
**Owner:** backend work
```

---

### Example 3: "Do Not Do" List

```markdown
## DEBT-SKIP-001: Rewrite frontend in React 19

**Suggested by:** Frontend developer
**Reason:** "React 16 is old, we should use latest"

**Why skip:**
- Current React 16 works perfectly (no bugs, no slowness)
- Migration effort: 6 deployment phases (rewrite all components)
- Risk: Breaking changes, extensive testing needed
- User benefit: Zero (no visible improvements)
- Developer benefit: Minimal (new features we don't use)

**Cost-benefit:**
- Cost: 6 deployment phases × $10k/week = $60k
- Benefit: $0 (no measurable improvement)
- ROI: Negative

**Decision:** SKIP. React 16 is fine. Only upgrade if we need React 19 features.

**Alternative:** Upgrade to React 18 (easier migration, better hooks)
```

## Debt Register Philosophy

**Good debt management:**
- ✅ Prioritize by ROI (impact ÷ effort)
- ✅ Fix quick wins first (high impact, low effort)
- ✅ Track dependencies (what blocks what)
- ✅ Define acceptance criteria (specific, measurable)
- ✅ Have a "do not do" list (say no to low-ROI work)
- ✅ Measure impact (cost saved, time saved, incidents prevented)

**Bad debt management:**
- ❌ All debt treated equally
- ❌ Vague items ("improve code quality")
- ❌ No effort estimates
- ❌ No acceptance criteria
- ❌ Backlog grows forever
- ❌ Never say no

**The goal:** Fix the right debt at the right time, and ignore the rest.
