#!/usr/bin/env bash
# Stub harness for scripts/deploy.sh. Runs the real script end to end against
# stub cf, wrangler, firebase, gcloud and pnpm executables (bin/) in a
# throwaway git repository that mirrors the warg layout, so every branch of
# the deploy flow is proven without credentials. Prints PASS or FAIL per
# scenario and exits 1 when any scenario fails.
#
#   bash scripts/deploy-harness/run.sh [scenario...]
#   HARNESS_TMP=<dir>   put the throwaway tree under <dir> (default: mktemp)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WARG="$(cd "$HERE/../.." && pwd)"
BIN="$HERE/bin"
DEPLOY_SH="$WARG/scripts/deploy.sh"

# The worker and function lists, the secret table and the function table come
# from deploy.sh itself, so the harness never keeps its own copy.
read -r -a WORKERS <<<"$(sed -n 's/^WORKERS=(\(.*\))$/\1/p' "$DEPLOY_SH")"
read -r -a FUNCTIONS <<<"$(sed -n 's/^CLOUD_FUNCTIONS=(\(.*\))$/\1/p' "$DEPLOY_SH")"
if [ "${#WORKERS[@]}" -eq 0 ] || [ "${#FUNCTIONS[@]}" -eq 0 ]; then
  echo "deploy harness: cannot read WORKERS or CLOUD_FUNCTIONS from $DEPLOY_SH" >&2
  exit 1
fi
eval "$(sed -n '/^required_secrets_for() {$/,/^}$/p; /^function_names_for() {$/,/^}$/p; /^private_functions_for() {$/,/^}$/p' "$DEPLOY_SH")"
H_ALL_SECRETS="$(for w in "${WORKERS[@]}"; do required_secrets_for "$w" | tr ' ' '\n'; done | sort -u | tr '\n' ' ')"
export H_ALL_SECRETS

if [ -n "${HARNESS_TMP:-}" ]; then
  mkdir -p "$HARNESS_TMP"
  ROOT="$(mktemp -d "$HARNESS_TMP/run.XXXXXX")"
else
  ROOT="$(mktemp -d)"
fi
ROOT="$(cd "$ROOT" && pwd)"
trap 'rm -rf "$ROOT"' EXIT

# --- Fixture tree ---------------------------------------------------------------
FIX="$ROOT/repo"
mkdir -p "$FIX/scripts" "$FIX/pages/dashboard"
cp "$WARG/scripts/deploy.sh" "$FIX/scripts/deploy.sh"
cp "$WARG/scripts/rules-release.mjs" "$FIX/scripts/rules-release.mjs"
for w in "${WORKERS[@]}"; do
  mkdir -p "$FIX/workers/$w"
  echo "{}" >"$FIX/workers/$w/package.json"
done
for fn in "${FUNCTIONS[@]}"; do
  mkdir -p "$FIX/cloud-functions/$fn"
  echo "PLACEHOLDER=1" >"$FIX/cloud-functions/$fn/.env"
done
# The functions that accept the old shared key must state the switch.
for fn in archive-gateway backfill-archiver dashboard-api; do
  echo "KEY_ROTATION_DUAL_ACCEPT=false" >>"$FIX/cloud-functions/$fn/.env"
done
# The required deploy configuration (no real user id).
echo "DASHBOARD_USER_ID=harness-user" >>"$FIX/cloud-functions/dashboard-api/.env"
echo "BACKFILL_USER_ID=harness-user" >>"$FIX/cloud-functions/backfill-archiver/.env"
# deploy.sh deploys the rules from the repository's firebase/ folder, which
# sits beside warg/ (here: beside the fixture repo).
RULES_SRC="$(cd "$WARG/.." && pwd)/firebase"
RULES_FIX="$ROOT/firebase"
mkdir -p "$RULES_FIX"
for f in firebase.json .firebaserc firestore.rules storage.rules; do
  cp "$RULES_SRC/$f" "$RULES_FIX/$f"
done
echo 'name = "warg-dashboard"' >"$FIX/pages/dashboard/wrangler.toml"
# A clean production dry run of the link re-derive, where deploy.sh looks for
# it by default; the link-check scenarios pass their own reports.
# rederive_report <file> <mode> <target> <linkAdds>: writes a re-derive report.
rederive_report() {
  cat >"$1" <<JSON
{"mode":"$2","target":"$3","generatedAt":"2026-10-27T00:00:00.000Z","counts":{"users":1,"articles":2,"linkAdds":$4,"linkChanges":0,"linkClears":0,"errors":0},"preconditionFailures":[]}
JSON
}
mkdir -p "$FIX/cloud-functions/backfill-scripts/tmp"
rederive_report "$FIX/cloud-functions/backfill-scripts/tmp/rederive-pass-b-20261026T000000Z.json" dry-run production 5
rederive_report "$FIX/cloud-functions/backfill-scripts/tmp/rederive-pass-b-20261027T000000Z.json" dry-run production 0
git -C "$FIX" init -q
git -C "$FIX" config core.autocrlf false
git -C "$FIX" add -A
git -C "$FIX" -c user.name=harness -c user.email=harness@example.invalid commit -q -m fixture
SHA="$(git -C "$FIX" rev-parse HEAD)"
SHORT="${SHA:0:12}"

# --- Runner and assertions --------------------------------------------------------
PASSED=0
FAILED=0
FAILED_NAMES=()
NAME=""
OUT=""
RC=0
CALLS=""
ERRORS=()
UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
LABEL="$SHA"

# run_deploy <scenario> [VAR=value...] -- [deploy.sh flags...]
run_deploy() {
  NAME="$1"
  shift
  local vars=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do
    vars+=("$1")
    shift
  done
  [ $# -eq 0 ] || shift
  local state="$ROOT/state-$NAME"
  mkdir -p "$state"
  : >"$state/calls.log"
  CALLS="$state/calls.log"
  RC=0
  OUT="$(cd "$FIX" && env HARNESS_STATE="$state" DEPLOY_TOOL_PATH="$BIN" PATH="$BIN:$PATH" \
    DEPLOY_POLL_INTERVAL=0 DEPLOY_POLL_TIMEOUT=0 ${vars[@]+"${vars[@]}"} \
    bash scripts/deploy.sh "$@" 2>&1)" || RC=$?
}

start() {
  NAME="$1"
  ERRORS=()
}
fail() { ERRORS+=("$1"); }
expect_rc() { [ "$RC" -eq "$1" ] || fail "exit code $RC, expected $1"; }
expect_out() { printf '%s\n' "$OUT" | grep -Eq -- "$1" || fail "no output line matches: $1"; }
expect_no_out() { if printf '%s\n' "$OUT" | grep -Eq -- "$1"; then fail "an output line matches: $1"; fi; }
expect_calls() { # expect_calls <count> <regex>
  local n
  n="$(grep -Ec -- "$2" "$CALLS" || true)"
  [ "$n" -eq "$1" ] || fail "$n calls match '$2', expected $1"
}
expect_row() { # expect_row <target> <result> [detail regex]
  expect_out "^$1 +$2 +${3:-.*} +$LABEL\$"
}

finish() {
  if [ "${#ERRORS[@]}" -eq 0 ]; then
    echo "PASS $NAME"
    PASSED=$((PASSED + 1))
  else
    echo "FAIL $NAME"
    printf '  - %s\n' "${ERRORS[@]}"
    printf '%s\n' "$OUT" | sed 's/^/  | /'
    FAILED=$((FAILED + 1))
    FAILED_NAMES+=("$NAME")
  fi
}

# --- Scenarios --------------------------------------------------------------------

# Charter scenario, steps 1 to 6: label, preflight, worker deploy and version
# check, function deploy and updateTime check, dashboard and commit_hash check,
# summary and exit code.
scenario_full_success() {
  start full-success
  run_deploy full-success -- --all --with-rules
  expect_rc 0
  expect_out "^Deploying label: $SHA\$"
  expect_calls 9 '^cf workers secrets list --worker '
  expect_calls 1 '^pnpm -r typecheck$'
  expect_calls 1 '^pnpm -r test$'
  local w fn
  for w in "${WORKERS[@]}"; do
    expect_row "worker:$w" deployed "$UUID"
  done
  expect_calls 9 "^cf deploy --tag $SHORT --message $SHA --provision=false\$"
  for fn in "${FUNCTIONS[@]}"; do
    expect_row "function:$fn" deployed ".*@20[0-9-]+T.*"
    expect_calls 1 "^firebase deploy --only functions:$fn --project trails-e428e --non-interactive GIT_SHA=$SHA\$"
  done
  expect_calls 6 '^gcloud functions describe .* --region us-central1 --project trails-e428e'
  expect_calls 3 '^gcloud run services get-iam-policy .* --region us-central1 --project trails-e428e --format=json$'
  expect_row "function:user-triggers" deployed ".* invoker private"
  expect_calls 1 '^firebase deploy --only firestore:rules,storage --project trails-e428e --non-interactive --config firebase.json'
  expect_row "rules:firestore" deployed "firestore-[0-9]+ sha256:[0-9a-f]{12} grace 20.*"
  expect_row "rules:storage" deployed "trails-e428e.firebasestorage.app=storage-[0-9]+ htbase-archives-standard=storage-[0-9]+ sha256:[0-9a-f]{12}"
  expect_calls 0 'headers=missing'
  expect_calls 0 'no-timeouts'
  expect_no_out 'harness-token'
  expect_calls 0 'harness-token'
  expect_calls 1 "^wrangler pages deploy --branch main --commit-hash $SHA --commit-message $SHA --commit-dirty=false\$"
  expect_row "pages:dashboard" deployed "$UUID"
  expect_out '^=== Link check passed: cloud-functions/backfill-scripts/tmp/rederive-pass-b-20261027T000000Z.json '
  expect_out '^TARGET +RESULT +DETAIL +LABEL$'
  expect_out '^Exit code: 0$'
  finish
}

# The link check: a re-derive report that plans a link change, one that is not
# a production dry run, or no report holds dashboard-api back while the other
# functions deploy; the override deploys it and warns.
expect_dashboard_held() { # expect_dashboard_held <reason regex>
  expect_row "function:dashboard-api" skipped "held back: $1"
  expect_out "^WARNING: dashboard-api held back: $1"
  expect_calls 0 '^firebase deploy --only functions:dashboard-api '
  expect_calls 1 '^firebase deploy --only functions:user-triggers '
}

scenario_link_check_plans_change() {
  start link-check-plans-change
  rederive_report "$ROOT/report-change.json" dry-run production 3
  run_deploy link-check-plans-change -- --functions-only --skip-checks --rederive-report "$ROOT/report-change.json"
  expect_rc 0
  expect_dashboard_held ".*plans linkAdds=3 linkChanges=0 linkClears=0 errors=0"
  expect_row "function:archive-gateway" deployed ".*"
  expect_out '^Exit code: 0$'
  finish
}

scenario_link_check_not_production_dry_run() {
  start link-check-not-production-dry-run
  rederive_report "$ROOT/report-apply.json" apply production 0
  rederive_report "$ROOT/report-emulator.json" dry-run emulator 0
  run_deploy link-check-apply -- --functions-only --skip-checks --rederive-report "$ROOT/report-apply.json"
  expect_rc 0
  expect_dashboard_held '.*is not a dry run \(mode apply\)'
  run_deploy link-check-emulator -- --functions-only --skip-checks --rederive-report "$ROOT/report-emulator.json"
  expect_rc 0
  expect_dashboard_held '.*is not a production run \(target emulator\)'
  NAME=link-check-not-production-dry-run
  finish
}

scenario_link_check_missing_report() {
  start link-check-missing-report
  run_deploy link-check-missing-report -- --all --skip-checks --rederive-report "$ROOT/no-such-report.json"
  expect_rc 0
  expect_dashboard_held 'no link re-derive dry-run report at .*'
  expect_calls 9 '^cf deploy '
  expect_row "pages:dashboard" deployed "$UUID"
  expect_out '^Exit code: 0$'
  finish
}

scenario_link_check_skipped() {
  start link-check-skipped
  rederive_report "$ROOT/report-skip.json" dry-run production 3
  run_deploy link-check-skipped -- --functions-only --skip-checks --rederive-report "$ROOT/report-skip.json" --skip-rederive-check
  expect_rc 0
  expect_out '^=== Link check skipped \(--skip-rederive-check\) ===$'
  expect_out '^WARNING: link check skipped \(--skip-rederive-check\)'
  expect_row "function:dashboard-api" deployed ".*"
  expect_out '^Exit code: 0$'
  finish
}

scenario_link_check_rules_only() {
  start link-check-rules-only
  run_deploy link-check-rules-only -- --rules-only --skip-checks --rederive-report "$ROOT/no-such-report.json"
  expect_rc 0
  expect_no_out 'Link check'
  expect_out '^Exit code: 0$'
  finish
}

scenario_secrets_list_fails() {
  start secrets-list-fails
  run_deploy secrets-list-fails H_SECRETS_FAIL=renderer --
  expect_rc 1
  expect_row "worker:renderer" failed 'secret listing failed \(exit 1\)'
  local w
  for w in logger hyperrenderer singlefile readability monolith gcs workflow gateway; do
    expect_row "worker:$w" skipped '-'
  done
  # The preflight covers every worker before the first deploy.
  expect_calls 0 '^cf deploy'
  expect_out 'Authentication error'
  expect_out '^Exit code: 1$'
  finish
}

scenario_secret_missing() {
  start secret-missing
  run_deploy secret-missing H_SECRETS_MISSING=monolith:R2_ACCOUNT_ID --
  expect_rc 3
  expect_row "worker:readability" skipped '-'
  expect_row "worker:monolith" failed 'missing secret\(s\): R2_ACCOUNT_ID'
  expect_row "worker:gcs" skipped '-'
  expect_out 'wrangler secret put <NAME> --config workers/monolith/wrangler.jsonc'
  expect_calls 0 '^cf deploy'
  finish
}

# A secret missing on the last worker in deploy order stops the run before any
# worker is deployed, so the fleet is never left on mixed versions.
scenario_secret_missing_last_worker() {
  start secret-missing-last-worker
  run_deploy secret-missing-last-worker H_SECRETS_MISSING=gateway:PUBLIC_API_KEY -- --all
  expect_rc 3
  expect_row "worker:gateway" failed 'missing secret\(s\): PUBLIC_API_KEY'
  local w
  for w in logger renderer hyperrenderer singlefile readability monolith gcs workflow; do
    expect_row "worker:$w" skipped '-'
  done
  expect_row "function:archive-gateway" skipped '-'
  expect_row "pages:dashboard" skipped '-'
  expect_calls 9 '^cf workers secrets list --worker '
  expect_calls 0 '^cf deploy'
  expect_calls 0 '^cf workers deployments list'
  expect_calls 0 '^firebase '
  expect_calls 0 '^wrangler '
  finish
}

scenario_allow_missing_secrets() {
  start allow-missing-secrets
  run_deploy allow-missing-secrets H_SECRETS_FAIL=renderer H_NO_DEPLOYMENTS=renderer -- --skip-checks --allow-missing-secrets renderer
  expect_rc 0
  expect_row "worker:renderer" deployed "$UUID"
  expect_out '^WARNING: preflight skipped for renderer \(--allow-missing-secrets\)$'
  expect_calls 0 '^cf workers secrets list --worker renderer$'
  expect_calls 8 '^cf workers secrets list --worker '
  expect_row "worker:gateway" deployed "$UUID"
  finish
}

scenario_quick_still_preflights() {
  start quick-still-preflights
  run_deploy quick-still-preflights -- --skip-checks
  expect_rc 0
  expect_calls 9 '^cf workers secrets list --worker '
  expect_calls 0 '^pnpm '
  expect_row "worker:gateway" deployed "$UUID"
  finish
}

scenario_same_version_ids() {
  start same-version-ids
  run_deploy same-version-ids H_SAME_IDS=logger -- --skip-checks
  expect_rc 3
  expect_row "worker:logger" unverified "no new version id"
  expect_row "worker:renderer" skipped '-'
  expect_out '^Exit code: 3$'
  finish
}

scenario_foreign_version_id() {
  start foreign-version-id
  run_deploy foreign-version-id H_FOREIGN_ID=gcs -- --skip-checks
  expect_rc 3
  expect_row "worker:monolith" deployed "$UUID"
  expect_row "worker:gcs" unverified "new id $UUID not produced by this run"
  expect_row "worker:workflow" skipped '-'
  finish
}

scenario_no_printed_id_tag_match() {
  start no-printed-id-tag-match
  run_deploy no-printed-id-tag-match H_NO_PRINT=logger -- --skip-checks
  expect_rc 0
  expect_row "worker:logger" deployed "$UUID"
  expect_calls 1 "^cf workers versions get $UUID --worker-id logger\$"
  expect_out 'matched by tag'
  finish
}

scenario_no_printed_id_foreign() {
  start no-printed-id-foreign
  run_deploy no-printed-id-foreign H_NO_PRINT=logger H_FOREIGN_ID=logger -- --skip-checks
  expect_rc 3
  expect_row "worker:logger" unverified "new id $UUID not produced by this run"
  finish
}

scenario_dirty_refused() {
  start dirty-refused
  echo "scratch" >"$FIX/untracked.txt"
  run_deploy dirty-refused -- --all
  rm -f "$FIX/untracked.txt"
  expect_rc 2
  expect_out 'uncommitted or untracked files'
  expect_out 'untracked.txt'
  expect_calls 0 '^cf deploy'
  expect_calls 0 '^cf workers'
  expect_calls 0 '^pnpm '
  expect_out '^Exit code: 2$'
  finish
}

scenario_dirty_allowed() {
  start dirty-allowed
  echo "scratch" >"$FIX/untracked.txt"
  LABEL="$SHA-dirty"
  run_deploy dirty-allowed -- --all --with-rules --allow-dirty --skip-checks
  rm -f "$FIX/untracked.txt"
  expect_rc 0
  expect_out "^Deploying label: $SHA-dirty\$"
  expect_calls 9 '^cf deploy '
  expect_calls 9 "^cf deploy --tag $SHORT-dirty --message $SHA-dirty --provision=false\$"
  expect_calls 5 '^firebase deploy '
  expect_calls 5 "^firebase deploy .* GIT_SHA=$SHA-dirty\$"
  expect_calls 1 "^wrangler pages deploy --branch main --commit-hash $SHA-dirty --commit-message $SHA-dirty --commit-dirty=true\$"
  expect_row "pages:dashboard" deployed "$UUID"
  expect_row "worker:gateway" deployed "$UUID"
  LABEL="$SHA"
  finish
}

# --all never deploys the rules: they go out only with an explicit --with-rules.
scenario_all_without_rules() {
  start all-without-rules
  run_deploy all-without-rules -- --all --skip-checks
  expect_rc 0
  expect_calls 0 '^firebase deploy --only firestore:rules'
  expect_calls 0 '^curl '
  expect_no_out '^rules:'
  expect_out '^Exit code: 0$'
  finish
}

scenario_fn_old_updatetime() {
  start fn-old-updatetime
  run_deploy fn-old-updatetime H_OLD_UPDATE=backfillStatus -- --with-functions --skip-checks
  expect_rc 3
  expect_row "function:user-triggers" deployed "onUserArticleSave@.*"
  expect_row "function:backfill-archiver" unverified "backfillStatus updateTime 2000-01-01T00:00:00.000000000Z state ACTIVE, deploy start 20.*"
  expect_row "function:dashboard-api" skipped '-'
  finish
}

scenario_fn_new_updatetime() {
  start fn-new-updatetime
  run_deploy fn-new-updatetime -- --with-functions --skip-checks
  expect_rc 0
  expect_row "function:backfill-archiver" deployed "backfillArchiver@.* backfillStatus@.* articleStatusDerive@.*"
  expect_row "function:dashboard-api" deployed "dashboardApi@.*"
  expect_row "function:user-triggers" deployed "onUserArticleSave@.* invoker private"
  expect_calls 3 '^gcloud run services get-iam-policy '
  expect_calls 1 '^gcloud run services get-iam-policy onuserarticlesave '
  expect_calls 1 '^gcloud run services get-iam-policy backfillarchiver '
  expect_calls 1 '^gcloud run services get-iam-policy articlestatusderive '
  expect_no_out '^pages:dashboard '
  expect_no_out '^rules:'
  finish
}

scenario_fn_deploy_fails() {
  start fn-deploy-fails
  run_deploy fn-deploy-fails H_FIREBASE_RC=4 -- --with-functions --skip-checks
  expect_rc 4
  expect_row "function:archive-gateway" failed "firebase deploy exited 4"
  expect_row "function:user-triggers" skipped '-'
  expect_calls 0 '^gcloud functions describe'
  expect_calls 0 '^gcloud run '
  finish
}

scenario_pages_hash_mismatch() {
  start pages-hash-mismatch
  run_deploy pages-hash-mismatch H_PAGES_HASH=0123456789abcdef0123456789abcdef01234567 -- --with-pages --skip-checks
  expect_rc 3
  expect_row "pages:dashboard" unverified "newest commit_hash is 0123456789abcdef0123456789abcdef01234567, expected $SHA"
  expect_calls 1 "^wrangler pages deploy --branch main --commit-hash $SHA "
  finish
}

# A dashboard deploy with wrangler not signed in stops before the first worker
# upload; the same for the functions with firebase not signed in. A token in
# the environment counts as a firebase sign-in.
scenario_pages_unauth() {
  start pages-unauth
  run_deploy pages-unauth HARNESS_WRANGLER_UNAUTH=1 -- --with-pages --skip-checks
  expect_rc 3
  expect_row "pages:dashboard" failed 'wrangler is not signed in \(run wrangler login or set CLOUDFLARE_API_TOKEN\)'
  local w
  for w in "${WORKERS[@]}"; do
    expect_row "worker:$w" skipped '-'
  done
  expect_no_out ' deployed '
  expect_calls 1 '^wrangler whoami$'
  expect_calls 0 '^cf deploy'
  expect_calls 0 '^wrangler pages deploy'
  expect_out '^Exit code: 3$'
  finish
}

scenario_functions_unauth() {
  start functions-unauth
  run_deploy functions-unauth HARNESS_FIREBASE_UNAUTH=1 FIREBASE_TOKEN= GOOGLE_APPLICATION_CREDENTIALS= -- --with-functions --skip-checks
  expect_rc 3
  expect_row "function:archive-gateway" failed 'firebase is not signed in \(run firebase login or set FIREBASE_TOKEN\)'
  local w fn
  for w in "${WORKERS[@]}"; do
    expect_row "worker:$w" skipped '-'
  done
  for fn in user-triggers backfill-archiver dashboard-api; do
    expect_row "function:$fn" skipped '-'
  done
  expect_no_out ' deployed '
  expect_calls 1 '^firebase login:list '
  expect_calls 0 '^cf deploy'
  expect_calls 0 '^firebase deploy'
  expect_out '^Exit code: 3$'
  run_deploy functions-token HARNESS_FIREBASE_UNAUTH=1 FIREBASE_TOKEN=harness-token GOOGLE_APPLICATION_CREDENTIALS= -- --with-functions --skip-checks
  expect_rc 0
  expect_calls 0 '^firebase login:list '
  expect_row "function:dashboard-api" deployed "dashboardApi@.*"
  NAME=functions-unauth
  finish
}

scenario_induced_failure_rc() {
  start induced-failure-rc
  run_deploy induced-failure-rc H_DEPLOY_RC=renderer:7 -- --all --skip-checks
  expect_rc 7
  expect_row "worker:logger" deployed "$UUID"
  expect_row "worker:renderer" failed "cf deploy exited 7"
  expect_row "worker:gateway" skipped '-'
  expect_row "function:archive-gateway" skipped '-'
  expect_row "pages:dashboard" skipped '-'
  expect_out '^Exit code: 7$'
  finish
}

scenario_precheck_fails() {
  start precheck-fails
  run_deploy precheck-fails H_PNPM_RC=5 -- --all
  expect_rc 5
  expect_calls 0 '^cf deploy'
  expect_row "worker:logger" skipped '-'
  expect_out '^Exit code: 5$'
  finish
}

scenario_unknown_flag() {
  start unknown-flag
  run_deploy unknown-flag -- --bogus
  expect_rc 2
  expect_out 'unknown flag: --bogus'
  expect_out '^Exit code: 2$'
  run_deploy unknown-flag-worker -- --allow-missing-secrets nosuchworker
  expect_rc 2
  expect_out "unknown worker 'nosuchworker'"
  run_deploy unknown-flag-missing-value -- --allow-missing-secrets
  expect_rc 2
  expect_out 'needs a worker name'
  NAME=unknown-flag
  finish
}

# --- Rules step -------------------------------------------------------------------

# grace_end_of <file>: the stamped grace end of a rules file (empty when none).
grace_end_of() {
  node "$WARG/scripts/rules-release.mjs" grace-end --in "$1"
}

# The first stamped deploy: no released Firestore rules, so the grace end is
# the deploy start plus 30 days, stamped into the uploaded copy and warned.
scenario_rules_first_stamp() {
  start rules-first-stamp
  local before after up end month=2592000000
  before="$(node -e 'console.log(Date.now())')"
  run_deploy rules-first-stamp -- --with-rules --skip-checks
  after="$(node -e 'console.log(Date.now())')"
  expect_rc 0
  expect_row "rules:firestore" deployed "firestore-[0-9]+ sha256:[0-9a-f]{12} grace 20.*"
  expect_row "rules:storage" deployed ".*htbase-archives-standard=storage-[0-9]+ sha256:[0-9a-f]{12}"
  expect_calls 1 '^firebase deploy --only firestore:rules,storage --project trails-e428e --non-interactive --config firebase.json'
  expect_out '^Grace end: .* \(first stamped deploy'
  expect_out '^WARNING: rules: the released Firestore rules held no grace end'
  up="$ROOT/state-rules-first-stamp/uploaded-firestore.rules"
  if [ ! -f "$up" ]; then
    fail "no rules were uploaded"
  else
    [ "$(grep -c '__GRACE_END_MS__' "$up")" -eq 1 ] || fail "the upload does not hold exactly one grace line"
    if grep -qF 'timestamp.value(0); // __GRACE_END_MS__' "$up"; then fail "the upload still holds the placeholder"; fi
    if grep -q $'\r' "$up"; then fail "the upload is not LF"; fi
    end="$(grace_end_of "$up")"
    if [ -z "$end" ] || [ "$end" -lt $((before + month)) ] || [ "$end" -gt $((after + month)) ]; then
      fail "grace end '$end' is not within [$((before + month)), $((after + month))]"
    fi
  fi
  expect_out '^Exit code: 0$'
  finish
}

# A later deploy reuses the grace end of the released rules.
scenario_rules_reused_stamp() {
  start rules-reused-stamp
  local seed="$ROOT/seed-reused.rules"
  node "$WARG/scripts/rules-release.mjs" stamp --in "$RULES_FIX/firestore.rules" --out "$seed" --end-ms 1893456000000
  run_deploy rules-reused-stamp H_RELEASED_FIRESTORE="$seed" -- --with-rules --skip-checks
  expect_rc 0
  expect_out '^Grace end: 2030-01-01T00:00:00.000Z \(reused from the released rules\)$'
  expect_no_out '^WARNING: rules:'
  [ "$(grace_end_of "$ROOT/state-rules-reused-stamp/uploaded-firestore.rules" 2>/dev/null)" = 1893456000000 ] || fail "the upload does not hold the reused grace end"
  expect_row "rules:firestore" deployed ".* grace 2030-01-01T00:00:00.000Z"
  expect_row "rules:storage" deployed ".*"
  finish
}

# Released rules that still hold the unstamped placeholder carry no grace end:
# the deploy starts the period and says so.
scenario_rules_released_zero() {
  start rules-released-zero
  run_deploy rules-released-zero H_RELEASED_FIRESTORE="$RULES_FIX/firestore.rules" -- --with-rules --skip-checks
  expect_rc 0
  expect_out '^Grace end: .* \(first stamped deploy'
  expect_out '^WARNING: rules: the released Firestore rules held no grace end'
  expect_row "rules:firestore" deployed ".*"
  finish
}

# A rules deploy that exits 0 and releases nothing fails the hash check.
scenario_rules_hash_mismatch() {
  start rules-hash-mismatch
  run_deploy rules-hash-mismatch H_RULES_NOOP=1 H_RELEASED_FIRESTORE="$RULES_FIX/firestore.rules" -- --with-rules --skip-checks
  expect_rc 3
  expect_row "rules:firestore" unverified "released ruleset sha256:[0-9a-f]{12} differs from the build copy sha256:[0-9a-f]{12}"
  expect_row "rules:storage" skipped '-'
  expect_out '^Exit code: 3$'
  finish
}

scenario_rules_storage_drift() {
  start rules-storage-drift
  run_deploy rules-storage-drift H_RULES_DRIFT=storage -- --with-rules --skip-checks
  expect_rc 3
  expect_row "rules:firestore" deployed ".*"
  expect_row "rules:storage" unverified "trails-e428e.firebasestorage.app released ruleset sha256:[0-9a-f]{12} differs from the build copy sha256:[0-9a-f]{12}"
  finish
}

# Rules without the grace placeholder never deploy.
scenario_rules_placeholder_missing() {
  start rules-placeholder-missing
  sed -i '/__GRACE_END_MS__/d' "$RULES_FIX/firestore.rules"
  run_deploy rules-placeholder-missing -- --with-rules --skip-checks
  cp "$RULES_SRC/firestore.rules" "$RULES_FIX/firestore.rules"
  expect_rc 3
  expect_row "rules:firestore" failed "firebase/firestore.rules must hold the grace placeholder exactly once"
  expect_row "rules:storage" skipped '-'
  expect_calls 0 '^firebase deploy --only firestore'
  finish
}

# gcloud signed out: the rules step cannot read the released rules, so the run
# stops before any upload.
scenario_rules_gcloud_unauth() {
  start rules-gcloud-unauth
  run_deploy rules-gcloud-unauth HARNESS_GCLOUD_UNAUTH=1 -- --with-rules --skip-checks
  expect_rc 3
  expect_row "rules:firestore" failed 'gcloud is not signed in \(run gcloud auth login\)'
  expect_calls 0 '^cf deploy'
  expect_calls 0 '^firebase deploy'
  finish
}

# The rules helper's own tests.
scenario_rules_release_unit() {
  start rules-release-unit
  RC=0
  OUT="$(cd "$WARG" && node --test --test-reporter=tap scripts/__tests__/rules-release.test.mjs 2>&1)" || RC=$?
  expect_rc 0
  expect_out '^# fail 0$'
  finish
}

# --- Function secrets, deploy configuration and invokers ----------------------------

scenario_fn_secret_missing() {
  start fn-secret-missing
  run_deploy fn-secret-missing H_FN_SECRETS_MISSING=DASHBOARD_API_KEY -- --with-functions --skip-checks
  expect_rc 3
  expect_row "function:dashboard-api" failed 'missing secret\(s\): DASHBOARD_API_KEY'
  expect_row "function:archive-gateway" skipped '-'
  expect_out 'gcloud secrets create'
  expect_calls 1 '^gcloud secrets versions describe latest --secret DASHBOARD_API_KEY '
  expect_calls 1 '^gcloud secrets versions describe latest --secret PUBLIC_API_KEY '
  expect_calls 0 '^firebase deploy'
  expect_calls 0 '^cf deploy'
  finish
}

scenario_fn_secret_disabled() {
  start fn-secret-disabled
  run_deploy fn-secret-disabled H_FN_SECRETS_DISABLED=PUBLIC_API_KEY -- --with-functions --skip-checks
  expect_rc 3
  expect_row "function:user-triggers" failed 'missing secret\(s\): PUBLIC_API_KEY'
  expect_out '^--- backfill-archiver is missing secret\(s\): PUBLIC_API_KEY$'
  expect_calls 0 '^firebase deploy'
  finish
}

scenario_fn_param_missing() {
  start fn-param-missing
  sed -i '/^DASHBOARD_USER_ID=/d' "$FIX/cloud-functions/dashboard-api/.env"
  LABEL="$SHA-dirty"
  run_deploy fn-param-missing -- --with-functions --skip-checks --allow-dirty
  git -C "$FIX" checkout -q -- cloud-functions/dashboard-api/.env
  expect_rc 3
  expect_row "function:dashboard-api" failed 'cloud-functions/dashboard-api/.env must set DASHBOARD_USER_ID \(deploy configuration\)'
  expect_calls 0 '^firebase deploy'
  LABEL="$SHA"
  finish
}

scenario_fn_public_invoker() {
  start fn-public-invoker
  run_deploy fn-public-invoker H_PUBLIC_INVOKER=onuserarticlesave:allUsers -- --with-functions --skip-checks
  expect_rc 3
  expect_row "function:archive-gateway" deployed "archiveGateway@.*"
  expect_row "function:user-triggers" failed 'public invoker on onUserArticleSave: roles/run.invoker allUsers'
  expect_row "function:backfill-archiver" skipped '-'
  run_deploy fn-public-invoker-auth H_PUBLIC_INVOKER=backfillarchiver:allAuthenticatedUsers -- --with-functions --skip-checks
  expect_rc 3
  expect_row "function:user-triggers" deployed "onUserArticleSave@.* invoker private"
  expect_row "function:backfill-archiver" failed 'public invoker on backfillArchiver: roles/run.invoker allAuthenticatedUsers'
  expect_row "function:dashboard-api" skipped '-'
  NAME="fn-public-invoker"
  finish
}

# No package.json script deploys a worker, a function or the dashboard except
# through deploy.sh, and no script carries --allow-missing-secrets. Reads the
# real workspace manifests. pages/dashboard-v2 is not deployed by deploy.sh,
# so its own deploy script is its only path and stays exempt.
STATIC_CHECK='
const fs = require("fs");
const path = require("path");
const root = process.argv[1];
const exempt = new Set([path.join("pages", "dashboard-v2", "package.json")]);
const files = [path.join(root, "package.json")];
for (const dir of ["workers", "cloud-functions", "pages"]) {
  for (const w of fs.readdirSync(path.join(root, dir))) {
    const f = path.join(root, dir, w, "package.json");
    if (fs.existsSync(f) && !exempt.has(path.relative(root, f))) files.push(f);
  }
}
const bad = [/wrangler\s+deploy/, /\bcf\s+deploy/, /\bfirebase\s+deploy/, /\bpages\s+deploy/, /--allow-missing-secrets/, /\bpnpm\b[^&|;]*\sdeploy(\s|$)/];
let n = 0;
for (const f of files) {
  const scripts = JSON.parse(fs.readFileSync(f, "utf8")).scripts || {};
  for (const [k, v] of Object.entries(scripts)) {
    if (bad.some((r) => r.test(v))) {
      console.log("offending script " + path.relative(root, f) + " " + k + ": " + v);
      n++;
    }
  }
}
console.log("checked " + files.length + " manifests, " + n + " offending");
'

scenario_static_scripts() {
  start static-scripts
  RC=0
  OUT="$(node -e "$STATIC_CHECK" "$WARG" 2>&1)" || RC=$?
  expect_rc 0
  expect_out '^checked 1[0-9] manifests, 0 offending$'
  finish
}

# The worker list in deploy.sh names exactly the workers that have a
# cloudflare.config.ts, so a new worker cannot be left out of the deploy.
scenario_worker_list_sync() {
  start worker-list-sync
  local listed on_disk d
  listed="$(printf '%s\n' "${WORKERS[@]}" | sort | tr '\n' ' ')"
  on_disk="$(for d in "$WARG"/workers/*/; do if [ -f "$d/cloudflare.config.ts" ]; then basename "$d"; fi; done | sort | tr '\n' ' ')"
  [ "$listed" = "$on_disk" ] || fail "deploy.sh WORKERS ($listed) differ from workers with a cloudflare.config.ts ($on_disk)"
  finish
}

# The required-secrets list in the deploy.sh header matches
# required_secrets_for(), the list the preflight reads.
scenario_secrets_doc_sync() {
  start secrets-doc-sync
  local doc w want got
  doc="$(sed -n '/^# Required secrets per worker/,/^# A failed listing/p' "$DEPLOY_SH")"
  for w in "${WORKERS[@]}"; do
    want="$(required_secrets_for "$w" | tr ' ' '\n' | sed '/^$/d' | sort | tr '\n' ' ')"
    got="$(printf '%s\n' "$doc" | sed -n "s/^#   $w: *//p" | tr ',' '\n' | tr -d ' ' | sed '/^$/d' | sort | tr '\n' ' ')"
    [ "$want" = "$got" ] || fail "header lists '$got' for $w, required_secrets_for() has '$want'"
  done
  finish
}

# function_names_for() names exactly the functions each codebase exports from
# src/index.ts, so a new or renamed export cannot deploy unverified.
scenario_function_exports_sync() {
  start function-exports-sync
  local fn src want got
  for fn in "${FUNCTIONS[@]}"; do
    src="$WARG/cloud-functions/$fn/src/index.ts"
    if [ ! -f "$src" ]; then
      fail "$src is missing"
      continue
    fi
    want="$(function_names_for "$fn" | tr ' ' '\n' | sed '/^$/d' | sort | tr '\n' ' ')"
    got="$(node -e '
      const s = require("fs").readFileSync(process.argv[1], "utf8");
      const names = new Set();
      for (const m of s.matchAll(/^export\s+(?:const|let|var|function|async\s+function)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
      for (const m of s.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const part of m[1].split(",")) {
          const name = part.trim().split(/\s+as\s+/).pop().trim();
          if (name && !name.startsWith("type ")) names.add(name);
        }
      }
      if (/^export\s+\*/m.test(s)) { console.error("export * cannot be checked"); process.exit(1); }
      console.log([...names].sort().join(" "));
    ' "$src" 2>&1 | tr ' ' '\n' | sed '/^$/d' | sort | tr '\n' ' ')"
    [ "$want" = "$got" ] || fail "$fn exports '$got', function_names_for() has '$want'"
  done
  finish
}

# private_functions_for() names only exported functions, and every other
# exported function is an HTTP function (export const <name> = onRequest(), so
# no trigger or scheduled function escapes the invoker check.
scenario_invoker_table_sync() {
  start invoker-table-sync
  local fn name
  for fn in "${FUNCTIONS[@]}"; do
    for name in $(private_functions_for "$fn"); do
      case " $(function_names_for "$fn") " in
        *" $name "*) ;;
        *) fail "$fn: private_functions_for() names $name, which function_names_for() does not" ;;
      esac
    done
    for name in $(function_names_for "$fn"); do
      case " $(private_functions_for "$fn") " in
        *" $name "*) continue ;;
      esac
      grep -Eq "^export const $name = onRequest\(" "$WARG/cloud-functions/$fn/src/"*.ts ||
        fail "$fn: $name is not in private_functions_for() and is not defined with onRequest("
    done
  done
  finish
}

# No function folder's firebase.json carries rules, so rules deploy only
# through the rules step.
scenario_function_configs_no_rules() {
  start function-configs-no-rules
  RC=0
  OUT="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(process.argv[1], "cloud-functions");
    let n = 0;
    for (const fn of fs.readdirSync(dir)) {
      const f = path.join(dir, fn, "firebase.json");
      if (!fs.existsSync(f)) continue;
      const config = JSON.parse(fs.readFileSync(f, "utf8"));
      for (const key of ["firestore", "storage"]) {
        if (key in config) { console.log(fn + "/firebase.json has a " + key + " key"); n++; }
      }
    }
    process.exit(n ? 1 : 0);
  ' "$WARG" 2>&1)" || RC=$?
  expect_rc 0
  finish
}

# --functions-only deploys the four functions and nothing else: no worker
# target, no worker secret preflight, no dashboard.
scenario_functions_only() {
  start functions-only
  run_deploy functions-only -- --functions-only
  expect_rc 0
  local fn
  for fn in "${FUNCTIONS[@]}"; do
    expect_row "function:$fn" deployed ".*@20[0-9-]+T.*"
  done
  expect_no_out '^worker:'
  expect_no_out '^pages:dashboard '
  expect_out '^=== Secret preflight skipped \(--functions-only\) ===$'
  expect_calls 0 '^cf deploy'
  expect_calls 0 '^cf workers secrets list'
  expect_calls 0 '^wrangler '
  expect_calls 4 '^firebase deploy --only functions:'
  expect_out '^Exit code: 0$'
  finish
}

scenario_functions_only_usage() {
  start functions-only-usage
  run_deploy functions-only-all -- --functions-only --all
  expect_rc 2
  expect_out 'cannot be combined with'
  expect_calls 0 '^firebase '
  run_deploy functions-only-pages -- --functions-only --with-pages
  expect_rc 2
  expect_out 'cannot be combined with --with-pages'
  expect_calls 0 '^firebase '
  run_deploy functions-only-allow-missing -- --functions-only --allow-missing-secrets gcs
  expect_rc 2
  expect_out 'cannot be combined with --allow-missing-secrets'
  NAME=functions-only-usage
  finish
}

# --rules-only deploys the Firestore and Storage rules and nothing else: no
# worker, no function, no secret preflight; the released-hash check still runs.
scenario_rules_only() {
  start rules-only
  run_deploy rules-only -- --rules-only --skip-checks
  expect_rc 0
  expect_row "rules:firestore" deployed "firestore-[0-9]+ sha256:[0-9a-f]{12} grace 20.*"
  expect_row "rules:storage" deployed ".*"
  expect_no_out '^worker:'
  expect_no_out '^function:'
  expect_no_out '^pages:dashboard '
  expect_out '^=== Secret preflight skipped \(--rules-only\) ===$'
  expect_calls 0 '^cf deploy'
  expect_calls 0 '^cf workers secrets list'
  expect_calls 0 '^firebase deploy --only functions:'
  expect_calls 1 '^firebase deploy --only firestore:rules,storage --project trails-e428e --non-interactive --config firebase.json'
  expect_out '^Exit code: 0$'
  finish
}

scenario_rules_only_usage() {
  start rules-only-usage
  run_deploy rules-only-all -- --rules-only --all
  expect_rc 2
  expect_out 'cannot be combined with --all'
  expect_calls 0 '^firebase '
  run_deploy rules-only-functions -- --rules-only --with-functions
  expect_rc 2
  expect_out 'cannot be combined with --with-functions'
  expect_calls 0 '^firebase '
  run_deploy rules-only-functions-only -- --rules-only --functions-only
  expect_rc 2
  expect_out 'cannot be combined with --functions-only'
  NAME=rules-only-usage
  finish
}

# A function .env that does not state the dual-accept switch stops the run
# before any function deploys.
scenario_dual_accept_unset() {
  start dual-accept-unset
  local env_file="$FIX/cloud-functions/dashboard-api/.env"
  sed -i '/^KEY_ROTATION_DUAL_ACCEPT=/d' "$env_file"
  run_deploy dual-accept-unset -- --functions-only --skip-checks --allow-dirty
  git -C "$FIX" checkout -q -- cloud-functions/dashboard-api/.env
  expect_rc 3
  expect_out 'cloud-functions/dashboard-api/.env must set KEY_ROTATION_DUAL_ACCEPT=true or =false'
  expect_calls 0 '^firebase deploy'
  expect_out '^Exit code: 3$'
  finish
}

# A function .env that assigns a Secret Manager name stops the run before any
# function deploys.
scenario_secret_in_env() {
  start secret-in-env
  echo "DASHBOARD_API_KEY=x" >>"$FIX/cloud-functions/dashboard-api/.env"
  run_deploy secret-in-env -- --functions-only --skip-checks --allow-dirty
  git -C "$FIX" checkout -q -- cloud-functions/dashboard-api/.env
  expect_rc 3
  expect_out 'cloud-functions/dashboard-api/.env assigns DASHBOARD_API_KEY, which is a Secret Manager secret; remove the line'
  expect_calls 0 '^firebase deploy'
  expect_out '^Exit code: 3$'
  finish
}

ALL=(full-success secrets-list-fails secret-missing secret-missing-last-worker allow-missing-secrets
  quick-still-preflights same-version-ids foreign-version-id no-printed-id-tag-match no-printed-id-foreign
  dirty-refused dirty-allowed all-without-rules fn-old-updatetime fn-new-updatetime fn-deploy-fails
  pages-hash-mismatch pages-unauth functions-unauth induced-failure-rc precheck-fails unknown-flag static-scripts
  worker-list-sync secrets-doc-sync function-exports-sync
  functions-only functions-only-usage rules-only rules-only-usage dual-accept-unset secret-in-env
  rules-first-stamp rules-reused-stamp rules-released-zero rules-hash-mismatch rules-storage-drift
  rules-placeholder-missing rules-gcloud-unauth rules-release-unit
  fn-secret-missing fn-secret-disabled fn-param-missing fn-public-invoker
  invoker-table-sync function-configs-no-rules
  link-check-plans-change link-check-not-production-dry-run link-check-missing-report link-check-skipped
  link-check-rules-only)
if [ $# -gt 0 ]; then
  SELECTED=("$@")
else
  SELECTED=("${ALL[@]}")
fi
for s in "${SELECTED[@]}"; do
  "scenario_${s//-/_}"
done

echo
echo "deploy harness: $PASSED passed, $FAILED failed"
if [ "$FAILED" -gt 0 ]; then
  echo "failed: ${FAILED_NAMES[*]}"
  exit 1
fi
