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
eval "$(sed -n '/^required_secrets_for() {$/,/^}$/p; /^function_names_for() {$/,/^}$/p' "$DEPLOY_SH")"
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
for w in "${WORKERS[@]}"; do
  mkdir -p "$FIX/workers/$w"
  echo "{}" >"$FIX/workers/$w/package.json"
done
for fn in "${FUNCTIONS[@]}"; do
  mkdir -p "$FIX/cloud-functions/$fn"
  echo "PLACEHOLDER=1" >"$FIX/cloud-functions/$fn/.env"
done
echo 'name = "warg-dashboard"' >"$FIX/pages/dashboard/wrangler.toml"
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
  run_deploy full-success -- --all
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
    expect_calls 1 "^firebase deploy --only functions:$fn --project trails-e428e GIT_SHA=$SHA\$"
  done
  expect_calls 6 '^gcloud functions describe .* --region us-central1 --project trails-e428e'
  expect_calls 1 "^wrangler pages deploy --branch main --commit-hash $SHA --commit-message $SHA --commit-dirty=false\$"
  expect_row "pages:dashboard" deployed "$UUID"
  expect_out '^TARGET +RESULT +DETAIL +LABEL$'
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
  run_deploy dirty-allowed -- --all --allow-dirty --skip-checks
  rm -f "$FIX/untracked.txt"
  expect_rc 0
  expect_out "^Deploying label: $SHA-dirty\$"
  expect_calls 9 '^cf deploy '
  expect_calls 9 "^cf deploy --tag $SHORT-dirty --message $SHA-dirty --provision=false\$"
  expect_calls 4 '^firebase deploy '
  expect_calls 4 "^firebase deploy .* GIT_SHA=$SHA-dirty\$"
  expect_calls 1 "^wrangler pages deploy --branch main --commit-hash $SHA-dirty --commit-message $SHA-dirty --commit-dirty=true\$"
  expect_row "pages:dashboard" deployed "$UUID"
  expect_row "worker:gateway" deployed "$UUID"
  LABEL="$SHA"
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
  expect_no_out '^pages:dashboard '
  finish
}

scenario_fn_deploy_fails() {
  start fn-deploy-fails
  run_deploy fn-deploy-fails H_FIREBASE_RC=4 -- --with-functions --skip-checks
  expect_rc 4
  expect_row "function:archive-gateway" failed "firebase deploy exited 4"
  expect_row "function:user-triggers" skipped '-'
  expect_calls 0 '^gcloud '
  finish
}

# The upload goes to the project's production branch, read before any upload.
# With --branch main on a project whose production branch is master, the
# upload would be a preview and the production list would keep the old hash.
scenario_pages_production_branch() {
  start pages-production-branch
  run_deploy pages-production-branch H_PAGES_PROD_BRANCH=master -- --with-pages --skip-checks
  expect_rc 0
  expect_calls 1 '^cf pages get warg-dashboard$'
  expect_calls 1 "^wrangler pages deploy --branch master --commit-hash $SHA "
  expect_calls 0 '^wrangler pages deploy --branch main '
  expect_out '^--- dashboard production branch: master$'
  expect_row "pages:dashboard" deployed "$UUID"
  finish
}

# An unreadable production branch with no PAGES_BRANCH stops the run before
# the first upload. PAGES_BRANCH is the fallback when the read fails.
scenario_pages_branch_unknown() {
  start pages-branch-unknown
  run_deploy pages-branch-unknown H_PAGES_GET_FAIL=1 PAGES_BRANCH= -- --with-pages --skip-checks
  expect_rc 3
  expect_row "pages:dashboard" failed 'cannot read the production branch of warg-dashboard \(cf pages get exited 1\); set PAGES_BRANCH=<branch>'
  local w
  for w in "${WORKERS[@]}"; do
    expect_row "worker:$w" skipped '-'
  done
  expect_calls 0 '^cf deploy'
  expect_calls 0 '^wrangler pages deploy'
  expect_out '^Exit code: 3$'
  run_deploy pages-branch-fallback H_PAGES_GET_FAIL=1 H_PAGES_PROD_BRANCH=master PAGES_BRANCH=master -- --with-pages --skip-checks
  expect_rc 0
  expect_calls 1 "^wrangler pages deploy --branch master --commit-hash $SHA "
  expect_out '^WARNING: dashboard branch from PAGES_BRANCH=master '
  expect_row "pages:dashboard" deployed "$UUID"
  NAME=pages-branch-unknown
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

ALL=(full-success secrets-list-fails secret-missing secret-missing-last-worker allow-missing-secrets
  quick-still-preflights same-version-ids foreign-version-id no-printed-id-tag-match no-printed-id-foreign
  dirty-refused dirty-allowed fn-old-updatetime fn-new-updatetime fn-deploy-fails
  pages-hash-mismatch pages-production-branch pages-branch-unknown pages-unauth functions-unauth induced-failure-rc precheck-fails unknown-flag static-scripts
  worker-list-sync secrets-doc-sync function-exports-sync)
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
