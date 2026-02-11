#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Warg Deploy Script
#
# Deploys Cloudflare Workers, Cloud Functions, and Pages in dependency order.
# Usage:
#   bash scripts/deploy.sh                   # deploy workers only
#   bash scripts/deploy.sh --with-pages      # deploy workers + Pages dashboard
#   bash scripts/deploy.sh --with-functions  # deploy workers + Cloud Functions
#   bash scripts/deploy.sh --all             # deploy everything
#   bash scripts/deploy.sh --skip-checks     # skip typecheck/test pre-checks
#
# Required secrets (set once per worker via wrangler secret put):
#   gateway:     INTERNAL_API_KEY, PUBLIC_API_KEY
#   workflow:    INTERNAL_API_KEY
#   renderer:    INTERNAL_API_KEY, CF_ACCOUNT_ID, BR_API_TOKEN
#   singlefile:  INTERNAL_API_KEY
#   readability: INTERNAL_API_KEY
#   monolith:    INTERNAL_API_KEY
#   gcs:         INTERNAL_API_KEY, CLOUD_FN_BASE_URL
#
# Cloud Functions require .env files with runtime secrets.
# Copy from .env.example in each cloud-functions/ subdirectory.
# ============================================================================

WITH_PAGES=false
WITH_FUNCTIONS=false
SKIP_CHECKS=false

for arg in "$@"; do
  case "$arg" in
    --with-pages) WITH_PAGES=true ;;
    --with-functions) WITH_FUNCTIONS=true ;;
    --all) WITH_PAGES=true; WITH_FUNCTIONS=true ;;
    --skip-checks) SKIP_CHECKS=true ;;
    --) ;; # ignore pnpm's -- separator
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

CLOUD_FUNCTIONS=(archive-gateway user-triggers backfill-archiver dashboard-api)
DEPLOYED=()

deploy_worker() {
  local worker="$1"
  echo "--- Deploying $worker..."
  pnpm exec wrangler deploy --config "workers/$worker/wrangler.jsonc"
  DEPLOYED+=("worker:$worker")
  echo "--- $worker deployed."
  echo
}

deploy_cloud_fn() {
  local fn="$1"
  echo "--- Deploying cloud function $fn..."
  (cd "cloud-functions/$fn" && npx firebase deploy --only functions --project trails-e428e)
  DEPLOYED+=("cf:$fn")
  echo "--- $fn deployed."
  echo
}

# --- Pre-checks ---
if [ "$SKIP_CHECKS" = false ]; then
  echo "=== Running pre-checks ==="
  echo "--- Typecheck..."
  pnpm -r typecheck
  echo "--- Tests..."
  pnpm -r test
  echo "=== Pre-checks passed ==="
  echo
else
  echo "=== Skipping pre-checks (--skip-checks) ==="
  echo
fi

# --- Validate .env files for cloud functions ---
if [ "$WITH_FUNCTIONS" = true ]; then
  echo "=== Validating cloud function .env files ==="
  for fn in "${CLOUD_FUNCTIONS[@]}"; do
    if [ ! -f "cloud-functions/$fn/.env" ]; then
      echo "ERROR: cloud-functions/$fn/.env is missing. Copy from .env.example and fill in secrets."
      exit 1
    fi
  done
  echo "=== All .env files present ==="
  echo
fi

# --- Tier 1: independent workers (no service binding deps) ---
echo "=== Tier 1: independent workers ==="
for worker in logger renderer singlefile readability monolith gcs; do
  deploy_worker "$worker"
done

# --- Tier 2: workflow (depends on all Tier 1 workers) ---
echo "=== Tier 2: workflow ==="
deploy_worker "workflow"

# --- Tier 3: gateway (depends on logger + workflow) ---
echo "=== Tier 3: gateway ==="
deploy_worker "gateway"

echo "=== All workers deployed ==="

# --- Cloud Functions ---
if [ "$WITH_FUNCTIONS" = true ]; then
  echo
  echo "=== Deploying Cloud Functions ==="
  for fn in "${CLOUD_FUNCTIONS[@]}"; do
    deploy_cloud_fn "$fn"
  done
  echo "=== All Cloud Functions deployed ==="
fi

# --- Pages dashboard ---
if [ "$WITH_PAGES" = true ]; then
  echo
  echo "=== Deploying Pages dashboard ==="
  (cd pages/dashboard && ../../node_modules/.bin/wrangler pages deploy)
  DEPLOYED+=("pages:dashboard")
  echo "=== Dashboard deployed ==="
fi

# --- Summary ---
echo
echo "=== Deploy summary ==="
for name in "${DEPLOYED[@]}"; do
  echo "  [ok] $name"
done
echo "Done."
