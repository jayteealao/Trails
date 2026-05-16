---
name: review:all
description: Comprehensive code review running all 30 review commands in parallel
---

# Comprehensive Code Review

Run all 30 review commands in parallel, then merge findings into a unified report.

## Execution

Spawn these review commands as parallel Task agents. Each agent must:
1. Read the command file at the given path
2. Follow its WORKFLOW exactly
3. Return the complete review report

### Parallel Commands

**Correctness & Logic:**
1. `commands/review/correctness.md` — Logic flaws, broken invariants, edge-case failures
2. `commands/review/backend-concurrency.md` — Race conditions, atomicity, locking, idempotency
3. `commands/review/refactor-safety.md` — Semantic drift, behavior equivalence

**Security & Privacy:**
4. `commands/review/security.md` — Vulnerabilities, insecure defaults, missing controls
5. `commands/review/infra-security.md` — IAM, networking, secrets, configuration
6. `commands/review/privacy.md` — PII handling, data minimization, compliance
7. `commands/review/supply-chain.md` — Dependency risks, lockfiles, build integrity
8. `commands/review/data-integrity.md` — Data correctness over time, failures, concurrency

**Architecture & Design:**
9. `commands/review/architecture.md` — Boundaries, dependencies, layering
10. `commands/review/performance.md` — Algorithmic efficiency, N+1 queries, bottlenecks
11. `commands/review/scalability.md` — Load handling, dataset growth, multi-tenancy
12. `commands/review/api-contracts.md` — Stability, correctness, consumer usability
13. `commands/review/maintainability.md` — Readability, change amplification
14. `commands/review/overengineering.md` — Unnecessary complexity, YAGNI violations

**Infrastructure & Operations:**
15. `commands/review/infra.md` — Deployment config, least privilege, operational clarity
16. `commands/review/ci.md` — Pipeline security, deployment safety
17. `commands/review/release.md` — Versioning, rollout, migration, rollback
18. `commands/review/migrations.md` — Database migration safety
19. `commands/review/reliability.md` — Failure modes, partial outages
20. `commands/review/logging.md` — Secrets exposure, PII leaks, wide-events
21. `commands/review/observability.md` — Logs, metrics, tracing, alertability
22. `commands/review/cost.md` — Cloud infrastructure cost implications

**Quality & Testing:**
23. `commands/review/testing.md` — Test quality, coverage, reliability
24. `commands/review/style-consistency.md` — Codebase style, language idioms
25. `commands/review/docs.md` — Documentation completeness, accuracy

**User Experience:**
26. `commands/review/accessibility.md` — Keyboard, assistive technology, ARIA
27. `commands/review/frontend-accessibility.md` — SPA-specific accessibility issues
28. `commands/review/frontend-performance.md` — Bundle size, rendering, latency
29. `commands/review/ux-copy.md` — User-facing text clarity, error recovery
30. `commands/review/dx.md` — Developer experience, onboarding

## Task Agent Prompt Template

For each command, spawn a Task agent with this prompt:
"Read and execute the review command at `${CLAUDE_PLUGIN_ROOT}/commands/review/{name}.md`. Follow its WORKFLOW exactly. Review the current working tree changes (`git diff`). Return the complete review report as specified in the command's OUTPUT FORMAT."

## After All Complete: Merge

Combine all 30 agent reports into a single comprehensive review:
- Deduplicate findings that appear in multiple reports
- Sort by severity (BLOCKER > HIGH > MED > LOW > NIT)
- Group by category (Correctness, Security, Architecture, Infrastructure, Quality, UX)
- Merge file summaries across all reports
- Produce unified assessment: Ship / Ship with caveats / Don't Ship

## After Merge: Create Todos

Convert each finding (except NIT) from the merged report into a pending file-todo.

### Setup
1. Create `.claude/todos/` if it doesn't exist
2. Find next issue ID: `ls .claude/todos/ 2>/dev/null | grep -oE '^[0-9]+' | sort -n | tail -1` (start at 001 if empty)

### Severity → Priority
| Severity | Priority |
|----------|----------|
| BLOCKER/HIGH | → p1 |
| MED          | → p2 |
| LOW          | → p3 |
| NIT          | → skip |

### Per Finding
Create `.claude/todos/{id}-pending-{priority}-{kebab-title}.md`:

```yaml
---
status: pending
priority: {p1|p2|p3}
issue_id: "{id}"
tags: [review-all, {category-kebab}, {severity-lower}]
dependencies: []
---
```

```markdown
# {Finding Title}

## Problem Statement
{What is wrong and why it matters}

## Findings
{Evidence: file:line references, code snippets, failure scenarios}

## Proposed Solution
{Remediation from the review}

## Acceptance Criteria
- [ ] Fix implemented
- [ ] Tests added
- [ ] No regressions

## Work Log
### {date} - Created from Review
**Source:** /review:all
**Severity:** {severity}
**Finding ID:** {original ID from merged report}
```

### After Todos Created

Output the merged review report as normal, then append:
```
---
## Todos Created
**Total:** {count} in `.claude/todos/` | **Skipped:** {nit-count} NITs

Next: Run `/triage` to review and approve findings
```
