---
name: workflows:work
description: Execute work plans efficiently while maintaining quality and finishing features
argument-hint: "[plan file, specification, or todo file path]"
---

# Work Plan Execution Command

## CRITICAL: Command Execution Instructions

**This is a WORK EXECUTION command, NOT a planning command.**

- Create persistent work todos in `.claude/todos/work/` in Phase 1, Step 3 to track implementation tasks from the plan
- DO NOT use EnterPlanMode - this command executes existing plans
- Follow the execution workflow below EXACTLY

## Introduction

This command takes a work document (plan, specification, or todo file) and executes it systematically. The focus is on **shipping complete features** by understanding requirements quickly, following existing patterns, and maintaining quality throughout.

## Input Document

<input_document> #$ARGUMENTS </input_document>

## Execution Workflow

### Phase 1: Quick Start

1. **Read Plan and Clarify**

   - Read the work document completely
   - Review any references or links provided in the plan
   - If anything is unclear or ambiguous, ask clarifying questions now
   - Get user approval to proceed
   - **Do not skip this** - better to ask questions now than build the wrong thing

2. **Setup Environment**

   Choose your work style:

   **Option A: Live work on current branch**
   ```bash
   git checkout main && git pull origin main
   git checkout -b feature-branch-name
   ```

   **Option B: Work on a new branch from main**
   ```bash
   git fetch origin main
   git checkout -b feature-branch-name origin/main
   ```

3. **Create Todo List**

   Create work todo files in `.claude/todos/work/` for each task:

   For each task in the plan:
   1. Create file: `.claude/todos/work/work-{plan-id}-{task-num}-pending-{description}.md`
   2. Include YAML frontmatter with dependencies
   3. Link to parent plan file

   Example:
   ```yaml
   ---
   status: pending
   priority: p2
   issue_id: "work-oauth-001"
   tags: [implementation, oauth]
   dependencies: []
   parent_plan: .claude/plans/add-oauth-login.md
   ---

   # Create OAuth Controller

   [Implementation details from plan]
   ```

   Also create progress summary: `.claude/plans/progress/{plan-name}-work-progress.md`

### Phase 2: Execute

1. **Task Execution Loop**

   For each task in priority order:

   ```
   while (tasks remain):
     - Update work todo: Rename file `pending` -> `in_progress`
     - Update progress summary: Mark current task in progress
     - Read any referenced files from the plan
     - Look for similar patterns in codebase
     - Implement following existing conventions
     - Write tests for new functionality
     - Run tests after changes
     - Rename file `in_progress` -> `complete`, append work log
     - Update progress summary
   ```

2. **Follow Existing Patterns**

   - The plan should reference similar code - read those files first
   - Match naming conventions exactly
   - Reuse existing components where possible
   - Follow project coding standards (see CLAUDE.md)
   - When in doubt, grep for similar implementations

3. **Test Continuously**

   - Run relevant tests after each significant change
   - Don't wait until the end to test
   - Fix failures immediately
   - Add new tests for new functionality

4. **Track Progress**

   Update todo file statuses as you complete tasks:
   - Start task: Rename `pending` -> `in_progress`
   - Complete task: Rename `in_progress` -> `complete`, append work log
   - Update progress summary file

   Additional tracking:
   - Note any blockers or unexpected discoveries
   - Create new task files if scope expands
   - Keep user informed of major milestones

### Phase 3: Quality Check

1. **Run Core Quality Checks**

   Always run before submitting:

   ```bash
   # Run full test suite (use project-specific command from CLAUDE.md)
   npm test  # or: pytest, go test, bin/rails test, etc.

   # Run linting (per CLAUDE.md)
   npm run lint  # or project-specific linting command
   ```

2. **Consider Reviewer Agents** (Optional)

   Use for complex, risky, or large changes:

   - **code-simplicity-reviewer**: Check for unnecessary complexity
   - **senior-code-reviewer**: Verify code quality and conventions
   - **performance-oracle**: Check for performance issues
   - **security-sentinel**: Scan for security vulnerabilities

   Run reviewers in parallel with Task tool:

   ```
   Task(code-simplicity-reviewer): "Review changes for simplicity"
   Task(senior-code-reviewer): "Check code quality"
   ```

   Present findings to user and address critical issues.

3. **Final Validation**
   - All work todos marked complete (check: `ls .claude/todos/work/*-complete-*.md`)
   - All tests pass
   - Linting passes
   - Code follows existing patterns
   - No console errors or warnings

### Phase 4: Ship It

1. **Create Commit**

   ```bash
   git add .
   git status  # Review what's being committed
   git diff --staged  # Check the changes

   # Commit with conventional format
   git commit -m "$(cat <<'EOF'
   feat(scope): description of what and why

   Brief explanation if needed.

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

2. **Create Pull Request**

   ```bash
   git push -u origin feature-branch-name

   gh pr create --title "Feature: [Description]" --body "$(cat <<'EOF'
   ## Summary
   - What was built
   - Why it was needed
   - Key decisions made

   ## Testing
   - Tests added/modified
   - Manual testing performed

   ## Screenshots
   [Add screenshots for UI changes if applicable]

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

3. **Notify User**
   - Summarize what was completed
   - Link to PR
   - Note any follow-up work needed
   - Suggest next steps if applicable

---

## Key Principles

### Start Fast, Execute Faster

- Get clarification once at the start, then execute
- Don't wait for perfect understanding - ask questions and move
- The goal is to **finish the feature**, not create perfect process

### The Plan is Your Guide

- Work documents should reference similar code and patterns
- Load those references and follow them
- Don't reinvent - match what exists

### Test As You Go

- Run tests after each change, not at the end
- Fix failures immediately
- Continuous testing prevents big surprises

### Quality is Built In

- Follow existing patterns
- Write tests for new code
- Run linting before pushing
- Use reviewer agents for complex/risky changes only

### Ship Complete Features

- Mark all tasks completed before moving on
- Don't leave features 80% done
- A finished feature that ships beats a perfect feature that doesn't

## Quality Checklist

Before creating PR, verify:

- [ ] All clarifying questions asked and answered
- [ ] All work todos in complete status
- [ ] Tests pass
- [ ] Linting passes
- [ ] Code follows existing patterns
- [ ] Commit messages follow conventional format
- [ ] PR description includes summary and testing notes

## When to Use Reviewer Agents

**Don't use by default.** Use reviewer agents only when:

- Large refactor affecting many files (10+)
- Security-sensitive changes (authentication, permissions, data access)
- Performance-critical code paths
- Complex algorithms or business logic
- User explicitly requests thorough review

For most features: tests + linting + following patterns is sufficient.

## Common Pitfalls to Avoid

- **Analysis paralysis** - Don't overthink, read the plan and execute
- **Skipping clarifying questions** - Ask now, not after building wrong thing
- **Ignoring plan references** - The plan has links for a reason
- **Testing at the end** - Test continuously or suffer later
- **Forgetting todo status updates** - Update todo files and progress summary or lose track of what's done
- **80% done syndrome** - Finish the feature, don't move on early
- **Over-reviewing simple changes** - Save reviewer agents for complex work
