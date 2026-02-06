#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Warg Deploy Script
#
# Deploys all Cloudflare Workers in dependency order.
# Usage:
#   bash scripts/deploy.sh              # deploy all workers
#   bash scripts/deploy.sh --with-pages # deploy workers + Pages dashboard
#   bash scripts/deploy.sh --skip-checks # skip typecheck/test pre-checks
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
# Cloud Functions (archive-gateway, user-triggers) are deployed separately
# via Firebase CLI. See project docs.
# ============================================================================

WITH_PAGES=false
SKIP_CHECKS=false

for arg in "$@"; do
  case "$arg" in
    --with-pages) WITH_PAGES=true ;;
    --skip-checks) SKIP_CHECKS=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

DEPLOYED=()

deploy_worker() {
  local worker="$1"
  echo "--- Deploying $worker..."
  pnpm exec wrangler deploy --config "workers/$worker/wrangler.jsonc"
  DEPLOYED+=("$worker")
  echo "--- $worker deployed."
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

# --- Optional: Pages dashboard ---
if [ "$WITH_PAGES" = true ]; then
  echo
  echo "=== Deploying Pages dashboard ==="
  pnpm exec wrangler pages deploy pages/dashboard --project-name=warg-dashboard
  DEPLOYED+=("pages/dashboard")
  echo "=== Dashboard deployed ==="
fi

# --- Summary ---
echo
echo "=== Deploy summary ==="
for name in "${DEPLOYED[@]}"; do
  echo "  [ok] $name"
done
echo "Done."
