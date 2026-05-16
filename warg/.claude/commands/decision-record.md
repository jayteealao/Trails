---
name: decision-record
description: Create ADR-style decision records for architectural and implementation choices
args:
  SESSION_SLUG:
    description: The session identifier. If not provided, uses the most recent session from .claude/README.md
    required: false
  DECISION_TOPIC:
    description: Short title for the decision (e.g., "API authentication approach" or "Database choice")
    required: true
  CONTEXT:
    description: Background, constraints, competing goals, or natural language description of the decision to be made
    required: true
  OPTIONS:
    description: List of options being considered (optional - can be inferred from context)
    required: false
  DECISION_DRIVERS:
    description: Key factors influencing the decision (simplicity, security, speed, cost, maintainability, etc.)
    required: false
  STATUS:
    description: Current status of the decision
    required: false
    choices: [proposed, accepted, superseded, deprecated]
  AUDIENCE:
    description: Who needs to understand this decision
    required: false
    choices: [engineers, broader audience, executive]
  SCOPE:
    description: Scope of the work
    required: false
    choices: [repo, pr, worktree, diff, file]
  TARGET:
    description: Target of the work
    required: false
---

# ROLE
You are producing an ADR-style decision record that is short, specific, and durable.

# RULES
- Do not restate large amounts of code; focus on reasoning and consequences
- Be explicit about tradeoffs and what we are choosing NOT to do
- Include follow-ups and how we'll revisit if assumptions change
- Keep it brief but complete (1-2 pages max)
- Make it searchable by using clear keywords

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
   - May contain requirements relevant to the decision
4. Check for existing plan at `.claude/<SESSION_SLUG>/plan/research-plan*.md`
   - May reference this decision or provide context
5. Check for existing decisions at `.claude/<SESSION_SLUG>/decisions/`
   - Understand previous decisions to maintain consistency

## Step 2: Infer metadata from session context

From CONTEXT, session context, and any existing artifacts, infer:

1. **OPTIONS** (if not provided)
   - Parse CONTEXT for candidate approaches
   - Typically 2-3 options (avoid overwhelming with too many)
   - If context is vague, propose reasonable alternatives

2. **DECISION_DRIVERS** (if not provided)
   - Extract from CONTEXT or session constraints
   - Common drivers: simplicity, security, performance, cost, maintainability, time-to-market, project expertise
   - Rank by importance

3. **STATUS** (if not provided)
   - If decision hasn't been made yet: `proposed`
   - If decision is being documented after the fact: `accepted`
   - Default to `proposed`

4. **AUDIENCE** (if not provided)
   - Infer from decision scope:
     - Technical implementation details → `engineers`
     - Product direction or user impact → `broader audience`
     - Strategic or resource allocation → `executive`
   - Default to `engineers`

5. **SCOPE/TARGET** (if not provided)
   - Use values from session README
   - Default to `repo` and `.`

## Step 3: Research relevant context (lightweight)

Use Grep and Read to gather context:
- Find existing similar patterns in the codebase
- Identify constraints from architecture
- Look for precedents in code comments or docs
- Identify what would need to change for each option

Keep research focused on decision-relevant info only.

## Step 4: Analyze options

For each option, determine:
- **Summary**: What is this approach?
- **Pros**: What are the benefits?
- **Cons**: What are the downsides?
- **Risks**: What could go wrong?
- **Effort**: Relative complexity (Simple/Moderate/Complex)
- **Reversibility**: How easy is it to change later?

## Step 5: Generate the decision record

Create `.claude/<SESSION_SLUG>/decisions/decision-{YYYY-MM-DD}-{slug}.md`

Where `{slug}` is a kebab-case version of DECISION_TOPIC (e.g., `api-authentication-approach`)

## Step 6: Update session README

Update `.claude/<SESSION_SLUG>/README.md`:
1. Find the artifacts section
2. Check off `[ ]` → `[x]` for `decisions/` (if not already)
3. Add to "Recent Activity":
   ```markdown
   - {YYYY-MM-DD}: Decision record created: {DECISION_TOPIC} (status: {STATUS})
   ```

## Step 7: Output summary

Print summary with decision location and key points.

# OUTPUT FORMAT

Create `.claude/<SESSION_SLUG>/decisions/decision-{YYYY-MM-DD}-{slug}.md`:

```markdown
---
command: /decision-record
session_slug: {SESSION_SLUG}
date: {YYYY-MM-DD}
decision_topic: {DECISION_TOPIC}
status: {proposed | accepted | superseded | deprecated}
audience: {engineers | broader audience | executive}
scope: {SCOPE}
target: {TARGET}
related:
  session: ../README.md
  spec: ../spec/spec-crystallize.md (if exists)
  plan: ../plan/research-plan*.md (if exists)
---

# Decision Record: {DECISION_TOPIC}

**Status:** {proposed | accepted | superseded | deprecated}
**Date:** {YYYY-MM-DD}
**Scope/Target:** {SCOPE} / {TARGET}
**Audience:** {engineers | broader audience | executive}

---

## Context

{Why is this decision needed? What's the current situation?}

**Background:**
- {Context point 1}
- {Context point 2}
- {Context point 3}

**Constraints:**
- {Constraint 1 - technical, business, or organizational}
- {Constraint 2}

**Competing Goals:**
- {Goal 1} vs {Goal 2} (e.g., "Performance vs Simplicity")

---

## Decision Drivers

Ranked by importance:

1. **{Driver 1}** - {Why this matters most}
2. **{Driver 2}** - {Why this matters}
3. **{Driver 3}** - {Why this matters}
4. **{Driver 4}** - {Why this matters} (if applicable)

---

## Options Considered

### Option A: {Name}

**Summary:**
{2-3 sentences describing this approach}

**Pros:**
- {Benefit 1}
- {Benefit 2}
- {Benefit 3}

**Cons:**
- {Downside 1}
- {Downside 2}
- {Downside 3}

**Risks:**
- {Risk 1 - what could go wrong}
- {Risk 2}

**Complexity:** {Simple | Moderate | Complex}

**Reversibility:** {Easy | Moderate | Difficult}

**Precedent in codebase:**
{If applicable: "Similar to X in file Y:Z" or "Would be new pattern"}

---

### Option B: {Name}

**Summary:**
{2-3 sentences}

**Pros:**
- {Benefit 1}
- {Benefit 2}

**Cons:**
- {Downside 1}
- {Downside 2}

**Risks:**
- {Risk 1}
- {Risk 2}

**Complexity:** {Simple | Moderate | Complex}

**Reversibility:** {Easy | Moderate | Difficult}

**Precedent in codebase:**
{Reference to similar patterns}

---

### Option C: {Name} (if applicable)

{Repeat structure}

---

## Decision

**Selected Option:** {Option A | Option B | Option C}

**Rationale:**
{2-4 sentences explaining why this option best satisfies the decision drivers}

We chose Option {X} because:
1. {Primary reason - ties to top decision driver}
2. {Secondary reason}
3. {Additional reason}

**What we are explicitly NOT doing:**
- {Anti-pattern or alternative we're rejecting}
- {Another option we considered but dismissed}
- {Future enhancement we're deferring}

---

## Consequences

### Positive Consequences

- {Benefit 1 - what we gain}
- {Benefit 2}
- {Benefit 3}

### Negative Consequences

- {Cost 1 - what we sacrifice or risk}
- {Cost 2}
- {Cost 3}

### Neutral Consequences

- {Change 1 - neither good nor bad, just different}
- {Change 2}

---

## Implementation Notes

**What needs to change:**
- {File/module 1}: {Change needed}
- {File/module 2}: {Change needed}
- {Infrastructure/config}: {Change needed}

**Dependencies:**
- {Dependency 1 - what must exist first}
- {Dependency 2}

**Migration path (if applicable):**
{If changing existing approach, how do we migrate?}
1. {Step 1}
2. {Step 2}
3. {Step 3}

---

## Follow-Up Actions

**Immediate:**
- [ ] {Action 1 - must be done as part of this decision}
- [ ] {Action 2}

**Future:**
- [ ] {Action 3 - can be deferred but should be tracked}
- [ ] {Action 4}

---

## Assumptions

**We are assuming:**
1. {Assumption 1 - if this changes, we may need to revisit}
2. {Assumption 2}
3. {Assumption 3}

**Revisit this decision if:**
- {Condition 1 - trigger for re-evaluation}
- {Condition 2}
- {Condition 3}

---

## References

**Internal:**
- Spec: [spec-crystallize.md](../spec/spec-crystallize.md) (if applicable)
- Plan: [research-plan.md](../plan/research-plan*.md) (if applicable)
- Related decisions: [decision-X.md](./decision-{date}-{slug}.md) (if applicable)

**External:**
- {Link to documentation}
- {Link to RFC or proposal}
- {Link to similar decisions in other projects}

**Code references:**
- {File:line - existing pattern to follow}
- {File:line - code that will be affected}

---

## Revision History

| Date | Change | Author |
|------|--------|--------|
| {YYYY-MM-DD} | Initial decision | Claude Code |
{If superseded:}
| {YYYY-MM-DD} | Superseded by [decision-X.md](./decision-X.md) | {Author} |

---

*Decision recorded: {YYYY-MM-DD}*
*Session: [{SESSION_SLUG}](../README.md)*
```

# SUMMARY OUTPUT

After creating the decision record, print:

```markdown
# Decision Record Created

## Decision Location
Saved to: `.claude/{SESSION_SLUG}/decisions/decision-{YYYY-MM-DD}-{slug}.md`

## Decision Summary
**Topic:** {DECISION_TOPIC}
**Status:** {STATUS}
**Selected Option:** {Option name if decided, or "Pending" if proposed}

## Options Considered
1. **Option A**: {Name} - {One-line summary}
2. **Option B**: {Name} - {One-line summary}
3. **Option C**: {Name} - {One-line summary} (if applicable)

## Key Trade-Offs
**Choosing:** {What we're gaining}
**Sacrificing:** {What we're giving up}

## Decision Drivers (Ranked)
1. {Driver 1}
2. {Driver 2}
3. {Driver 3}

## Next Steps
{If STATUS = proposed:}
- Review this decision with {AUDIENCE}
- Make a final selection
- Update status to 'accepted'

{If STATUS = accepted:}
- Proceed with implementation
- Track follow-up actions listed in decision

## Related Artifacts
{List any specs, plans, or other decisions referenced}
```

# IMPORTANT: Decision Records vs Plans

- **Decision records**: Document significant choices and their rationale
- **Plans**: Document implementation approach

Decision records answer:
- **What** options did we consider?
- **Why** did we choose this one?
- **What** are the consequences?

Plans answer:
- **How** do we implement the chosen option?
- **What** are the steps?
- **When** do we do each step?

Decision records are more durable - they capture reasoning that remains relevant even as implementation evolves.

# WHEN TO USE THIS COMMAND

Create a decision record when:
- Multiple valid approaches exist
- The choice has significant consequences
- Future maintainers will need to understand "why"
- The decision affects architecture or patterns
- There's disagreement about the approach
- You want to document what was NOT chosen

Skip decision records for:
- Obvious or trivial choices
- Purely tactical implementation details
- Temporary workarounds

# EXAMPLE USAGE

## Example 1: Architecture Decision

**User input:**
```
/decision-record
DECISION_TOPIC: API authentication approach
CONTEXT: Need to secure API endpoints. Currently no auth. Options are JWT tokens, session cookies, or API keys. Need to support both web and mobile clients. Security is critical but also need simplicity.
```

**Agent:**
1. Infers SESSION_SLUG from last session
2. Parses context to identify 3 options (JWT, sessions, API keys)
3. Infers decision drivers: security (1), simplicity (2), client compatibility (3)
4. Researches codebase for existing auth patterns
5. Analyzes each option with pros/cons/risks
6. Generates decision record
7. Saves to: `decisions/decision-2026-01-15-api-authentication-approach.md`
8. Updates session README

## Example 2: Database Choice

**User input:**
```
/decision-record
DECISION_TOPIC: Database for user activity logs
CONTEXT: Need to store high-volume user activity data. Currently have PostgreSQL for transactional data. Considering: stick with Postgres, add TimescaleDB, or use dedicated time-series DB like InfluxDB. Write-heavy workload (10k events/sec), read-light (analytics once daily).
STATUS: proposed
```

**Agent:**
1. Validates session exists
2. Identifies 3 options from context
3. Infers drivers: write performance (1), operational complexity (2), cost (3)
4. Generates decision record with detailed analysis
5. Status: proposed (needs review)
6. Outputs summary with next steps

## Example 3: Decision During Implementation

**User input:**
```
/decision-record
DECISION_TOPIC: CSV parsing library
CONTEXT: Working on MVP. Need to parse CSV files. Options: built-in csv module, pandas, or custom parser. Files are 10K-100K rows. pandas seems heavy but has good error handling. Built-in is simple but basic.
STATUS: accepted
OPTIONS:
  - Option A: Use pandas
  - Option B: Use built-in csv module
  - Option C: Write custom parser
```

**Agent:**
1. Reads existing work log for context
2. Analyzes provided options
3. Status is 'accepted' - documents decision after the fact
4. Generates record explaining why pandas was chosen
5. Links to work log where this was implemented

**Result:**
Durable record of why pandas was chosen, even if implementation details change.
