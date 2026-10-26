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
#   --with-rules                      deploy the Firestore and Storage rules
#                                     after the functions; verified by the
#                                     released ruleset hash
#   --all                             workers + functions + rules + dashboard
#   --functions-only                  deploy the four Cloud Functions and
#                                     nothing else (no worker, no dashboard,
#                                     no worker secret preflight); used to
#                                     put the functions first when rotating
#                                     the function keys. Not combinable with
#                                     --with-pages, --all or
#                                     --allow-missing-secrets; combinable
#                                     with --with-rules.
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
#   gcs:           INTERNAL_API_KEY, ARCHIVE_GATEWAY_KEY, CLOUD_FN_BASE_URL
# A failed listing (not signed in, token expired, worker not deployed yet)
# or a missing secret stops the run before any worker is deployed; it is
# never a warning.
#
# Cloud Functions need a .env file in each cloud-functions/<fn>/ folder (copy
# .env.example). It holds plain configuration only: a line that assigns one of
# the Secret Manager names below stops the run with exit 3.
#
# Required secrets per function (Secret Manager). required_function_secrets_for()
# below is the list:
#   archive-gateway:   ARCHIVE_GATEWAY_KEY, GATEWAY_LOG_KEY, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET
#   user-triggers:     PUBLIC_API_KEY, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET
#   backfill-archiver: PUBLIC_API_KEY, BACKFILL_STATUS_KEY, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET
#   dashboard-api:     DASHBOARD_API_KEY
# archive-gateway, backfill-archiver and dashboard-api also need
# INTERNAL_API_KEY (the old shared key) while their .env sets
# KEY_ROTATION_DUAL_ACCEPT=true. Their .env must set KEY_ROTATION_DUAL_ACCEPT
# to true or false, or the run stops with exit 3 (README: rotating the
# function keys). Before any deploy, deploy.sh checks that each listed secret
# has an enabled latest version (`gcloud secrets versions describe latest`)
# and stops with exit 3 naming each missing one, so firebase-tools never
# prompts for it. The deploy configuration DASHBOARD_USER_ID
# (dashboard-api/.env) and BACKFILL_USER_ID (backfill-archiver/.env) must be
# set too; required_function_params_for() below is the list.
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
#   invoker    after a codebase verifies, `gcloud run services
#              get-iam-policy` of each trigger and scheduled function
#              (private_functions_for() below) must hold no allUsers or
#              allAuthenticatedUsers binding, else exit 3. HTTP functions stay
#              public; their per-caller keys guard them.
#   rules      the grace end is read from the released Firestore rules (the
#              stamped `timestamp.value(<ms>); // __GRACE_END_MS__` line) and
#              reused; when the release holds none, this is the first stamped
#              deploy and the end is the deploy start plus 30 days (a summary
#              warning says so). A build copy of firebase/ (LF line endings,
#              the placeholder replaced by the end) is deployed with
#              `firebase deploy --only firestore:rules,storage
#              --non-interactive`; then the SHA-256 of each released ruleset
#              (Firestore and every storage bucket, read through the Firebase
#              Rules API) must equal the build copy, else exit 3.
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
# refused dirty tree; 3 when a target ran but failed verification, a
# secret is missing or a sign-in is missing; 130 / 143 on SIGINT / SIGTERM.
#
# Needs: node, git and one sign-in per target: cf signed in (`cf auth login`)
# for the workers; for --with-functions firebase-tools signed in
# (`firebase login`, FIREBASE_TOKEN or `gcloud auth application-default
# login`) and gcloud signed in (`gcloud auth login`, the function
# verification); for --with-rules firebase-tools signed in, gcloud signed in
# and curl (the Rules API reads); for --with-pages wrangler signed in (`wrangler login` or
# CLOUDFLARE_API_TOKEN; wrangler does not reuse the cf credentials). The
# wrangler and firebase sign-ins are checked before the first upload. Docker
# running for the monolith container. cf, wrangler and firebase-tools resolve
# from warg/node_modules/.bin (the workspace pins).
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
WITH_RULES=false
FUNCTIONS_ONLY=false
SKIP_CHECKS=false
ALLOW_DIRTY=false
DIRTY=false
ALLOW_MISSING=()
ALL_FLAG=false
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
  echo "Usage: bash scripts/deploy.sh [--with-pages] [--with-functions] [--with-rules] [--all] [--functions-only] [--skip-checks] [--allow-dirty] [--allow-missing-secrets <worker>]..." >&2
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
    --with-rules) WITH_RULES=true ;;
    --all) WITH_PAGES=true; WITH_FUNCTIONS=true; WITH_RULES=true; ALL_FLAG=true ;;
    --functions-only) WITH_FUNCTIONS=true; FUNCTIONS_ONLY=true ;;
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
if [ "$FUNCTIONS_ONLY" = true ]; then
  [ "$WITH_PAGES" = false ] || usage_error "--functions-only cannot be combined with --with-pages or --all"
  [ "$ALL_FLAG" = false ] || usage_error "--functions-only cannot be combined with --all"
  [ "${#ALLOW_MISSING[@]}" -eq 0 ] || usage_error "--functions-only cannot be combined with --allow-missing-secrets"
fi

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
if [ "$WITH_RULES" = true ]; then
  require_tool firebase
  require_tool gcloud
  require_tool curl
fi
if [ "$WITH_PAGES" = true ]; then
  require_tool wrangler
fi
# The rules deploy from the repository's firebase/ folder (a build copy of it).
RULES_DIR="$(cd "$WARG_ROOT/.." && pwd)/firebase"
if [ "$WITH_RULES" = true ] && [ ! -f "$RULES_DIR/firebase.json" ]; then
  usage_error "--with-rules: $RULES_DIR/firebase.json is missing"
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

if [ "$FUNCTIONS_ONLY" = false ]; then
  for w in "${WORKERS[@]}"; do
    register_target "worker:$w"
  done
fi
if [ "$WITH_FUNCTIONS" = true ]; then
  for fn in "${CLOUD_FUNCTIONS[@]}"; do
    register_target "function:$fn"
  done
fi
if [ "$WITH_RULES" = true ]; then
  register_target "rules:firestore"
  register_target "rules:storage"
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
    gcs)           echo "INTERNAL_API_KEY ARCHIVE_GATEWAY_KEY CLOUD_FN_BASE_URL" ;;
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

# --- Sign-in preflight (fail closed) -----------------------------------------
# wrangler and firebase-tools each keep their own credentials, so a missing
# sign-in would otherwise surface only after the workers are live. A token in
# the environment (CI) counts as signed in for firebase.
preflight_signins() {
  local rc=0 listing
  if [ "$WITH_PAGES" = true ]; then
    wrangler whoami >"$WORK_DIR/err" 2>&1 || rc=$?
    if [ "$rc" -ne 0 ]; then
      cat "$WORK_DIR/err" >&2
      fail_target "pages:dashboard" failed 3 "wrangler is not signed in (run wrangler login or set CLOUDFLARE_API_TOKEN)"
    fi
  fi
  local firebase_target="function:${CLOUD_FUNCTIONS[0]}"
  [ "$WITH_FUNCTIONS" = true ] || firebase_target="rules:firestore"
  if { [ "$WITH_FUNCTIONS" = true ] || [ "$WITH_RULES" = true ]; } && [ -z "${FIREBASE_TOKEN:-}" ] && [ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]; then
    listing="$(firebase login:list 2>&1)" || rc=$?
    if [ "$rc" -ne 0 ] || ! printf '%s\n' "$listing" | grep -q "Logged in as"; then
      printf '%s\n' "$listing" >&2
      fail_target "$firebase_target" failed 3 "firebase is not signed in (run firebase login or set FIREBASE_TOKEN)"
    fi
  fi
  # The rules step reads the released rulesets through the Rules API with a
  # gcloud access token.
  if [ "$WITH_RULES" = true ]; then
    gcloud auth print-access-token >/dev/null 2>"$WORK_DIR/err" || rc=$?
    if [ "$rc" -ne 0 ]; then
      cat "$WORK_DIR/err" >&2
      fail_target "rules:firestore" failed 3 "gcloud is not signed in (run gcloud auth login)"
    fi
  fi
}

# --- Function secret preflight (Secret Manager, fail closed) -----------------
# firebase-tools prompts for a secret it cannot find, or fails mid-deploy when
# the latest version is not enabled. Every name of
# required_function_secrets_for() is checked before any deploy, each once;
# only names are printed, never a value.
preflight_function_secrets() {
  echo "=== Secret preflight (functions, Secret Manager) ==="
  local fn name state rc checked=" " absent=" " missing first_fn="" first_missing=""
  for fn in "${CLOUD_FUNCTIONS[@]}"; do
    missing=""
    for name in $(required_function_secrets_for "$fn"); do
      case "$checked" in
        *" $name "*) ;;
        *)
          rc=0
          state="$(gcloud secrets versions describe latest --secret "$name" --project "$FIREBASE_PROJECT" --format="value(state)" 2>"$WORK_DIR/err")" || rc=$?
          state="$(printf '%s' "$state" | tr -d '\r')"
          if [ "$rc" -ne 0 ] || [ "$state" != "ENABLED" ]; then
            absent="$absent$name "
          fi
          checked="$checked$name "
          ;;
      esac
      case "$absent" in
        *" $name "*) missing="$missing $name" ;;
      esac
    done
    if [ -n "$missing" ]; then
      echo "--- $fn is missing secret(s):$missing" >&2
      if [ -z "$first_fn" ]; then
        first_fn="$fn"
        first_missing="$missing"
      fi
    fi
  done
  if [ -n "$first_fn" ]; then
    echo "Create each with: printf '%s' \"<value>\" | gcloud secrets create <NAME> --data-file=- --project $FIREBASE_PROJECT (or add an enabled version)" >&2
    fail_target "function:$first_fn" failed 3 "missing secret(s):$first_missing"
  fi
  echo "=== Secret preflight passed (functions) ==="
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

# The trigger and scheduled functions of each codebase. They must have no
# public invoker (allUsers or allAuthenticatedUsers), which the invoker check
# reads after the deploy; HTTP functions stay public with per-caller keys. The
# deploy harness fails when an exported function outside this table is not an
# HTTP function.
private_functions_for() {
  case "$1" in
    user-triggers)     echo "onUserArticleSave" ;;
    backfill-archiver) echo "backfillArchiver articleStatusDerive" ;;
    *)                 echo "" ;;
  esac
}

# Deploy configuration each codebase requires in cloud-functions/<fn>/.env
# (firebase-tools would otherwise prompt for it).
required_function_params_for() {
  case "$1" in
    dashboard-api)     echo "DASHBOARD_USER_ID" ;;
    backfill-archiver) echo "BACKFILL_USER_ID" ;;
    *)                 echo "" ;;
  esac
}

# dual_accept_value <fn>: the KEY_ROTATION_DUAL_ACCEPT value of
# cloud-functions/<fn>/.env (its last assignment), empty when absent.
dual_accept_value() {
  sed -n 's/^KEY_ROTATION_DUAL_ACCEPT=//p' "cloud-functions/$1/.env" 2>/dev/null | tr -d '\r' | tail -n 1
}

# The functions that accept the old shared key while their switch is on.
has_dual_accept() {
  case "$1" in
    archive-gateway|backfill-archiver|dashboard-api) return 0 ;;
    *) return 1 ;;
  esac
}

# Secret Manager secrets each codebase binds. The old shared key is listed
# only while that function's .env turns the dual-accept switch on.
required_function_secrets_for() {
  local names
  case "$1" in
    archive-gateway)   names="ARCHIVE_GATEWAY_KEY GATEWAY_LOG_KEY CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET" ;;
    user-triggers)     names="PUBLIC_API_KEY CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET" ;;
    backfill-archiver) names="PUBLIC_API_KEY BACKFILL_STATUS_KEY CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET" ;;
    dashboard-api)     names="DASHBOARD_API_KEY" ;;
    *)                 names="" ;;
  esac
  if has_dual_accept "$1" && [ "$(dual_accept_value "$1")" = "true" ]; then
    names="$names INTERNAL_API_KEY"
  fi
  echo "$names"
}

# check_invokers <codebase>: fails the codebase's target when a trigger or
# scheduled function has a public invoker. A deploy update leaves IAM as it
# was, so the live policy is read after every deploy. The Cloud Run service
# of a 2nd gen function is its lower-cased name.
check_invokers() {
  local fn="$1" target="function:$1" name svc rc policy public
  for name in $(private_functions_for "$fn"); do
    svc="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
    rc=0
    policy="$(gcloud run services get-iam-policy "$svc" --region "$FUNCTION_REGION" --project "$FIREBASE_PROJECT" --format=json 2>"$WORK_DIR/err")" || rc=$?
    if [ "$rc" -ne 0 ]; then
      cat "$WORK_DIR/err" >&2
      fail_target "$target" failed "$rc" "IAM policy read for $name exited $rc"
    fi
    public="$(printf '%s' "$policy" | json_eval '(d.bindings || []).flatMap((b) => (b.members || []).filter((m) => m === "allUsers" || m === "allAuthenticatedUsers").map((m) => b.role + " " + m))' 2>"$WORK_DIR/err")" || {
      cat "$WORK_DIR/err" >&2
      fail_target "$target" failed 3 "IAM policy for $name is not the expected JSON"
    }
    if [ -n "$public" ]; then
      fail_target "$target" failed 3 "public invoker on $name: $(printf '%s' "$public" | tr '\n' ',' | sed 's/,$//')"
    fi
  done
}

deploy_cloud_fn() {
  local fn="$1" target="function:$1" rc=0 start
  set_result "$target" running "-"
  echo "--- Cloud function codebase $fn"
  start="$(now_iso)"
  (cd "cloud-functions/$fn" && GIT_SHA="$LABEL" firebase deploy --only "functions:$fn" --project "$FIREBASE_PROJECT" --non-interactive) || rc=$?
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
  if [ -n "$(private_functions_for "$fn")" ]; then
    check_invokers "$fn"
    detail="$detail invoker private"
  fi
  set_result "$target" deployed "${detail# }"
  echo "--- $fn deployed:$detail"
}

# --- Firestore and Storage rules -----------------------------------------------
# firebase-tools cannot read deployed rules back and exits 0 on some no-ops,
# so the released rulesets are read through the Firebase Rules API and their
# SHA-256 compared with the build copy. A gcloud user token needs the
# x-goog-user-project header; both headers go through a mode-600 file so the
# token never appears in an argument list or a log.
RULES_API="https://firebaserules.googleapis.com/v1"
RULES_HELPER="scripts/rules-release.mjs"
GRACE_PERIOD_MS=$((30 * 86400000))
RELEASED_RULESET=""

# rules_api_get <path> <out>: writes the response body to <out>, prints the
# HTTP status.
rules_api_get() {
  curl -sS -o "$2" -w '%{http_code}' -H @"$WORK_DIR/rules-headers" "$RULES_API/$1"
}

# fetch_released <release> <out> <target> <failed|unverified>: writes the
# released rules file of that release to <out> and sets RELEASED_RULESET to its
# ruleset id; leaves RELEASED_RULESET empty when the release does not exist.
# Any other answer stops the run on <target>.
fetch_released() {
  local release="$1" out="$2" target="$3" kind="$4" code rc=0 ruleset
  RELEASED_RULESET=""
  code="$(rules_api_get "projects/$FIREBASE_PROJECT/releases/$release" "$WORK_DIR/release.json" 2>"$WORK_DIR/err")" || rc=$?
  if [ "$rc" -ne 0 ]; then
    cat "$WORK_DIR/err" >&2
    fail_target "$target" "$kind" "$rc" "Rules API read of the $release release: curl exited $rc"
  fi
  case "$code" in
    200) ;;
    404) return 0 ;;
    *) fail_target "$target" "$kind" 3 "Rules API read of the $release release returned $code" ;;
  esac
  ruleset="$(json_eval 'd.rulesetName' <"$WORK_DIR/release.json" 2>"$WORK_DIR/err")" || ruleset=""
  [ -n "$ruleset" ] || fail_target "$target" "$kind" 3 "the $release release names no ruleset"
  rc=0
  code="$(rules_api_get "$ruleset" "$WORK_DIR/ruleset.json" 2>"$WORK_DIR/err")" || rc=$?
  if [ "$rc" -ne 0 ] || [ "$code" != 200 ]; then
    cat "$WORK_DIR/err" >&2
    fail_target "$target" "$kind" 3 "Rules API read of ruleset ${ruleset##*/} returned ${code:-no answer} (curl exit $rc)"
  fi
  if ! node "$RULES_HELPER" ruleset-content --in "$WORK_DIR/ruleset.json" >"$out" 2>"$WORK_DIR/err"; then
    cat "$WORK_DIR/err" >&2
    fail_target "$target" "$kind" 3 "ruleset ${ruleset##*/} of the $release release does not hold exactly one rules file"
  fi
  RELEASED_RULESET="${ruleset##*/}"
}

deploy_rules() {
  local dir="$WORK_DIR/rules" rc=0 start token end grace_source grace_iso
  set_result rules:firestore running "-"
  echo "--- Firestore and Storage rules"
  start="$(node -e 'console.log(Date.now())')"
  token="$(gcloud auth print-access-token 2>"$WORK_DIR/err")" || rc=$?
  if [ "$rc" -ne 0 ] || [ -z "$token" ]; then
    cat "$WORK_DIR/err" >&2
    fail_target rules:firestore failed 3 "gcloud is not signed in (run gcloud auth login)"
  fi
  (umask 077 && printf 'Authorization: Bearer %s\nx-goog-user-project: %s\n' "$token" "$FIREBASE_PROJECT" >"$WORK_DIR/rules-headers")
  token=""

  # The grace end in force is the stamped line of the released Firestore
  # rules; a later deploy reuses it so the end date never moves.
  fetch_released cloud.firestore "$WORK_DIR/released-firestore.rules" rules:firestore failed
  end=""
  if [ -n "$RELEASED_RULESET" ]; then
    end="$(node "$RULES_HELPER" grace-end --in "$WORK_DIR/released-firestore.rules")"
  fi
  if [ -n "$end" ]; then
    grace_source="reused from the released rules"
  else
    end=$((start + GRACE_PERIOD_MS))
    grace_source="first stamped deploy: start + 30 days"
  fi
  grace_iso="$(node -e 'console.log(new Date(Number(process.argv[1])).toISOString())' "$end")"
  if [ "$grace_source" != "reused from the released rules" ]; then
    WARNINGS+=("rules: the released Firestore rules held no grace end; a new 30-day grace period ends $grace_iso")
  fi
  echo "Grace end: $grace_iso ($grace_source)"

  # Build copy: LF line endings, the placeholder replaced by the grace end.
  mkdir -p "$dir"
  cp "$RULES_DIR/firebase.json" "$RULES_DIR/.firebaserc" "$dir/"
  if ! node "$RULES_HELPER" stamp --in "$RULES_DIR/firestore.rules" --out "$dir/firestore.rules" --end-ms "$end" 2>"$WORK_DIR/err"; then
    cat "$WORK_DIR/err" >&2
    local reason
    reason="$(sed -n 's/^rules-release: //p' "$WORK_DIR/err" | head -n 1)"
    fail_target rules:firestore failed 3 "${reason:-the grace stamp of firebase/firestore.rules failed}"
  fi
  node "$RULES_HELPER" normalize --in "$RULES_DIR/storage.rules" --out "$dir/storage.rules"

  rc=0
  (cd "$dir" && firebase deploy --only firestore:rules,storage --project "$FIREBASE_PROJECT" --non-interactive --config firebase.json) || rc=$?
  if [ "$rc" -ne 0 ]; then
    fail_target rules:firestore failed "$rc" "firebase deploy exited $rc"
  fi

  local want got
  want="$(node "$RULES_HELPER" sha256 --in "$dir/firestore.rules")"
  fetch_released cloud.firestore "$WORK_DIR/released-firestore.rules" rules:firestore unverified
  [ -n "$RELEASED_RULESET" ] || fail_target rules:firestore unverified 3 "no Firestore release after the deploy"
  got="$(node "$RULES_HELPER" sha256 --in "$WORK_DIR/released-firestore.rules")"
  if [ "$got" != "$want" ]; then
    fail_target rules:firestore unverified 3 "released ruleset sha256:${got:0:12} differs from the build copy sha256:${want:0:12}"
  fi
  set_result rules:firestore deployed "$RELEASED_RULESET sha256:${want:0:12} grace $grace_iso"
  echo "--- Firestore rules deployed: $RELEASED_RULESET"

  set_result rules:storage running "-"
  local buckets bucket detail=""
  buckets="$(node "$RULES_HELPER" buckets --config "$dir/firebase.json" --rc "$dir/.firebaserc" --project "$FIREBASE_PROJECT" 2>"$WORK_DIR/err")" || {
    cat "$WORK_DIR/err" >&2
    fail_target rules:storage failed 3 "cannot list the storage buckets of firebase/firebase.json"
  }
  [ -n "$buckets" ] || fail_target rules:storage failed 3 "firebase/firebase.json names no storage bucket"
  want="$(node "$RULES_HELPER" sha256 --in "$dir/storage.rules")"
  for bucket in $buckets; do
    fetch_released "firebase.storage/$bucket" "$WORK_DIR/released-storage.rules" rules:storage unverified
    [ -n "$RELEASED_RULESET" ] || fail_target rules:storage unverified 3 "no storage release for $bucket after the deploy"
    got="$(node "$RULES_HELPER" sha256 --in "$WORK_DIR/released-storage.rules")"
    if [ "$got" != "$want" ]; then
      fail_target rules:storage unverified 3 "$bucket released ruleset sha256:${got:0:12} differs from the build copy sha256:${want:0:12}"
    fi
    detail="$detail $bucket=$RELEASED_RULESET"
  done
  set_result rules:storage deployed "${detail# } sha256:${want:0:12}"
  echo "--- Storage rules deployed:$detail"
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
    if has_dual_accept "$fn"; then
      case "$(dual_accept_value "$fn")" in
        true|false) ;;
        *) fail_target "function:$fn" failed 3 "cloud-functions/$fn/.env must set KEY_ROTATION_DUAL_ACCEPT=true or =false (see README: rotating the function keys)" ;;
      esac
    fi
    for name in $(required_function_secrets_for "$fn") INTERNAL_API_KEY; do
      if grep -Eq "^[[:space:]]*(export[[:space:]]+)?${name}[[:space:]]*=" "cloud-functions/$fn/.env"; then
        fail_target "function:$fn" failed 3 "cloud-functions/$fn/.env assigns $name, which is a Secret Manager secret; remove the line"
      fi
    done
    for name in $(required_function_params_for "$fn"); do
      if [ -z "$(sed -n "s/^${name}=//p" "cloud-functions/$fn/.env" | tr -d '\r' | tail -n 1)" ]; then
        fail_target "function:$fn" failed 3 "cloud-functions/$fn/.env must set $name (deploy configuration)"
      fi
    done
  done
fi

# --- Secret preflight for every worker, before any deploy ---------------------
# All nine are checked first, so a missing secret on a later worker (gateway is
# last) stops the run before any worker is live and the fleet never ends up on
# mixed versions.
if [ "$FUNCTIONS_ONLY" = true ]; then
  echo "=== Secret preflight skipped (--functions-only) ==="
else
  echo "=== Secret preflight (every worker) ==="
  for w in "${WORKERS[@]}"; do
    preflight_secrets "$w"
  done
  echo "=== Secret preflight passed ==="
fi
echo
if [ "$WITH_FUNCTIONS" = true ]; then
  preflight_function_secrets
  echo
fi

# --- Sign-in preflight for the dashboard and the functions, before any deploy -
preflight_signins

# --- Deploy in dependency order ----------------------------------------------
# Tier 1: logger renderer hyperrenderer singlefile readability monolith gcs;
# tier 2: workflow (binds tier 1); tier 3: gateway (binds logger and workflow).
if [ "$FUNCTIONS_ONLY" = false ]; then
  for w in "${WORKERS[@]}"; do
    deploy_worker "$w"
  done
fi

if [ "$WITH_FUNCTIONS" = true ]; then
  for fn in "${CLOUD_FUNCTIONS[@]}"; do
    deploy_cloud_fn "$fn"
  done
fi

# The rules go after the functions: the trigger that writes the server-owned
# link must be live before the grace rule compares with it.
if [ "$WITH_RULES" = true ]; then
  deploy_rules
fi

if [ "$WITH_PAGES" = true ]; then
  deploy_pages
fi
