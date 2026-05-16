---
name: review:infra
description: Infrastructure-focused review running 6 infrastructure review commands in parallel
---

# Infrastructure Code Review

Run 6 infrastructure review commands in parallel, then merge findings.

## Execution

Spawn these review commands as parallel Task agents. Each agent must:
1. Read the command file at the given path
2. Follow its WORKFLOW exactly
3. Return the complete review report

### Parallel Commands
1. `commands/review/infra.md` — Deployment config, least privilege, operational clarity
2. `commands/review/ci.md` — Pipeline security, deployment safety
3. `commands/review/release.md` — Versioning, rollout, migration, rollback
4. `commands/review/migrations.md` — Database migration safety
5. `commands/review/logging.md` — Secrets exposure, PII leaks, wide-events
6. `commands/review/observability.md` — Logs, metrics, tracing, alertability

## Task Agent Prompt Template

For each command, spawn a Task agent with this prompt:
"Read and execute the review command at `${CLAUDE_PLUGIN_ROOT}/commands/review/{name}.md`. Follow its WORKFLOW exactly. Review the current working tree changes (`git diff`). Return the complete review report as specified in the command's OUTPUT FORMAT."

## After All Complete: Merge

Combine all 6 agent reports into a single infrastructure review:
- Deduplicate findings that appear in multiple reports
- Sort by severity (BLOCKER > HIGH > MED > LOW > NIT)
- Merge file summaries across all reports
- Include operational readiness assessment
- Produce unified assessment: Production readiness recommendation

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
tags: [review-infra, {category-kebab}, {severity-lower}]
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
**Source:** /review:infra
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
