# @warg/backfill-scripts

Operator-run Admin-SDK maintenance CLIs that make the tightened top-level
`articles` read rule safe to deploy. The Admin SDK bypasses Firestore security
rules, so these run as a trusted operator (via ADC), never as the app.

Three independent scripts share a small pure core (`keys` / `coverage` /
`classify`):

| Script | What it does | Destructive? |
| ------ | ------------ | ------------ |
| `marker-backfill` | Writes a `users/{uid}/articleMarkers/{key}` doc for every key of every one of the user's articles (`itemId`, plus `resolvedId` when present and distinct). Writes **only missing** keys; preserves any existing marker's `source`/`createdAt`. | No — never deletes. |
| `coverage-gate` | Asserts a marker exists for every derived key. Prints the headline counts and exits non-zero on any gap. This is the precondition that authorizes the read-rule flip. | No — read-only. |
| `debug-logs-cleanup` | Deletes the legacy flat `debug_logs/{id}` docs left unreadable after the uid-scoped `debug_logs/{uid}/sessions/*` migration. Classifies by field shape **and** the absence of a `sessions` subcollection. | Yes — only on `--apply`, only on `legacy-flat` docs. |

## Preconditions

1. **Application Default Credentials** with access to `trails-e428e`:

   ```sh
   gcloud auth application-default login
   ```

   `initializeApp()` is called with no credential argument and picks up ADC.
   Without it, the first Firestore call fails with an auth error (not a bug in
   these scripts).

2. **Node 22** and a built `dist/` (the scripts are plain compiled JS):

   ```sh
   pnpm --filter @warg/backfill-scripts build
   ```

## Prod vs. emulator targeting

Every write/delete script calls `assertTargetEnv()` before touching data:

- If `FIRESTORE_EMULATOR_HOST` is set, it logs `targeting EMULATOR <host>` and
  proceeds immediately.
- Otherwise it logs `targeting PRODUCTION trails-e428e` and waits **5 seconds**
  (Ctrl-C to abort) before continuing. Pass `--yes` to skip the wait in a
  non-interactive context.

Never hardcode `FIRESTORE_EMULATOR_HOST`; set it in the environment when you
want the emulator.

## CLI flags

All three scripts accept:

- `--user <uid>` — target user (**required** — no default). Pass the uid
  explicitly, or export `BACKFILL_USER_ID=<uid>` in the environment. Omitting
  both causes the script to exit with a clear error.
- `--apply` — perform writes/deletes. **Omitted = dry-run** (the default): the
  script reports exact counts and a sample of affected keys/ids without
  changing anything.
- `--limit <n>` — cap the number of articles scanned (backfill / gate), for a
  quick sample run.

## Dry-run-first workflow

```sh
# 0. build
pnpm --filter @warg/backfill-scripts build

# Set the target uid (or pass --user <uid> to each command below)
export BACKFILL_USER_ID=<your-uid>

# 1. backfill — review counts first, then apply
node dist/marker-backfill.js                 # dry-run: prints wouldWrite / alreadyPresent
node dist/marker-backfill.js --apply         # writes only the missing markers

# 2. gate — must exit 0 before the read-rule flip is deployed
node dist/coverage-gate.js                   # exits 0 when covered, 1 on any gap
                                             # (--limit is rejected by the gate)

# 3. cleanup — review, then apply, then confirm 0 remain
node dist/debug-logs-cleanup.js              # dry-run: legacy-flat count + sample ids
node dist/debug-logs-cleanup.js --apply      # recursiveDelete each legacy-flat doc
node dist/debug-logs-cleanup.js              # dry-run again: expect 0
```

## Deploy ordering (important)

The tightened `articles` read rule must be the **last** change to merge, because
merging `firebase/**` auto-deploys the rules. Run the backfill `--apply` and a
**passing** `coverage-gate` against production **before** that final rules
change lands. Backfill and the gate are deploy-safe to run any time — the read
rule they protect is not yet tightened.

## Tests

```sh
# pure unit tests (no emulator, CI-safe) — key derivation, coverage, classifier
pnpm --filter @warg/backfill-scripts test

# emulator integration tests (local / on-demand) — real writes, gate exit codes,
# cleanup targeting. Boots the Firestore emulator on the shared port (8080).
firebase emulators:exec --only firestore --project=demo-trails \
  --config=../../../firebase/firebase.json \
  'pnpm --filter @warg/backfill-scripts test:integration'
```

The integration suite defaults `FIRESTORE_EMULATOR_HOST` to `127.0.0.1:8080`
when unset, so it also runs against an already-running emulator with no extra
environment setup.
