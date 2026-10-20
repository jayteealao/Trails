#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Warg Deploy Script — the only supported deploy path for Warg.
#
# Deploys the nine Cloudflare Workers (cf deploy), the Cloud Functions
# (firebase deploy) and the Pages dashboard (wrangler pages deploy) in
# dependency order, and marks a target deployed only after the live platform
# shows the change.
#
# Usage (from warg/):
#   pnpm run deploy -- [flags]       # or: bash scripts/deploy.sh [flags]
#   pnpm deploy:all                  # same as: pnpm run deploy -- --all
#   pnpm deploy:pages                # same as: pnpm run deploy -- --with-pages
#   pnpm deploy:quick                # same as: pnpm run deploy -- --skip-checks
#   Note: plain `pnpm deploy` is pnpm's own built-in command, not this script.
#
# Flags:
#   --with-pages                      also deploy the Pages dashboard
#   --with-functions                  also deploy the four Cloud Functions
#   --all                             workers + functions + dashboard
#   --skip-checks                     skip typecheck and tests (the secret
#                                     preflight still runs)
#   --allow-missing-secrets <worker>  skip the secret preflight for that one
#                                     worker (first deploy of a new worker);
#                                     repeatable; printed as a warning in the
#                                     summary. Never put it in a package.json
#                                     script.
#   --allow-dirty                     deploy from a tree with uncommitted or
#                                     untracked files; every label then ends
#                                     in -dirty
#
# Required secrets per worker (checked with `cf workers secrets list` for all
# nine workers before the first worker deploys). required_secrets_for() below
# is the list the preflight reads; the deploy harness fails when this copy
# differs from it:
#   logger:        INTERNAL_API_KEY
#   gateway:       INTERNAL_API_KEY, PUBLIC_API_KEY
#   workflow:      INTERNAL_API_KEY
#   renderer:      INTERNAL_API_KEY, CF_ACCOUNT_ID, BR_API_TOKEN
#   hyperrenderer: INTERNAL_API_KEY, HYPERBROWSER_API_KEY
#   singlefile:    INTERNAL_API_KEY
#   readability:   INTERNAL_API_KEY
#   monolith:      INTERNAL_API_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
#   gcs:           INTERNAL_API_KEY, CLOUD_FN_BASE_URL
# A failed listing (not signed in, token expired, worker not deployed yet)
# or a missing secret stops the run before any worker is deployed; it is
# never a warning.
#
# Cloud Functions need a .env file with runtime secrets in each
# cloud-functions/<fn>/ folder (copy .env.example).
#
# Labels: the label is the commit SHA (`git rev-parse HEAD`), plus -dirty
# with --allow-dirty. Workers get `--tag <12-char sha>[-dirty]` and
# `--message <label>`; functions bake GIT_SHA=<label> into the bundle; the
# dashboard gets `--commit-hash <label>`.
#
# Verification per target:
#   worker     `cf workers deployments list` must show a new deployment whose
#              version id was not listed before the deploy and is the id this
#              run's `cf deploy` printed (or, when it printed none, a version
#              tagged with this run's tag). Polled every 5 s for up to 60 s.
#   function   `firebase deploy --only functions:<codebase>` (the firebase.json
#              predeploy builds the bundle), then `gcloud functions describe`
#              must show, for every function of the codebase, an updateTime
#              later than the deploy start and state ACTIVE.
#   dashboard  `cf pages deployments list` must show the label as the
#              commit_hash of the newest production deployment. Polled like a
#              worker.
#
# Summary: an EXIT trap prints one line per planned target on every exit,
#   TARGET  RESULT (deployed|failed|unverified|skipped)  DETAIL  LABEL
# where DETAIL is the version id, the update times or the reason; then the
# warnings and the exit code. The first failure stops the run; targets not
# reached read "skipped".
#
# Exit codes: the failing command's own code; 2 for a usage error or a
# refused dirty tree; 3 when a target ran but failed verification or a
# secret is missing; 130 / 143 on SIGINT / SIGTERM.
#
# Needs: cf signed in (`cf auth login`), node, git; for --with-functions
# gcloud signed in (`gcloud auth login`) and firebase-tools; for --with-pages
# wrangler; Docker running for the monolith container. cf, wrangler and
# firebase-tools resolve from warg/node_modules/.bin (the workspace pins).
# ============================================================================

WARG_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WARG_ROOT"

# DEPLOY_TOOL_PATH is the test seam of scripts/deploy-harness: stub tools
# replace the workspace binaries.
if [ -n "${DEPLOY_TOOL_PATH:-}" ]; then
  PATH="$DEPLOY_TOOL_PATH:$PATH"
else
  PATH="$WARG_ROOT/node_modules/.bin:$PATH"
fi
export PATH

WORKERS=(logger renderer hyperrenderer singlefile readability monolith gcs workflow gateway)
CLOUD_FUNCTIONS=(archive-gateway user-triggers backfill-archiver dashboard-api)
FIREBASE_PROJECT=trails-e428e
FUNCTION_REGION=us-central1
PAGES_PROJECT=warg-dashboard
POLL_INTERVAL="${DEPLOY_POLL_INTERVAL:-5}"
POLL_TIMEOUT="${DEPLOY_POLL_TIMEOUT:-60}"

WITH_PAGES=false
WITH_FUNCTIONS=false
SKIP_CHECKS=false
ALLOW_DIRTY=false
DIRTY=false
ALLOW_MISSING=()
LABEL="-"
TAG="-"

# --- Target registry and EXIT summary ---------------------------------------
TARGETS=()
RESULT=()
DETAIL=()
WARNINGS=()
FIRST_RC=""
WORK_DIR=""

register_target() {
  TARGETS+=("$1")
  RESULT+=("skipped")
  DETAIL+=("-")
}

set_result() {
  local i
  for i in "${!TARGETS[@]}"; do
    if [ "${TARGETS[$i]}" = "$1" ]; then
      RESULT[i]="$2"
      DETAIL[i]="$3"
      return 0
    fi
  done
}

# fail_target <target> <failed|unverified> <rc> <detail>: records the first
# failure and stops the run; the EXIT trap prints the summary.
fail_target() {
  set_result "$1" "$2" "$4"
  [ -n "$FIRST_RC" ] || FIRST_RC="$3"
  echo "ERROR: $1 $2: $4" >&2
  exit "$3"
}

on_exit() {
  local rc=$?
  trap - EXIT
  set +e
  [ -n "$FIRST_RC" ] || FIRST_RC="$rc"
  local i
  for i in "${!TARGETS[@]}"; do
    # A target still running at exit was stopped by an unexpected failing
    # command (set -e) or a signal.
    if [ "${RESULT[$i]}" = "running" ]; then
      RESULT[i]="failed"
      DETAIL[i]="exited with code $FIRST_RC"
    fi
  done
  echo
  echo "=== Deploy summary ==="
  printf '%-26s %-11s %-60s %s\n' TARGET RESULT DETAIL LABEL
  for i in "${!TARGETS[@]}"; do
    printf '%-26s %-11s %-60s %s\n' "${TARGETS[$i]}" "${RESULT[$i]}" "${DETAIL[$i]}" "$LABEL"
  done
  for i in "${!WARNINGS[@]}"; do
    echo "WARNING: ${WARNINGS[$i]}"
  done
  echo "Exit code: $FIRST_RC"
  [ -z "$WORK_DIR" ] || rm -rf "$WORK_DIR"
  exit "$FIRST_RC"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

usage_error() {
  echo "ERROR: $1" >&2
  echo "Usage: bash scripts/deploy.sh [--with-pages] [--with-functions] [--all] [--skip-checks] [--allow-dirty] [--allow-missing-secrets <worker>]..." >&2
  FIRST_RC=2
  exit 2
}

is_worker() {
  local w
  for w in "${WORKERS[@]}"; do
    [ "$w" = "$1" ] && return 0
  done
  return 1
}

allows_missing() {
  local w
  for w in "${ALLOW_MISSING[@]+"${ALLOW_MISSING[@]}"}"; do
    [ "$w" = "$1" ] && return 0
  done
  return 1
}

# --- Flags -------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --with-pages) WITH_PAGES=true ;;
    --with-functions) WITH_FUNCTIONS=true ;;
    --all) WITH_PAGES=true; WITH_FUNCTIONS=true ;;
    --skip-checks) SKIP_CHECKS=true ;;
    --allow-dirty) ALLOW_DIRTY=true ;;
    --allow-missing-secrets)
      [ $# -ge 2 ] || usage_error "--allow-missing-secrets needs a worker name"
      is_worker "$2" || usage_error "--allow-missing-secrets: unknown worker '$2' (one of: ${WORKERS[*]})"
      ALLOW_MISSING+=("$2")
      shift
      ;;
    --) ;; # pnpm's -- separator
    *) usage_error "unknown flag: $1" ;;
  esac
  shift
done

require_tool() {
  command -v "$1" >/dev/null 2>&1 || usage_error "$1 is not installed or not on PATH"
}
require_tool cf
require_tool node
require_tool git
if [ "$WITH_FUNCTIONS" = true ]; then
  require_tool firebase
  require_tool gcloud
fi
if [ "$WITH_PAGES" = true ]; then
  require_tool wrangler
fi

# --- Commit label and dirty tree ---------------------------------------------
SHA="$(git rev-parse HEAD)"
DIRTY_PATHS="$(git status --porcelain)"
if [ -n "$DIRTY_PATHS" ]; then
  if [ "$ALLOW_DIRTY" = false ]; then
    echo "ERROR: the working tree has uncommitted or untracked files; commit them or pass --allow-dirty:" >&2
    printf '%s\n' "$DIRTY_PATHS" >&2
    FIRST_RC=2
    exit 2
  fi
  DIRTY=true
  LABEL="$SHA-dirty"
  TAG="${SHA:0:12}-dirty"
else
  LABEL="$SHA"
  TAG="${SHA:0:12}"
fi
# The function bundle build (firebase.json predeploy) bakes this label verbatim.
export GIT_SHA="$LABEL"
echo "Deploying label: $LABEL"
echo

for w in "${WORKERS[@]}"; do
  register_target "worker:$w"
done
if [ "$WITH_FUNCTIONS" = true ]; then
  for fn in "${CLOUD_FUNCTIONS[@]}"; do
    register_target "function:$fn"
  done
fi
if [ "$WITH_PAGES" = true ]; then
  register_target "pages:dashboard"
fi

WORK_DIR="$(mktemp -d)"

# json_eval <js expression over d>: parses stdin as JSON and prints the result
# (an array prints one item per line). Exits 65 on input that is not JSON.
json_eval() {
  node -e '
    let s = "";
    process.stdin.on("data", (c) => (s += c)).on("end", () => {
      let d;
      try { d = JSON.parse(s); } catch {
        process.stderr.write("not JSON: " + s.slice(0, 300) + "\n");
        process.exit(65);
      }
      const r = new Function("d", "return (" + process.argv[1] + ");")(d);
      if (Array.isArray(r)) { if (r.length) console.log(r.join("\n")); }
      else if (r !== undefined && r !== null) console.log(String(r));
    });' "$1"
}

now_iso() {
  node -e 'console.log(new Date().toISOString())'
}

# time_after <a> <b>: true when timestamp a is strictly later than b.
time_after() {
  node -e 'process.exit(Date.parse(process.argv[1]) > Date.parse(process.argv[2]) ? 0 : 1)' "$1" "$2"
}

# --- Secret preflight (always on, fail closed) --------------------------------
required_secrets_for() {
  case "$1" in
    logger)        echo "INTERNAL_API_KEY" ;;
    gateway)       echo "INTERNAL_API_KEY PUBLIC_API_KEY" ;;
    workflow)      echo "INTERNAL_API_KEY" ;;
    renderer)      echo "INTERNAL_API_KEY CF_ACCOUNT_ID BR_API_TOKEN" ;;
    hyperrenderer) echo "INTERNAL_API_KEY HYPERBROWSER_API_KEY" ;;
    singlefile)    echo "INTERNAL_API_KEY" ;;
    readability)   echo "INTERNAL_API_KEY" ;;
    monolith)      echo "INTERNAL_API_KEY R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY" ;;
    gcs)           echo "INTERNAL_API_KEY CLOUD_FN_BASE_URL" ;;
    *)             echo "" ;;
  esac
}

# A worker whose secret is missing deploys fine and then fails at runtime with
# an opaque 500. A listing that fails hides an auth failure, so it stops too.
preflight_secrets() {
  local worker="$1" target="worker:$1"
  if allows_missing "$worker"; then
    WARNINGS+=("preflight skipped for $worker (--allow-missing-secrets)")
    echo "--- WARN: secret preflight skipped for $worker (--allow-missing-secrets)"
    return 0
  fi
  local listing rc=0
  listing="$(cf workers secrets list --worker "$worker" 2>"$WORK_DIR/err")" || rc=$?
  if [ "$rc" -ne 0 ]; then
    cat "$WORK_DIR/err" >&2
    fail_target "$target" failed "$rc" "secret listing failed (exit $rc)"
  fi
  local names
  names="$(printf '%s' "$listing" | json_eval 'd.map((s) => s.name)' 2>"$WORK_DIR/err")" || {
    cat "$WORK_DIR/err" >&2
    fail_target "$target" failed 3 "secret listing is not the expected JSON"
  }
  local secret missing=""
  for secret in $(required_secrets_for "$worker"); do
    if ! printf '%s\n' "$names" | grep -qx "$secret"; then
      missing="$missing $secret"
    fi
  done
  if [ -n "$missing" ]; then
    echo "Set each with: pnpm exec wrangler secret put <NAME> --config workers/$worker/wrangler.jsonc" >&2
    fail_target "$target" failed 3 "missing secret(s):$missing"
  fi
}

# --- Workers -----------------------------------------------------------------
deployed_version_ids() {
  json_eval 'd.deployments.flatMap((x) => x.versions.map((v) => v.version_id))'
}

newest_version_ids() {
  json_eval '(d.deployments[0] ? d.deployments[0].versions : []).map((v) => v.version_id)'
}

deploy_worker() {
  local w="$1" target="worker:$1" rc=0 listing
  set_result "$target" running "-"
  echo "--- Worker $w"

  local before=""
  listing="$(cf workers deployments list --worker "$w" 2>"$WORK_DIR/err")" || rc=$?
  if [ "$rc" -ne 0 ]; then
    if ! allows_missing "$w"; then
      cat "$WORK_DIR/err" >&2
      fail_target "$target" failed "$rc" "deployment listing failed (exit $rc)"
    fi
    echo "--- $w has no deployment list yet (first deploy)"
    rc=0
  else
    before="$(printf '%s' "$listing" | deployed_version_ids 2>"$WORK_DIR/err")" || {
      cat "$WORK_DIR/err" >&2
      fail_target "$target" failed 3 "deployment listing is not the expected JSON"
    }
  fi

  local log="$WORK_DIR/deploy-$w.log"
  (cd "workers/$w" && cf deploy --tag "$TAG" --message "$LABEL" --provision=false) 2>&1 | tee "$log" || rc=$?
  if [ "$rc" -ne 0 ]; then
    fail_target "$target" failed "$rc" "cf deploy exited $rc"
  fi
  local printed
  printed="$(grep -i 'version' "$log" | grep -oiE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -n 1 || true)"

  local deadline=$((SECONDS + POLL_TIMEOUT)) reason="no new version id" id ids tag
  while :; do
    listing="$(cf workers deployments list --worker "$w" 2>/dev/null)" || listing=""
    ids="$(printf '%s' "$listing" | newest_version_ids 2>/dev/null || true)"
    for id in $ids; do
      if printf '%s\n' "$before" | grep -qx "$id"; then
        continue
      fi
      if [ -n "$printed" ]; then
        if [ "$id" = "$printed" ]; then
          set_result "$target" deployed "$id"
          echo "--- $w deployed: version $id"
          return 0
        fi
      else
        tag="$(cf workers versions get "$id" --worker-id "$w" 2>/dev/null | json_eval 'd.annotations && d.annotations["workers/tag"]' 2>/dev/null || true)"
        if [ "$tag" = "$TAG" ]; then
          set_result "$target" deployed "$id"
          echo "--- $w deployed: version $id (matched by tag)"
          return 0
        fi
      fi
      reason="new id $id not produced by this run"
    done
    [ "$SECONDS" -lt "$deadline" ] || break
    sleep "$POLL_INTERVAL"
  done
  fail_target "$target" unverified 3 "$reason"
}

# --- Cloud Functions ---------------------------------------------------------
# The functions each codebase exports, which verification reads one by one.
# The deploy harness fails when this table differs from the exports of
# cloud-functions/<codebase>/src/index.ts, so a new export cannot go unchecked.
function_names_for() {
  case "$1" in
    archive-gateway)   echo "archiveGateway" ;;
    user-triggers)     echo "onUserArticleSave" ;;
    backfill-archiver) echo "backfillArchiver backfillStatus articleStatusDerive" ;;
    dashboard-api)     echo "dashboardApi" ;;
    *)                 echo "" ;;
  esac
}

deploy_cloud_fn() {
  local fn="$1" target="function:$1" rc=0 start
  set_result "$target" running "-"
  echo "--- Cloud function codebase $fn"
  start="$(now_iso)"
  (cd "cloud-functions/$fn" && GIT_SHA="$LABEL" firebase deploy --only "functions:$fn" --project "$FIREBASE_PROJECT") || rc=$?
  if [ "$rc" -ne 0 ]; then
    fail_target "$target" failed "$rc" "firebase deploy exited $rc"
  fi
  local name out update state detail=""
  for name in $(function_names_for "$fn"); do
    rc=0
    out="$(gcloud functions describe "$name" --region "$FUNCTION_REGION" --project "$FIREBASE_PROJECT" --format="value(updateTime,state)" 2>"$WORK_DIR/err")" || rc=$?
    if [ "$rc" -ne 0 ]; then
      cat "$WORK_DIR/err" >&2
      fail_target "$target" failed "$rc" "gcloud functions describe $name exited $rc"
    fi
    update="$(printf '%s\n' "$out" | awk -F'\t' 'NR == 1 { print $1 }')"
    state="$(printf '%s\n' "$out" | awk -F'\t' 'NR == 1 { print $2 }')"
    if [ "$state" != "ACTIVE" ] || ! time_after "$update" "$start"; then
      fail_target "$target" unverified 3 "$name updateTime ${update:-none} state ${state:-none}, deploy start $start"
    fi
    detail="$detail $name@$update"
  done
  set_result "$target" deployed "${detail# }"
  echo "--- $fn deployed:$detail"
}

# --- Pages dashboard ---------------------------------------------------------
deploy_pages() {
  local target="pages:dashboard" rc=0
  set_result "$target" running "-"
  echo "--- Pages dashboard"
  (cd pages/dashboard && wrangler pages deploy --branch main --commit-hash "$LABEL" --commit-message "$LABEL" --commit-dirty="$DIRTY") || rc=$?
  if [ "$rc" -ne 0 ]; then
    fail_target "$target" failed "$rc" "wrangler pages deploy exited $rc"
  fi
  local deadline=$((SECONDS + POLL_TIMEOUT)) listing newest="" newest_id=""
  while :; do
    listing="$(cf pages deployments list --project-name "$PAGES_PROJECT" --env production 2>/dev/null)" || listing=""
    newest="$(printf '%s' "$listing" | json_eval 'd[0] && d[0].deployment_trigger.metadata.commit_hash' 2>/dev/null || true)"
    if [ "$newest" = "$LABEL" ]; then
      newest_id="$(printf '%s' "$listing" | json_eval 'd[0].id' 2>/dev/null || true)"
      set_result "$target" deployed "${newest_id:-deployment}"
      echo "--- dashboard deployed: ${newest_id:-deployment}"
      return 0
    fi
    [ "$SECONDS" -lt "$deadline" ] || break
    sleep "$POLL_INTERVAL"
  done
  fail_target "$target" unverified 3 "newest commit_hash is ${newest:-none}, expected $LABEL"
}

# --- Pre-checks --------------------------------------------------------------
if [ "$SKIP_CHECKS" = false ]; then
  echo "=== Running pre-checks ==="
  pnpm -r typecheck
  pnpm -r test
  echo "=== Pre-checks passed ==="
else
  echo "=== Skipping typecheck and tests (--skip-checks); the secret preflight still runs ==="
fi
echo

if [ "$WITH_FUNCTIONS" = true ]; then
  for fn in "${CLOUD_FUNCTIONS[@]}"; do
    if [ ! -f "cloud-functions/$fn/.env" ]; then
      fail_target "function:$fn" failed 1 "cloud-functions/$fn/.env is missing (copy .env.example and fill in secrets)"
    fi
  done
fi

# --- Secret preflight for every worker, before any deploy ---------------------
# All nine are checked first, so a missing secret on a later worker (gateway is
# last) stops the run before any worker is live and the fleet never ends up on
# mixed versions.
echo "=== Secret preflight (every worker) ==="
for w in "${WORKERS[@]}"; do
  preflight_secrets "$w"
done
echo "=== Secret preflight passed ==="
echo

# --- Deploy in dependency order ----------------------------------------------
# Tier 1: logger renderer hyperrenderer singlefile readability monolith gcs;
# tier 2: workflow (binds tier 1); tier 3: gateway (binds logger and workflow).
for w in "${WORKERS[@]}"; do
  deploy_worker "$w"
done

if [ "$WITH_FUNCTIONS" = true ]; then
  for fn in "${CLOUD_FUNCTIONS[@]}"; do
    deploy_cloud_fn "$fn"
  done
fi

if [ "$WITH_PAGES" = true ]; then
  deploy_pages
fi
