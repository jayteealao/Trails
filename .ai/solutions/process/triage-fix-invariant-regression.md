---
schema: sdlc/v1
type: solution
category: process
source-workflow: simplify-android-app
created-at: "2026-07-11T08:44:42Z"
tags: [triage, bot-review, regression, invariant, firestore-rules, budget-cap, handoff, test-update]
status: active
---

# Triage fixes must prove documented invariants still hold — never update a test to match

## Problem
The highest-severity finding of the whole workflow (RE-3, HIGH: Firestore 20-article
budget-cap regression) was not in the original implementation — it was INTRODUCED by a
bot-review triage fix during handoff (chunk-by-write-count commit). The fix removed the
article-count flush condition whose limit was documented in the adjacent rules file
comment, and the existing chunking test was *updated to match the new behavior* instead
of catching the break. The regression survived until the second full review run.
Related pattern the same workflow: a bot-raised threading concern (selfHealAttempts)
was dismissed as "theoretical", re-raised by a different bot, then fixed as a one-liner
— dismiss→re-encounter→fix cost a handoff revision + 6 CI watch rounds.

## Learning
Handoff-time triage fixes get less scrutiny than slice implementation but the same
blast radius. Two rules: (1) before landing a triage fix that touches code with a
documented invariant (a comment citing a limit, a rules-file budget, a schema cap),
write a regression test asserting THAT invariant first — if the fix makes an existing
test fail, treat the test as the spec until proven otherwise; (2) dismissing a bot
finding as "theoretical" requires evidence proportional to the cost of just fixing it —
a one-line fix is almost always cheaper than a dismissal that can be re-raised.

## How to apply
- In handoff triage, for each fix: grep ±20 lines around the change for numeric limits
  in comments/rules and assert them in a test before committing.
- Never modify an existing assertion in the same commit as the behavior change it
  guards, unless the PO has confirmed the spec changed.
