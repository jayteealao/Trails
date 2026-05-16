---
name: brainstorming
description: This skill should be used when clarifying WHAT to build before HOW, triggered by ambiguous requests or when the user wants to explore requirements and approaches collaboratively.
---

# Brainstorming

Structured requirement clarification methodology. Guides answering **WHAT** to build through collaborative dialogue before implementation planning.

## When to Use

- Feature requests with vague or ambiguous requirements
- User says "let's brainstorm" or "I'm thinking about..."
- Multiple valid interpretations exist for a request
- Requirements need exploration before planning

## When to Skip

- Requirements are explicit with clear acceptance criteria
- User has referenced existing patterns to follow
- Exact expected behavior is already described
- Scope is well-defined and constrained

## Four-Phase Process

### Phase 0: Assess Requirement Clarity

Before brainstorming, evaluate whether it's needed:

**Clear requirements indicators:**
- Specific acceptance criteria provided
- Referenced existing patterns to follow
- Described exact expected behavior
- Constrained, well-defined scope

If requirements are already clear, suggest proceeding directly to `/workflows:plan`.

### Phase 1: Understand the Idea

Ask questions **one at a time** to avoid overwhelming the user.

**Question techniques:**
- Use multiple choice when natural options exist (prefer AskUserQuestion tool)
- Start broad (purpose, users, context) then narrow (constraints, edge cases)
- Validate assumptions explicitly rather than assuming
- Ask about success criteria early

**Topics to explore:**
1. **Purpose**: What problem does this solve? Who benefits?
2. **Users**: Who will use this? What's their context?
3. **Constraints**: Timeline, technical limitations, dependencies?
4. **Success criteria**: How do we know this works?
5. **Edge cases**: What could go wrong? What's out of scope?

**Exit condition:** Continue until the idea is clear OR user says "proceed."

### Phase 2: Explore Approaches

Propose **2-3 concrete approaches** based on research and conversation.

For each approach, provide:
- Brief description (2-3 sentences)
- Pros and cons (be honest about tradeoffs)
- When it's best suited

**Lead with a recommendation** and explain why. Apply YAGNI — prefer simpler solutions.

### Phase 3: Capture the Design

Create a concise design document:

**Location:** `.claude/brainstorms/YYYY-MM-DD-<topic>-brainstorm.md`

**Template:**

```markdown
# [Feature/Improvement Name]

## What We're Building
[1-2 paragraphs describing the feature and its purpose]

## Why This Approach
[Chosen approach and rationale]

## Key Decisions
- [Decision 1]: [Rationale]
- [Decision 2]: [Rationale]

## Constraints
- [Technical, timeline, or scope constraints]

## Open Questions
- [Unresolved questions for planning phase]

## Out of Scope
- [Explicitly excluded items]
```

### Phase 4: Handoff

Offer next steps:
1. **Review and refine** — Improve the document (use `document-review` skill)
2. **Proceed to planning** — Run `/workflows:plan` with this brainstorm
3. **Done for now** — Return later

## Key Principles

### YAGNI Focus
- Resist adding complexity for hypothetical requirements
- "Will we definitely need this?" — if uncertain, leave it out
- The simplest approach that meets current needs is usually best

### Incremental Validation
- Keep sections 200-300 words, pause for feedback
- Don't present a complete design without checking in
- Better to iterate 3 times on something small than present one large document

### One Question at a Time
- Don't ask multiple questions simultaneously
- Wait for each answer before the next question
- This respects the user's attention and gets better answers

### Stay Conceptual
- Answer WHAT, not HOW (implementation details belong in `/workflows:plan`)
- Don't write code or pseudo-code during brainstorming
- Focus on requirements, constraints, and approach selection

## Anti-Patterns to Avoid

| Anti-Pattern | Better Approach |
|---|---|
| Asking 5 questions at once | Ask one, wait, ask next |
| Jumping to implementation details | Stay at requirements level |
| Assuming requirements without validating | Ask "Is this what you mean?" |
| Adding features "just in case" | Apply YAGNI strictly |
| Writing code during brainstorming | Save code for planning/implementation |
| Presenting only one approach | Always offer 2-3 options |
