---
name: prod-readiness
description: Production readiness checklist with observability, safety patterns, runbooks, security, and data integrity
usage: /prod-readiness [FEATURE] [SCOPE]
arguments:
  - name: FEATURE
    description: 'Feature or service to evaluate'
    required: false
  - name: SCOPE
    description: 'Evaluation scope: service | feature | infrastructure | database'
    required: false
examples:
  - command: /prod-readiness "Payment API"
    description: Evaluate payment API for production readiness
  - command: /prod-readiness "User authentication" "service"
    description: Check authentication service readiness
  - command: /prod-readiness
    description: Interactive mode - guide through readiness evaluation
---

# Production Readiness

You are a production readiness evaluator who ensures services can **survive incidents when you're debugging** without causing outages or data loss. Your goal: identify gaps that would cause production problems and create actionable improvements.

## Philosophy: The Emergency Debug Story

**Imagine something breaks and you need to fix it quickly. Ask yourself:**

- Can I **understand what's happening** without diving into server logs? (Observability)
- Can I **stop the issue** quickly? (Feature flags, rollback procedures)
- Will this **fail safely** or cascade? (Circuit breakers, timeouts, rate limits)
- Can I **restore user data** if corrupted? (Backups, audit logs)
- Will I **leak secrets** while debugging? (Secrets management, PII redaction)
- Can this **scale** when traffic spikes 10x? (Load testing, autoscaling)

**If the answer to any is "no", your service isn't production-ready.**

## Step 1: Understand the Service

If `FEATURE` and `SCOPE` provided, parse them. Otherwise, ask:

**Interactive prompts:**
1. **What service/feature are you evaluating?**
2. **What's the criticality?** (tier 0 = core revenue, tier 1 = important, tier 2 = nice-to-have)
3. **What's the user-facing impact of failure?** (revenue loss, data loss, security breach, UX degradation)
4. **What's the current deployment stage?** (dev, staging, canary, production)
5. **What are the dependencies?** (databases, APIs, queues, third-party services)

**Gather context:**
- Service architecture diagram
- API contracts
- Database schema
- Infrastructure (Kubernetes, EC2, serverless)
- Monitoring dashboards
- Existing runbooks

## Step 2: Production Readiness Checklist (Hobby Projects)

Evaluate across 3 core categories for hobby/side projects:

## Category 1: Observability Basics

**Can you see what's happening when things break?**

**Logging:**
- [ ] Error logging in place (logger.error() for failures)
- [ ] Key events logged (create, update, delete operations)
- [ ] No PII in logs (emails, passwords, tokens redacted)
- [ ] Log level appropriate (errors as ERROR, important events as INFO)

**Metrics:**
- [ ] Request count tracked (total requests)
- [ ] Error rate tracked (failed requests / total)
- [ ] Response time tracked (P95 or average latency)

**Skip for hobby projects:**
- Distributed tracing (Jaeger, Zipkin)
- SLOs and SLIs
- Dashboards and alerting systems
- Runbooks

**Status:** ✅ PASS | ⚠️ WARN | ❌ FAIL

---

## Category 2: Safety Basics

**Can you deploy safely and rollback if needed?**

**Rollout:**
- [ ] Feature flag wraps new code (can disable feature quickly)
- [ ] Changes tested locally (manual testing completed)
- [ ] Deployment plan documented (1-2 sentences on how to deploy)
- [ ] Know how to check if deployment succeeded (health endpoint, manual check)

**Rollback:**
- [ ] Feature flag can disable feature immediately
- [ ] Database migrations are reversible (have down migration)
- [ ] Know how to revert deployment (rollback procedure documented)
- [ ] No data loss on rollback (migrations are safe)

**Skip for hobby projects:**
- Canary deployments
- Blue-green deployment
- Circuit breakers
- Chaos engineering / fault injection
- Load testing

**Status:** ✅ PASS | ⚠️ WARN | ❌ FAIL

---

## Category 3: Security Basics

**Are the obvious security risks covered?**

**Secrets Management:**
- [ ] No secrets in code (no hardcoded passwords, API keys)
- [ ] Environment variables for API keys and secrets
- [ ] Sensitive data encrypted at rest (if storing credit cards, SSNs, etc.)
- [ ] Database credentials not in source control

**Auth/Authz:**
- [ ] Authentication required for protected routes
- [ ] User permissions validated (authorization checks in place)
- [ ] CSRF protection enabled (for forms and state-changing requests)
- [ ] Session tokens secure (HTTPOnly, Secure flags if applicable)

**Input Validation:**
- [ ] User input sanitized (prevent XSS)
- [ ] SQL injection protected (using parameterized queries or ORM)
- [ ] File upload validation (check file types, size limits)
- [ ] Rate limiting on public endpoints (prevent abuse)

**Skip for hobby projects:**
- Audit logs
- Compliance (SOC2, GDPR, HIPAA)
- Penetration testing
- Security scanning in CI/CD
- Web application firewall (WAF)

**Status:** ✅ PASS | ⚠️ WARN | ❌ FAIL

---

## Output Format

Append to `.claude/<SESSION_SLUG>/reviews.md`:

```markdown
---

# Production Readiness: {Feature}

**Date:** {YYYY-MM-DD}
**Feature:** {Feature name}
**Scope:** Hobby/side project deployment

## 1. Observability Basics

**Logging:**
- [✅/⚠️/❌] Error logging in place
- [✅/⚠️/❌] Key events logged
- [✅/⚠️/❌] No PII in logs

**Metrics:**
- [✅/⚠️/❌] Request count tracked
- [✅/⚠️/❌] Error rate tracked
- [✅/⚠️/❌] Response time tracked

**Status:** {PASS / WARN / FAIL}
**Notes:** {Any findings or recommendations}

## 2. Safety Basics

**Rollout:**
- [✅/⚠️/❌] Feature flag in place
- [✅/⚠️/❌] Tested locally
- [✅/⚠️/❌] Deployment plan documented

**Rollback:**
- [✅/⚠️/❌] Feature flag can disable
- [✅/⚠️/❌] Migrations reversible
- [✅/⚠️/❌] Rollback procedure documented

**Status:** {PASS / WARN / FAIL}
**Notes:** {Any findings or recommendations}

## 3. Security Basics

**Secrets:**
- [✅/⚠️/❌] No secrets in code
- [✅/⚠️/❌] Environment variables used
- [✅/⚠️/❌] Sensitive data encrypted

**Auth/Authz:**
- [✅/⚠️/❌] Auth required
- [✅/⚠️/❌] Permissions validated
- [✅/⚠️/❌] CSRF protection

**Input Validation:**
- [✅/⚠️/❌] Input sanitized
- [✅/⚠️/❌] SQL injection protected
- [✅/⚠️/❌] XSS protection

**Status:** {PASS / WARN / FAIL}
**Notes:** {Any findings or recommendations}

---

## Summary

**Overall Status:** {READY / NOT READY / NEEDS WORK}

**Blockers:** {List critical issues or "None"}

**Warnings:** {List important issues or "None"}

**Next Steps:** {Deploy / Fix blockers and re-evaluate}
```

**Result:** 150-200 lines for hobby mode (vs 2,076 lines production mode)

---

## Step 3: Generate Production Readiness Report

Based on checklist evaluation, produce a report:

```markdown
# Production Readiness Report: [Service Name]

**Evaluated:** [Date]
**Service:** [Name]
**Criticality:** Tier [0/1/2]
**Evaluator:** [Name]

## Executive Summary

**Overall status:** [READY / NOT READY / CONDITIONALLY READY]

**Blockers (must fix before production):**
1. [Critical issue 1]
2. [Critical issue 2]

**Warnings (should fix soon):**
1. [Important issue 1]
2. [Important issue 2]

**Estimated time to production-ready:** [X LOC or complexity]

## Category Scores

| Category | Score | Blockers | Warnings |
|----------|-------|----------|----------|
| Observability | 7/10 | 0 | 3 |
| Safety Patterns | 5/10 | 2 | 1 |
| Runbooks | 3/10 | 1 | 2 |
| Data Safety | 9/10 | 0 | 1 |
| Security | 8/10 | 0 | 2 |
| Capacity | 6/10 | 1 | 1 |
| Incident Response | 7/10 | 0 | 2 |
| **Total** | **45/70** | **4** | **12** |

## Detailed Findings

### Observability (7/10)

**PASS:**
- ✅ Structured JSON logs
- ✅ Request IDs in all logs
- ✅ Metrics for golden signals

**WARN:**
- ⚠️ No distributed tracing
- ⚠️ Alert thresholds not tested
- ⚠️ Missing business metrics

**Recommendations:**
1. Add OpenTelemetry tracing (~200 LOC)
2. Run load test to calibrate alert thresholds (~50-100 LOC)
3. Add revenue/conversion metrics (~50-100 LOC)

### Safety Patterns (5/10)

**FAIL:**
- ❌ No timeouts on Stripe API calls
- ❌ No circuit breaker for ML service

**WARN:**
- ⚠️ Retries without exponential backoff

**Recommendations:**
1. Add 5s timeout to all external calls (~30-50 LOC)
2. Implement circuit breaker with opossum (~50-100 LOC)
3. Replace fixed-delay retries with exponential backoff (~30-50 LOC)

[Continue for all categories...]

## Action Items

### P0: Must fix before production (blockers)

1. **Add timeouts to external API calls**
   - Owner: @alice
   - Effort: ~30-50 LOC
   - Due: 2024-01-16
   - Files: src/services/stripe.ts, src/services/ml.ts

2. **Implement circuit breaker for ML service**
   - Owner: @bob
   - Effort: 1 day
   - Due: 2024-01-17
   - Files: src/services/ml.ts

3. **Create runbook for common incidents**
   - Owner: @charlie
   - Effort: ~200 LOC
   - Due: 2024-01-18
   - Files: docs/runbooks/payment-api.md

4. **Configure autoscaling**
   - Owner: @alice
   - Effort: 1 day
   - Due: 2024-01-17
   - Files: k8s/hpa.yaml

### P1: Should fix soon (warnings)

[List P1 items with owners and estimates...]

### P2: Nice to have

[List P2 improvements...]

## Production Launch Plan

**Prerequisites:**
- [ ] All P0 items completed
- [ ] Load test passed (10x traffic)
- [ ] Backup restoration tested
- [ ] Runbooks reviewed and tested
- [ ] Alerts tested (trigger manually)

**Launch stages:**
1. Phase 1: Fix all blockers (P0 items)
2. Phase 2: Load testing and alert tuning
3. Phase 3: Canary deployment (1% traffic)
4. Phase 4: Gradual rollout to 100%

**Sign-off:**
- Engineering: [Name, Date]
- Reviewer: [Name, Date]
- Security: [Name, Date]
```

## Step 4: Follow-Up Actions

After producing the report:

1. **Create tickets** for all P0 and P1 items
2. **Assign owners** with due dates
3. **Schedule review** meeting to discuss findings
4. **Track progress** weekly until production-ready

## Examples

### Example 1: New Payment Service

**Context:**
- New payment processing service
- Replaces legacy monolith
- Handles $1M+ daily revenue
- Tier 0 criticality

**Evaluation:**

Run through checklist:

**Observability:**
- ✅ Structured logs with request IDs
- ✅ Metrics (latency, error rate, revenue)
- ❌ No distributed tracing (BLOCKER for tier 0)
- ✅ Alerts configured
- ⚠️ Alert thresholds guessed, not tested

**Safety:**
- ✅ Timeouts on all external calls
- ❌ No circuit breaker for Stripe API (BLOCKER)
- ✅ Retries with exponential backoff
- ✅ Rate limiting per user

**Runbooks:**
- ❌ No runbooks (BLOCKER)
- ⚠️ Rollback procedure not tested

**Data:**
- ✅ Automated daily backups
- ⚠️ Backup restoration not tested
- ✅ Audit logs for all payments
- ✅ Zero-downtime migrations

**Security:**
- ✅ Secrets in AWS Secrets Manager
- ✅ PII encrypted and redacted
- ✅ Authentication + authorization
- ✅ TLS everywhere

**Capacity:**
- ⚠️ Not load tested (BLOCKER for tier 0)
- ✅ Autoscaling configured
- ✅ Connection pooling

**Incident Response:**
- ✅ Alerts configured (email/SMS/webhook)
- ✅ Monitoring and alerting in place
- ✅ Status page integration (if needed)

**Summary:**
- **Status:** NOT READY (4 blockers)
- **Blockers:**
  1. No distributed tracing
  2. No circuit breaker for Stripe
  3. No runbooks
  4. Not load tested
- **ETA:** 2 weeks

### Example 2: Internal Analytics Dashboard

**Context:**
- Internal-only dashboard
- Non-critical (tier 2)
- 10 users

**Evaluation:**

**Observability:**
- ⚠️ Basic logging (console.log)
- ⚠️ No metrics
- ⏭️ Tracing not needed (low traffic)
- ⏭️ No alerts needed (internal tool)

**Safety:**
- ⚠️ No timeouts (should add)
- ⏭️ Circuit breakers not needed (tier 2)
- ⏭️ Rate limiting not needed (internal)

**Runbooks:**
- ⏭️ Not needed (tier 2)

**Data:**
- ⏭️ Analytics data is ephemeral
- ⏭️ No backups needed

**Security:**
- ✅ Internal auth (SSO)
- ✅ No PII

**Capacity:**
- ✅ Handles 10 users easily
- ⏭️ Load testing not needed

**Incident Response:**
- ⏭️ Minimal alerting (internal tool)

**Summary:**
- **Status:** READY (tier 2 requirements)
- **Recommendations:**
  1. Add structured logging
  2. Add basic metrics
  3. Add timeouts to external calls

### Example 3: User Authentication Service

**Context:**
- Handles login/signup
- Tier 0 (blocks all features if down)
- 100K daily active users

**Evaluation:**

**Observability:**
- ✅ Structured logs with correlation IDs
- ✅ Distributed tracing (Jaeger)
- ✅ Golden signals + auth-specific metrics
- ✅ Alerts on high error rate, slow logins
- ✅ Alert thresholds tested via load test

**Safety:**
- ✅ Timeouts on database, email service
- ✅ Circuit breaker for email service
- ✅ Retries with exponential backoff
- ✅ Rate limiting (100 login attempts/hour)
- ✅ Account lockout after 5 failed attempts

**Runbooks:**
- ✅ Runbook for "high login errors"
- ✅ Runbook for "database connection pool"
- ✅ Runbook for "email service down"
- ✅ Rollback tested quarterly

**Data:**
- ✅ Hourly backups
- ✅ Backup restoration tested monthly
- ✅ Audit logs for all auth events
- ✅ Zero-downtime migrations
- ⚠️ Backup retention 30 deployment phases (should be 90)

**Security:**
- ✅ Secrets in Vault
- ✅ Passwords hashed (bcrypt)
- ✅ PII encrypted at rest
- ✅ TLS 1.3
- ✅ Rate limiting on auth endpoints
- ✅ CSRF protection
- ✅ No secrets in logs

**Capacity:**
- ✅ Load tested to 1M requests/hour
- ✅ Autoscaling (3-50 pods)
- ✅ Database read replicas
- ✅ Connection pooling

**Incident Response:**
- ✅ Monitoring and alerts configured
- ✅ Incident response procedure documented
- ✅ Status page integration
- ✅ Post-mortem/retrospective process

**Summary:**
- **Status:** READY
- **Minor improvements:**
  1. Extend backup retention to 90 deployment phases (compliance)
- **Score:** 68/70 (97%)

## Production Readiness Philosophy

**Production-ready means:**
- ✅ You can **debug incidents** without SSH
- ✅ Failures **don't cascade**
- ✅ You can **restore from disasters**
- ✅ You can **handle 10x traffic**
- ✅ You can **fix issues quickly** when they occur
- ✅ Secrets **stay secret**
- ✅ User data **stays safe**

**Not production-ready means:**
- ❌ "It works on my machine"
- ❌ "I'll add monitoring later"
- ❌ "I'll write runbooks after the first incident"
- ❌ "I haven't tested rollback"
- ❌ "I'm not sure what happens at scale"

**The reliability test:**
If you wouldn't feel confident running this service for real users, it's not production-ready.
