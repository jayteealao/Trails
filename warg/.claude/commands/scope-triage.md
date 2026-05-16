---
name: scope-triage
description: Slice large initiatives into shippable milestones with clear MVP
args:
  SESSION_SLUG:
    description: The session identifier. If not provided, uses the most recent session from .claude/README.md
    required: false
  INPUTS:
    description: Natural language description OR paste request/spec/plan to triage
    required: true
  SCOPE:
    description: Scope of the work
    required: false
    choices: [repo, pr, worktree, diff, file]
  TARGET:
    description: Target of the work
    required: false
  CONSTRAINTS:
    description: Technical constraints (e.g., must maintain backward compatibility, performance requirements, security requirements)
    required: false
  DELIVERY_MODE:
    description: How the work should be delivered
    required: false
    choices: [mvp-first, iterative, big-bang-not-allowed]
  RISK_TOLERANCE:
    description: Risk tolerance level
    required: false
    choices: [low, medium, high]
---

# ROLE
You are a scope cutter. Your job is to make this shippable by slicing into milestones with clear acceptance criteria and minimal dependencies.

# TRIAGE CHECKLIST
- Identify must-haves vs nice-to-haves vs distractions
- Identify dependencies and blockers (data migrations, API dependencies, infrastructure setup)
- Identify "thin vertical slice" that proves value end-to-end
- Identify risks that demand early work (auth scaffolding, migrations, architecture validation)
- Sequence based on **risk, dependencies, and value** (not human time/effort)

# WORKFLOW

## Step 0: Infer SESSION_SLUG if not provided

If SESSION_SLUG is not provided:
1. Read `.claude/README.md`
2. Parse the "Sessions" section
3. Extract the **last** session slug from the list
4. Use that as SESSION_SLUG
5. If no sessions exist, stop and tell user to run `/start-session` first

## Step 1: Load session context

1. Validate `.claude/<SESSION_SLUG>/` exists
2. Read `.claude/<SESSION_SLUG>/README.md` for session context
3. Check for existing spec at `.claude/<SESSION_SLUG>/spec/spec-crystallize.md`
   - If exists, read it to understand the full scope being triaged
   - This is the "wish list" - we're going to slice it
4. Check for existing triage at `.claude/<SESSION_SLUG>/plan/scope-triage.md`
   - If exists, read it (we might be refining)

## Step 2: Infer metadata from session context

From session context, spec (if exists), and INPUTS, infer:

1. **SCOPE/TARGET** (if not provided)
   - Use values from session README

2. **CONSTRAINTS** (if not provided)
   - Extract from INPUTS, session README, or spec
   - Focus on: technical constraints, compatibility requirements, security requirements
   - Example: "Must maintain backward compatibility with v1 API" or "Must pass security review"

3. **DELIVERY_MODE** (if not provided)
   - `mvp-first`: Ship minimal viable first, iterate based on feedback (default)
   - `iterative`: Planned sequence of milestones
   - `big-bang-not-allowed`: Explicit - cannot ship everything at once
   - Default to `mvp-first`

4. **RISK_TOLERANCE** (if not provided)
   - Use value from session README
   - If not available, default to `medium`

## Step 3: Decompose the scope

Use INPUTS and spec (if exists) to identify:

### 3.1: All features/capabilities
List everything that could be built:
- Core features (must-have for MVP)
- Enhanced features (nice-to-have)
- Distraction features (out of scope)

### 3.2: Epics/modules
Group related features into logical modules:
- Keep to 3-7 high-level modules
- Each module should be independently releasable if possible

### 3.3: Dependencies and sequencing constraints
Identify what must be done before other work can proceed:
- Data migrations (must run before dependent features)
- Infrastructure setup (databases, queues, services)
- API contracts (must be defined before consumers can integrate)
- Authentication/authorization scaffolding (needed for protected features)
- Third-party API availability

### 3.4: Technical risks
Identify risks that need early validation:
- Auth/security patterns
- Performance/scalability
- Data migrations
- New technology adoption
- Complex integrations

## Step 4: Define MVP (thin vertical slice)

The MVP must:
- Prove end-to-end value (working feature, not just scaffolding)
- Be shippable (meets quality bar: tested, secure, observable)
- Validate core technical assumptions
- Be minimal (< 50% of full scope complexity)
- Have no unnecessary dependencies on later milestones

For MVP, define:

### 4.1: What's included
- Minimum features for end-to-end flow
- Core user journey (happy path only)
- Essential infrastructure

### 4.2: What's excluded
- Enhanced features (defer to later milestones)
- Edge cases (document, handle later)
- Polish/optimization
- Advanced workflows

### 4.3: Acceptance criteria
- 3-7 specific, measurable criteria
- Each can be demo'd
- Each has clear pass/fail

### 4.4: Demo script
- Exact steps a user would take
- Shows core value
- Quick to demonstrate

## Step 5: Define subsequent milestones

After MVP, plan 2-4 additional milestones:

For each milestone:
- **Theme**: What value does this add?
- **Features**: What's being built?
- **Dependencies**: What must be done first?
- **Complexity**: Relative complexity (Simple/Moderate/Complex)
- **Value/Complexity ratio**: High/Med/Low priority

Milestones should:
- Build on previous milestones
- Be independently valuable
- Have clear acceptance criteria

## Step 6: Identify risk items requiring early work

Some work must happen in MVP even if not "user-facing":
- **Auth/permissions**: If needed, scaffold early
- **Data migrations**: Long-running, start early
- **Performance validation**: If core constraint, validate early
- **External dependencies**: Start procurement/coordination early

## Step 7: Create cuts and alternatives

Provide at least 2 cutting options:

### Option A: Aggressive MVP (minimal)
- Absolute minimum for value
- Highest risk (less hardening)
- Proves concept, may need iteration

### Option B: Balanced MVP (recommended)
- Core features + essential hardening
- Medium risk
- Production-ready quality

### Option C: Conservative MVP (if applicable)
- More features, more hardening
- Lower risk
- Reduces need for iteration

For each option, specify:
- What's in/out
- Complexity level (Simple/Moderate/Complex)
- Risk level
- When to choose it

## Step 8: Generate scope triage document

Create `.claude/<SESSION_SLUG>/plan/scope-triage.md` with full structure.

## Step 9: Update session README

Update `.claude/<SESSION_SLUG>/README.md`:
1. Check off `[ ]` → `[x]` for `plan/scope-triage.md`
2. Add to "Recent Activity":
   ```markdown
   - {YYYY-MM-DD}: Created scope triage via `/scope-triage`
   ```

## Step 10: Output summary

Print summary with MVP definition and next steps.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/plan/scope-triage.md`:

```markdown
---
command: /scope-triage
session_slug: {SESSION_SLUG}
date: {YYYY-MM-DD}
scope: {SCOPE}
target: {TARGET}
delivery_mode: {DELIVERY_MODE}
risk_tolerance: {RISK_TOLERANCE}
related:
  session: ../README.md
  spec: ../spec/spec-crystallize.md (if exists)
---

# Scope Triage: {Title}

## 0) Inputs & Constraints

**Hard Constraints:**
{Non-negotiable constraints}
- {Constraint 1}
- {Constraint 2}

**Soft Constraints:**
{Nice-to-have constraints}
- {Constraint 1}
- {Constraint 2}

**Delivery Mode:** {mvp-first | iterative | big-bang-not-allowed}

**Risk Tolerance:** {low | medium | high}

---

## 1) Decomposition

### Epics/Modules

{3-7 high-level modules}

**Module 1: {Name}**
- Features: {List}
- Independent: {yes/no}
- Complexity: {Simple/Moderate/Complex}

**Module 2: {Name}**
- Features: {List}
- Independent: {yes/no}
- Complexity: {Simple/Moderate/Complex}

{Continue for all modules...}

### Dependencies & Sequencing Constraints

**Dependency 1: {Name}**
- What: {Description}
- Type: {Infrastructure/API/Migration/Auth/External Service}
- Required by: {Which milestone}
- Risk: {low/medium/high}

**Dependency 2: {Name}**
{Repeat structure}

### Technical Risks Requiring Early Work

| Risk | Impact | Mitigation | When to Address |
|------|--------|------------|-----------------|
| {Risk 1} | {High/Med/Low} | {How to mitigate} | MVP / M1 / M2 |
| {Risk 2} | {High/Med/Low} | {How to mitigate} | MVP / M1 / M2 |

---

## 2) MVP Slice (Ship First)

**Goal:** {One sentence - what value does MVP prove?}


### What's Included

**Core User Journey:**
1. User does X
2. System responds with Y
3. User achieves Z

**Features:**
- ✅ {Feature 1} - {Why must-have}
- ✅ {Feature 2} - {Why must-have}
- ✅ {Feature 3} - {Why must-have}

**Infrastructure/Tech Work:**
- ✅ {Tech work 1} - {Why needed}
- ✅ {Tech work 2} - {Why needed}

### What's Excluded (Explicitly Deferred)

- ❌ {Feature A} - Defer to M1 ({reason})
- ❌ {Feature B} - Defer to M2 ({reason})
- ❌ {Feature C} - Out of scope ({reason})

**Edge Cases to Document (Not Implement):**
- {Edge case 1} - Known limitation, acceptable for MVP
- {Edge case 2} - Will handle in M1

### Acceptance Criteria

**AC1: {Criterion}**
- Given: {Precondition}
- When: {Action}
- Then: {Expected result}

**AC2: {Criterion}**
{Repeat structure}

{3-7 total acceptance criteria}

### Demo Script (Brief)

**Setup:**
{Any setup needed}

**Steps:**
1. Open {URL/app}
2. Click {action}
3. Enter {data}
4. Observe {result}
5. Verify {outcome}

**Expected Result:**
{What the demo proves}

### Complexity Level

{Simple | Moderate | Complex} - {Explanation of what makes it this complex}

### Risk Level

{low | medium | high} - {Explanation}

---

## 3) Milestone 1: {Theme}

**Goal:** {What value does this add beyond MVP?}

**Dependencies:** {What must be complete first}

### Features

- {Feature 1}
- {Feature 2}
- {Feature 3}

### Acceptance Criteria

{3-5 criteria}

### Complexity

{Simple | Moderate | Complex}

### Value/Complexity Priority

{High | Medium | Low}

---

## 4) Milestone 2: {Theme}

{Repeat structure}

---

## 5) Milestone 3: {Theme} (if applicable)

{Repeat structure}

---

## 6) Cutting Options

### Option A: Aggressive MVP (Minimal)

**What's In:**
- {Feature 1}
- {Feature 2}

**What's Out:**
- {Feature A} (even if nice-to-have)
- {Feature B}

**Complexity:** {Simple | Moderate | Complex}

**Risk Level:** High
- Less hardening
- Minimal error handling
- MVP only proves core concept

**When to Choose:**
- Need to validate concept quickly
- Can tolerate rough edges in first iteration
- Plan to iterate based on feedback

---

### Option B: Balanced MVP (Recommended)

**What's In:**
- {Feature 1}
- {Feature 2}
- {Feature 3}
- Essential error handling
- Basic observability

**What's Out:**
- {Feature A} (defer to M1)
- {Feature B} (defer to M2)

**Complexity:** {Simple | Moderate | Complex}

**Risk Level:** Medium
- Core features hardened
- Happy path + key edge cases
- Production-ready quality

**When to Choose:**
- Standard implementation approach
- Need production quality
- Balance minimalism and completeness

---

### Option C: Conservative MVP (If Applicable)

**What's In:**
- {Everything from Option B}
- {Additional feature 1}
- {Additional feature 2}
- Comprehensive error handling
- Full observability

**What's Out:**
- {Only the lowest priority features}

**Complexity:** {Simple | Moderate | Complex}

**Risk Level:** Low
- More complete feature set
- Extensive hardening
- Lower iteration risk

**When to Choose:**
- Critical system, can't afford issues in first release
- Want comprehensive coverage upfront
- Limited ability to iterate post-launch

---

## 7) Dependencies & Sequencing

| Dependency | Type | Required Before | Risk If Missing | Mitigation |
|------------|------|-----------------|-----------------|------------|
| {Dep 1} | {Infrastructure/API/Migration} | {MVP/M1/M2} | {Impact} | {How to handle} |
| {Dep 2} | {Infrastructure/API/Migration} | {MVP/M1/M2} | {Impact} | {How to handle} |

---

## 8) Recommended Path Forward

**Recommendation:** {Option A / Option B / Option C}

**Rationale:**
{2-3 sentences explaining why this option best fits constraints}

**Sequencing:**
- MVP: {Complexity level} - Ship first
- M1: {Complexity level} - Builds on MVP
- M2: {Complexity level} - Builds on M1
- Full scope: {Total complexity assessment}

**Key Trade-Offs:**
- Choosing: {What we're gaining}
- Sacrificing: {What we're deferring}
- Betting on: {Key assumptions}

---

## Next Steps

1. Review this triage with project owners
2. Get alignment on recommended MVP (Option B)
3. If spec doesn't exist yet, run `/spec-crystallize` for MVP scope only
4. Run `/research-plan MILESTONE:mvp` for MVP implementation
   - Plan will be saved to: `plan/research-plan.md` (milestone noted in frontmatter)
5. Run `/work` to begin MVP implementation
6. After MVP completion, run `/research-plan MILESTONE:m1` for next milestone

---

*Scope triage generated: {YYYY-MM-DD}*
*Session: [{SESSION_SLUG}](../README.md)*
```

# SUMMARY OUTPUT

After creating the triage, print:

```markdown
# Scope Triage Complete

## Triage Location
Saved to: `.claude/{SESSION_SLUG}/plan/scope-triage.md`

## Decomposition Summary
- Total epics/modules: {count}
- External dependencies: {count}
- Technical risks requiring early work: {count}

## MVP Definition (Option B - Recommended)
**Goal:** {One sentence}
**Features:** {count} core features
**Complexity:** {level}
**Risk Level:** {level}

**What's In:**
{Top 3 features}

**What's Out:**
{Top 3 deferred items}

## Subsequent Milestones
- M1: {Theme} ({complexity level})
- M2: {Theme} ({complexity level})
- M3: {Theme} ({complexity level}) (if applicable)

## Sequencing Summary
- MVP: {complexity} - Ship first
- M1: {complexity} - Adds {theme}
- M2: {complexity} - Adds {theme}
- Total: {overall scope assessment}

## Cutting Options Available
- Option A (Aggressive): {complexity} - {risk level}
- Option B (Balanced): {complexity} - {risk level} ← Recommended
- Option C (Conservative): {complexity} - {risk level}

## Next Command to Run

{If no spec exists yet:}
/spec-crystallize
INPUTS: {MVP features only - focused scope}

{If spec exists:}
/research-plan
MILESTONE: mvp
INPUTS: Implement MVP as defined in scope triage (Option B)

Note: Plan will be saved to `plan/research-plan.md` with milestone in frontmatter
```

# IMPORTANT: Scope Cutting Principles

This command enforces **ruthless prioritization**:
1. **MVP must prove value end-to-end** - not just a tech demo
2. **Defer everything that's not critical** - you can always add later
3. **Make cutting visible** - explicitly list what's excluded and why
4. **Provide options** - different risk/speed trade-offs
5. **Force thin slices** - MVP should be < 50% of full scope
6. **Identify blockers early** - external dependencies, technical risks

The goal is to make large projects **shippable** by breaking them into **independently valuable milestones**.

# IMPORTANT: Relationship to Spec

- **If spec exists**: Triage is slicing the spec into milestones
  - Spec defines "everything we could build"
  - Triage defines "what we'll build when"
- **If no spec**: Triage helps define MVP scope, then spec the MVP
  - Triage first to agree on boundaries
  - Then spec the MVP in detail

# WHEN TO USE THIS COMMAND

Use `/scope-triage` when:
- Greenfield app (lots of unknowns, need to phase)
- Large feature (> 4 weeks effort)
- Multiple project owners with different priorities
- Need to prove value incrementally
- Resource constraints force sequencing

Skip `/scope-triage` when:
- Simple, focused feature (< 2 weeks)
- Scope already well-defined and small
- Bug fix or refactor (not adding scope)

# EXAMPLE USAGE

**User input:**
```
/scope-triage
INPUTS: We want to build a CSV bulk import system with preview, validation, duplicate detection, rollback, scheduled imports, and admin dashboard for monitoring
CONSTRAINTS: Must maintain backward compatibility with existing single-record import API
```

**Agent:**
1. Infers SESSION_SLUG: `csv-bulk-import`
2. Reads spec if exists (sees full feature list)
3. Decomposes into modules:
   - Upload & preview
   - Validation & error handling
   - Duplicate detection
   - Commit with rollback
   - Scheduled imports
   - Admin dashboard
4. Defines MVP (Option B):
   - IN: Upload, preview, basic validation, commit (maintains backward compat)
   - OUT: Duplicate detection (M1), rollback (M1), scheduled imports (M2), dashboard (M2)
   - Acceptance criteria: Can upload CSV, see preview, commit successfully
   - Demo: Upload → preview → commit → verify in DB
   - Complexity: Moderate (new endpoints, file handling, but straightforward flow)
5. Defines M1 (hardening): Duplicate detection, rollback capability
6. Defines M2 (automation): Scheduled imports, admin dashboard
7. Provides 3 cutting options (A/B/C)
8. Recommends Option B (balanced MVP)
9. Saves to `.claude/csv-bulk-import/plan/scope-triage.md`
10. Outputs summary with next command

**Result:**
Clear MVP focused on core value, with logical sequencing for M1/M2 based on dependencies and complexity.
