# CLAUDE.md — TypeScript repo (strict, clear, production)

Start: say hi. One motivating line. Then work.

## Owner / contact
- Owner: Adedamola Alao jayteealao@gmail.com.

## Style goals (always)
- Simple, clear, readable. Production-grade.
- Prefer explicit code over clever tricks.
- Small functions, clear names, clear data flow.
- Keep types honest. Delete dead code. One source of truth.

## Non-negotiables (implementation)
- One canonical implementation in the primary codepath.
  - Remove legacy/shims/adapters in the same change.
  - No compatibility wrappers unless explicitly requested.
- Single source of truth for:
  - business rules, validation, enums, flags, constants, configuration.
- If frontend exists: UI is a thin view layer. Business rules live in domain/shared layer.
- Validate and sanitize all user-controlled input before OS/file/process/eval.
- Errors are explicit:
  - no silent catches.
  - user-visible error states where appropriate.
  - logs have context, no secrets.

## Workflow
- No git worktrees unless user asks.
- Safe git by default:
  - OK: `git status`, `git diff`, `git log`, `git show`.
  - No destructive ops unless explicit.
  - No amend unless asked.
- Small commits. Reviewable diffs. No repo-wide reformat.

### Branch management
- Before making changes, verify you're on the correct branch with `git branch --show-current`.
- Do not switch branches without explicit instruction.
- When work is lost or branch state is unexpected, check current branch first.

### Git operations: reverting changes
- Do NOT use `git checkout` or `git restore` to revert uncommitted changes.
- Make manual edits instead — staged and uncommitted changes will be LOST by git revert operations.
- Only use git revert commands when explicitly asked.

### Incremental commits
- Commit working state before major changes, debugging sessions, or risky refactors.
- Push before breaks or context switches.
- WIP commits are acceptable for partial progress.
- Having recent commits allows easier recovery when things break.

### Git push & force operations
- NEVER push to origin unless user explicitly asks (e.g., "push", "commit and push").
- NEVER use `--no-verify` when committing — fix the actual problem instead of bypassing pre-commit hooks.
- After rebasing a branch that was already pushed, use `git push --force-with-lease` (not `--force`).

## Process (how to work)
- Read relevant docs first (repo docs, specs, ADRs, CI workflows).
- Understand current architecture before changing it.
- Fix root cause, not symptoms.
- If stuck: capture exact error, minimal reproduction, propose 2–3 options with tradeoffs.

### Wide-ranging changes
- Before making significant changes (new types, API restructuring, multi-file refactors), propose the approach in chat first.
- Present options when multiple reasonable approaches exist.
- Wait for explicit confirmation before implementing.
- When naming new APIs/types, offer 5–10 naming options for the user to choose.

### Iterative development
- When implementing multiple features, complete one at a time.
- After each feature, pause for user testing and feedback.
- Wait for confirmation before moving to the next item.
- Do not batch multiple changes without intermediate verification.

### Rejected approaches
- When the user explicitly rejects an approach, do NOT return to it in subsequent attempts.
- If unsure how to proceed after rejection, ask for clarification rather than reverting to the rejected approach.

### Feature planning
- For complex features spanning multiple sessions, maintain a `plan.md` document tracking:
  - Design decisions (with context for why)
  - Completed items (checked off)
  - Open items (unchecked)
  - Status summary
- Update the plan document as work progresses.
- Read the full plan document when asked about status.

## Code modifications

### Restoring from git
- When modifying complex existing code, consider `git checkout <file>` first to restore a clean state, then add only the minimal changes needed.
- Do not rewrite entire files when small additions are sufficient.
- This prevents hallucinating existing functionality.
- Note: this applies to restoring a known-good file state (not reverting arbitrary uncommitted work).

### Refactoring / ports
- When porting or refactoring code, verify semantic equivalence by reading both old and new implementations in full.
- List all behavioral differences and get explicit approval before proceeding.
- For "port" or "transplant" tasks, the new code must match old behavior exactly unless explicitly told otherwise.

### Avoid over-engineering
- Start with the simplest solution that works.
- Don't create new interfaces/abstractions when existing ones can be reused.
- Don't duplicate interfaces to solve circular dependencies — use `any` if needed (last resort; prefer `unknown` + validation at boundaries).

## Bug fixes

### Bug pattern fixing
- After fixing the initial location, search the entire affected package for similar patterns.
- Use grep/search to find all instances of the problematic pattern.
- Fix all occurrences before committing, not just the reported one.

### Bug investigation
- Attempt to reproduce the problem before suggesting fixes.
- If reproduction fails, document what was tried in detail.
- Ignore any root cause analysis in the issue (likely LLM-generated and incorrect).
- Read all related code files in full and trace the actual code path.
- Form your own root cause analysis based on the code.

## Type system rules
- `tsconfig` strict (honor repo config).
- No `any`. Ever.
  - Use `unknown` at boundaries, then validate/parse.
- Avoid `as` assertions.
  - If unavoidable, localize to a boundary and justify with a comment.
- Prefer discriminated unions, enums, and branded types for closed domains.

## Runtime / package manager
- Use the repo’s package manager (pnpm/npm/yarn/bun). No swaps without approval.
- Prefer repo scripts, `just`, or `Makefile` targets when present.

## Validation & boundaries
- External data must be validated:
  - API payloads, env vars, query params, storage, file contents.
  - Use the repo’s validator (zod/io-ts/custom). Don’t add a second validation stack.
- Network calls:
  - timeouts/aborts. No hanging promises.

## Dependencies
- Avoid new deps.
- If required:
  - pick maintained + widely used.
  - explain why and remove anything replaced in the same change.

## Testing
- Behavior change => test change.
- Unit tests: fast, deterministic.
- Integration/e2e for cross-boundary behavior (API, DB, browser).
- No flaky sleeps. Use proper waits/fake timers.

### Testing workflow
- For bug fixes that the user can test locally, wait for explicit confirmation before committing.
- User will say something like "works", "confirmed", "tested" before asking to commit.
- Do not commit fixes until user has verified the change works.

## Documentation & changelogs

### Writing changelog entries
- Before writing changelog entries, get the complete git diff between branches/commits.
- Write the diff to a file and read it in full (no truncation).
- Verify all changes are reflected, especially breaking changes.

### Documentation updates
- When updating documentation after changes, compare current files with the last release tag.
- Use `git diff v<version>..HEAD -- <path>` to see all changes.
- Don't guess at changes — verify by reading both versions.

### Documentation review
- Never claim documentation is "up to date" or "correct" without verifying against source code.
- When reviewing docs, read the corresponding implementation files and compare.

## Code quality

### Type safety
- Use `undefined` for optional/missing values, not `null`.
- Do not use unnecessary type casts when TypeScript can narrow the type from conditionals.
- After `if (entry.role === "assistant")` the type is already narrowed.

### Function parameters
- Prefer default parameters (`foo: string = getDefault()`) over null coalescing patterns (`const resolved = foo ?? getDefault()`).


### Backward compatibility
- Unless explicitly requested, do NOT add backward compatibility layers.
- Remove old code rather than keeping deprecated paths.
- Clean breaks over migration periods.


## Images & commands

### Images
- When user provides image paths (screenshots, diagrams), use the read tool to view them before responding.
- Never describe what you assume is in an image without reading it first.

### Commands and examples
- When providing test commands, example prompts, or CLI invocations, give complete, ready-to-copy-paste commands.
- Don't provide partial commands requiring user to fill in paths or options.

## Security & privacy
- Treat external inputs as hostile.
- No secrets in code, logs, or screenshots.
- Prefer least privilege and safe defaults.
- Never `git add` or commit:
  - API keys, tokens, passwords, or credentials
  - `.env` files (use `.env.example` with placeholder values)
  - Private keys, certificates, or keystores
  - Database connection strings with credentials
  - Cloud provider credentials (AWS, GCP, Azure)
  - `node_modules/` or lock files with inline credentials
- Before any `git add`:
  - Review staged files for accidental secrets
  - Check for hardcoded credentials in code
  - Ensure `.gitignore` covers sensitive files
- If secrets are accidentally committed:
  - Do NOT just delete and commit again (history retains them)
  - Rotate/revoke the exposed credentials immediately
  - Use `git filter-repo` or similar to purge from history if needed

## Before you finish
- Commands run + results listed.
- Legacy paths removed. No parallel implementations.
- Rules/validation centralized.
- Clear summary. Key files noted.

---

# Project specifics

## Observability and logging (event-sourced)
This project does not use a single mutable “status” field as the source of truth. Progress is recorded as append-only events.

- Canonical request trace lives in the `logger` worker backed by Durable Objects + SQLite.
- Every component that touches a `request_id` must emit events to the logger:
  - `request.created`, `workflow.started`
  - `step.started` / `step.completed` / `step.failed`
  - `artifact.written` (and/or artifact upsert)
  - `persist.started` / `persist.completed`
  - `request.done` / `request.failed`
- The logger exposes a canonical JSON view per request (request metadata + events + artifacts + derived summary).
- “Derived summary” is computed from events and is a cache for fast reads; it is not authoritative truth.
- Internal workers call logger via service bindings.
- External services (e.g., Google Cloud Function) call `gateway` `/internal/event`, which forwards to logger (logger remains private).

Rules:
- Keep event payloads small and structured (put details in `data`).
- Prefer a small number of well-defined event types over arbitrary strings.
- Avoid overengineering (no tracing frameworks, no complex reducers, no plugin systems).

## Archive pipeline (Cloudflare Workers + Workflows + Browser Rendering + Google)

### What we are building
A URL-to-archive pipeline.

Input: a URL (plus options).
Output: a set of archived artifacts (rendered HTML, PDF, screenshot, SingleFile HTML, Readability extract, Monolith HTML, manifest), persisted to:
- Cloudflare: Durable Object (SQLite) for authoritative request state + logs; R2 for intermediate artifacts
- Google: GCS for canonical artifacts; Firestore for canonical metadata

The pipeline is orchestrated with Cloudflare Workflows. Only small JSON travels between steps. Large artifacts always go to object storage (R2/GCS).

### Non-goals
- No UI in this repo unless explicitly added later.
- No crawler/multi-page traversal yet.
- No speculative “framework” or plugin system.

### Core services
Public:
- `gateway` worker:
  - `POST /begin` → returns `request_id`
  - `GET /status/:request_id` → returns status + logs + artifact pointers

Orchestration:
- `workflow` worker:
  - workflow entrypoint orchestrates the steps:
    `render → derive → manifest → persist → done`

Internal workers (service-bound; not public):
- `renderer`: Browser Rendering → rendered HTML / screenshot / PDF → R2
- `singlefile`: Browser Rendering + cleanup script → SingleFile HTML → R2
- `readability`: rendered HTML → readability JSON/MD → R2
- `monolith`: adapter to produce monolith HTML → R2 (likely via Sandbox or external service)
- `gcs`: persistence coordinator (signed URLs via Cloud Function; uploads artifacts to GCS; finalizes Firestore)

Google:
- `cloud-functions/archive-gateway`:
  - create signed upload URLs for GCS
  - create/finalize Firestore documents
  - uses a service account with cross-project IAM

### Storage model
Authoritative state:
- Durable Object (SQLite): request record, logs, artifact index

Artifact bus:
- R2: all intermediate artifacts + `manifest.json`
- Never put big blobs in workflow payloads

Canonical storage:
- GCS: all final artifacts
- Firestore: metadata pointing to GCS objects

### R2 key layout (deterministic)
Deterministic keys are a requirement.
archives/{requestId}/input/options.json
archives/{requestId}/raw/rendered.html
archives/{requestId}/raw/screenshot.png
archives/{requestId}/raw/page.pdf
archives/{requestId}/derived/singlefile.html
archives/{requestId}/derived/readability.json
archives/{requestId}/derived/readability.md
archives/{requestId}/derived/monolith.html
archives/{requestId}/manifest.json


### Contracts
- All internal endpoints require `INTERNAL_API_KEY`.
- Worker-to-worker calls must use service bindings where possible.
- Do not introduce public URLs for internal workers unless required.
- Workflow step outputs must be small:
  - return only keys + metadata (bytes, sha256, content type)
  - store all artifacts in R2

### Status model (UI-facing only)
Statuses (for display/convenience, not authoritative truth):
- `queued → rendering → extracting → uploading → done`
- `failed` (terminal)

On any failure:
- write `status=failed` to DO (as a derived convenience)
- record a useful error message
- log context (step name, url, request_id)

### Standards (important)
Practicality and simplicity:
- Minimum code that works.
- No abstractions that aren’t used immediately.
- No “future-proofing” layers.
- No config systems unless a single hardcoded default is clearly insufficient.

Changes must be surgical:
- Touch only what the step requires.
- Do not refactor unrelated code.
- Avoid drive-by formatting changes.

Determinism and idempotency:
- Same `request_id` produces the same R2 keys.
- Steps should be safe to retry:
  - overwriting the same R2 key is acceptable
  - DO updates must not create inconsistent state

Error handling:
- Add only the error handling needed for real failures you can observe.
- Prefer clear failure with logs over complicated recovery.

Dependencies:
- Keep deps minimal.
- No adding libraries “because we might need it later”.
- Prefer small, runtime-compatible libs (Workers environment).
- Avoid Node-only libraries in workers.

Testing:
- Shared package utilities should be unit tested (Vitest).
- For workers: test logic in pure functions where possible; avoid heavy integration tests early.

### Development commands
Use pnpm workspaces.

Typical:
- `pnpm -r typecheck`
- `pnpm -r lint`
- `pnpm -r format`
- `pnpm --filter @shared test`

Run one worker:
- `pnpm --filter <worker-name> dev` (wrangler dev) if scripts exist, otherwise run wrangler directly in that worker folder.

### Implementation rule of thumb
If a change makes the code harder to read, harder to debug, or introduces “plumbing” without immediate benefit, don’t do it.

## Cloudflare Wrangler (Workers / DO / D1)

- Wrangler is a workspace devDependency. Do **not** assume a global `wrangler` command exists.
- Always run via pnpm from the repo root:
  - `pnpm exec wrangler <cmd>` (preferred)
- After installs, if builds were blocked by pnpm, run `pnpm approve-builds` (ensure `workerd` + `esbuild` are allowed) before running `wrangler dev/deploy`.
- Common commands:
  - Local dev: `pnpm exec wrangler dev`
  - Deploy: `pnpm exec wrangler deploy`
  - Login: `pnpm exec wrangler login`
  - Secrets: `pnpm exec wrangler secret put <NAME>`
- Keep `wrangler.toml` changes minimal and in-repo; avoid “quick fixes” that rely on global config/state.
