---
name: handoff
description: Create clear documentation for others reviewing, deploying, or maintaining your changes
usage: /handoff [SCOPE] [TARGET] [CONTEXT]
arguments:
  - name: SCOPE
    description: 'Review scope: pr (default) | worktree | diff | repo'
    required: false
    default: pr
  - name: TARGET
    description: 'Target specifier: PR number, branch name, commit hash, or repo root'
    required: false
  - name: CONTEXT
    description: 'What is changing and why, related artifacts (plans, reviews, deployment notes), complexity estimate'
    required: false
examples:
  - command: /handoff pr 123
    description: Create documentation for code review
  - command: /handoff pr 456 "CONTEXT: Payment processor migration, ~500 LOC changed, deployment guide at docs/deployment.md"
    description: Create documentation with deployment context
  - command: /handoff worktree "CONTEXT: New checkout flow, ~300 LOC, feature flag checkout_v2 enabled"
    description: Create documentation for uncommitted work
---

# Documentation for Others

You produce clear documentation that lets anyone (or future you) review, deploy, or maintain the change without reading your mind.

## Core Principles

### Be Concise, Not Vague
**❌ BAD**: "Made some changes to the API"
**✅ GOOD**: "Added rate limiting (100 req/min per user) to `/api/checkout` endpoint"

### Prefer Concrete Pointers
**❌ BAD**: "Check the logs for errors"
**✅ GOOD**: "Check CloudWatch Logs group `/aws/lambda/checkout-api` filtered by `error.code=payment_declined`"

### Surface Operational Implications
**❌ BAD**: "Database schema changed"
**✅ GOOD**: "Database migration adds index (5min, backward compatible). Deploy order: DB migration → app deployment → backfill (optional)"

### If Unknown, Say So
**❌ BAD**: "Should work fine"
**✅ GOOD**: "Rollback difficulty: UNKNOWN. Recommendation: Deploy to staging first and test rollback procedure before production."

## Step 0: Infer SESSION_SLUG if Needed

If `SESSION_SLUG` is not provided:
1. Read `.claude/README.md`
2. Extract the **last session** from the table (most recent entry)
3. Use that session's slug as `SESSION_SLUG`

## Step 1: Determine Scope

Based on `SCOPE` parameter:

**Scope:**
- **`pr`** (default): Documentation for specific pull request
- **`worktree`**: Documentation for uncommitted changes
- **`diff`**: Documentation for diff between branches
- **`repo`**: Documentation for entire repository state

## Step 2: Gather Context

Extract from `CONTEXT` parameter or analyze codebase:

1. **Change summary**: What is changing and why
2. **Related artifacts**:
   - Research plan (`/research-plan` output)
   - Review findings (`/review:*` outputs)
   - Runbooks (paths or links)
   - Dashboards (Grafana/Datadog links)
   - Feature flags (LaunchDarkly/Split/custom)
3. **Rollout strategy**: None, canary, phased, manual
4. **Rollback plan**: Easy, moderate, hard, unknown
5. **Known risks**: List of concerns
6. **Verification steps**: Commands/checks to validate

## Step 3: Create Documentation

Focus on practical information others (or future you) need:

### Core Information

- Where to start reading (entry points, key files)
- Highest-risk areas (security, performance, data integrity)
- How to test locally (setup, commands, expected output)
- Deployment notes (if applicable - what needs to happen)
- What to watch for when running (common issues, debugging tips)
- How to rollback if needed

### Complexity Indicators

Instead of time estimates, provide:
- **LOC changed**: ~200 LOC, ~500 LOC, ~1000+ LOC
- **Files touched**: 3 files, 10 files, 20+ files
- **Dependencies added**: None, 1-2 libraries, major dependency
- **Database changes**: None, backward-compatible migration, breaking schema change
- **Risk level**: LOW (simple change), MEDIUM (moderate complexity), HIGH (architectural change)

## Step 4: Handoff Note Template

```markdown
# Handoff Note

## 0) What This Is

**Change summary:**
- [Bullet 1: Main change]
- [Bullet 2: Secondary change]
- [Bullet 3: Related changes]

**Why now:**
[Business context, timeline driver, incident response]

**Non-goals:**
- [What this does NOT change]
- [Deferred work]

## 1) What Changed (High-Signal)

**Key behavior changes:**
- [User-visible changes]
- [API changes]
- [Performance changes]

**Key non-behavior changes:**
- [Refactorings]
- [Code cleanup]
- [Dependency updates]

**Public surfaces touched:**
- APIs: [List endpoints]
- UI: [List components/pages]
- Events: [List event types]
- Config: [List config fields]

## 2) How to Review (for reviewers)

**Where to start:**
1. [Entry point file/module]
2. [Core logic file/module]
3. [Tests]

**Highest-risk areas:**
- [File/module with risk description]
- [File/module with risk description]

**Suggested review order:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Things to be strict about:**
- [Error handling in X]
- [Edge cases in Y]
- [Performance in Z]

## 3) How to Test/Verify (for anyone)

**Local commands:**
```bash
# Setup
[Commands to set up local environment]

# Run tests
[Commands to run tests]

# Manual testing
[Commands for manual verification]
```

**CI checks:**
- [List required CI checks]

**Manual QA script:**
1. [Step 1]
2. [Step 2]
3. [Expected result]

**Expected outputs:**
```
[Example output or screenshot description]
```

## 4) How to Deploy/Rollout

**Rollout approach:**
[All-at-once | Canary | Phased | Manual]

**Feature flags:**
| Flag Name | Default | How to Toggle |
|-----------|---------|---------------|
| [name] | [on/off] | [LaunchDarkly UI / config file / API call] |

**Migrations/backfills:**
```bash
# Migration command
[Command]

# Complexity
[Number of rows affected, schema complexity: simple/moderate/complex]

# Rollback
[Rollback command]
```

**Monitoring plan:**
- **Dashboard**: [Link to Grafana/Datadog dashboard]
- **Key metrics**: [List metrics to watch]
- **Alerts**: [List alert conditions]
- **Log queries**: [CloudWatch/Datadog queries]

## 5) Rollback Plan

**Rollback steps:**
```bash
# Step 1: Disable feature flag (if applicable)
[Command]

# Step 2: Revert deployment
[Command]

# Step 3: Verify rollback
[Command]
```

**Rollback difficulty:** [EASY | MODERATE | HARD | UNKNOWN]

**Data considerations:**
- [One-way data migrations?]
- [State that can't be rolled back?]

**Stop conditions:**
- [Error rate > 1%]
- [Latency p95 > 2s]
- [Customer complaints spike]

## 6) Known Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [Risk description] | [L/M/H] | [L/M/H] | [Mitigation strategy] |

## 7) Links / References

- **PR**: [GitHub/GitLab link]
- **Plan**: [Research plan link or summary]
- **Runbooks**: [List of runbook links]
- **Dashboards**: [List of dashboard links]
- **Tickets**: [JIRA/Linear links]
- **Related PRs**: [Links to dependent PRs]
```

## Step 5: Output Documentation

Create documentation note at `.claude/<SESSION_SLUG>/handoffs/handoff_<timestamp>.md`

## Example Output Structure

```markdown
# Documentation: [Feature/Change Name]

**Generated**: 2024-01-15 14:30 UTC
**Author**: [Your name or handle]
**Session**: <SESSION_SLUG>
**Complexity**: [~LOC changed, files touched, dependencies added]

[Include the template from Step 4]

---

**Verification**:
- [ ] All links work
- [ ] All commands tested
- [ ] Metrics queries validated
- [ ] Runbook updated (if applicable)
- [ ] Others notified (if collaboration needed)
```

## Documentation Quality Checklist

Before finalizing documentation:

- [ ] **Concise but complete**: No unnecessary details, but all critical info present
- [ ] **Concrete pointers**: File paths, endpoints, dashboard links (not vague references)
- [ ] **Operational clarity**: Deployment steps, monitoring, rollback explicit
- [ ] **Risk transparency**: Known risks stated with mitigations
- [ ] **Verification steps**: Clear commands to validate success
- [ ] **Links work**: All referenced dashboards, runbooks, tickets accessible
- [ ] **Audience-appropriate**: Level of detail matches audience needs
- [ ] **Unknown items flagged**: If something is uncertain, explicitly say so with "UNKNOWN" tag

## Common Handoff Anti-Patterns

### ❌ Anti-Pattern 1: Vague Descriptions

**Bad**:
> Made some improvements to the API

**Good**:
> Added rate limiting (100 req/min per user) to `/api/checkout` using Redis. Exceeding limit returns 429 with `Retry-After` header.

### ❌ Anti-Pattern 2: Missing Verification

**Bad**:
> Deploy and it should work

**Good**:
> Deploy and verify:
> ```bash
> curl https://api.prod.company.com/health
> # Expected: {"status": "ok", "version": "2.1.0"}
> ```

### ❌ Anti-Pattern 3: Unclear Rollback

**Bad**:
> Can rollback if needed

**Good**:
> Rollback (< 5 min):
> ```bash
> kubectl rollout undo deployment/api
> kubectl rollout status deployment/api
> # Verify: curl https://api.prod.company.com/health | jq .version
> # Expected: "2.0.9" (previous version)
> ```

### ❌ Anti-Pattern 4: No Monitoring Plan

**Bad**:
> Check logs for errors

**Good**:
> Monitor these metrics for 24h:
> - Error rate: https://grafana.com/d/api-errors (should be < 0.1%)
> - Latency: https://grafana.com/d/api-latency (p95 should be < 200ms)
> - Alert if: error rate > 1% for 5 minutes

### ❌ Anti-Pattern 5: Assuming Context

**Bad**:
> Use the usual deployment process

**Good**:
> Deployment process:
> 1. Merge PR to `main`
> 2. Wait for CI (10 min)
> 3. Auto-deploys to staging
> 4. Run smoke tests: `npm run test:staging`
> 5. Promote to prod: `./scripts/deploy-prod.sh`
> 6. Monitor dashboard: [link]

## Summary

Good documentation:
- **Saves time**: Others (or future you) can act immediately without asking questions
- **Reduces risk**: Explicit rollback procedures and monitoring prevent issues
- **Builds trust**: Transparent about risks and unknowns shows honesty
- **Scales knowledge**: Documents process for anyone who needs to understand it

Remember: **You won't always be there to explain it. The documentation must stand alone.**
