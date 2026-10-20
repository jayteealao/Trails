#!/usr/bin/env bash
# Self-test for lint-workflows.sh and validate-version-name.sh. Each fixture
# must fail with its named rule, the real workflows must pass, and the
# version_name validator must accept and reject the listed values.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
lint="$here/lint-workflows.sh"
validate="$here/validate-version-name.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failures=0

pass() { echo "ok   $1"; }
fail() { echo "FAIL $1"; failures=$((failures + 1)); }

# expect_lint_failure <name> <workflow-dir> <package.json> <rule> [<exact count>]
expect_lint_failure() {
  local name=$1 wdir=$2 pkg=$3 rule=$4 count=${5:-}
  local out rc=0 hits
  out=$(bash "$lint" "$wdir" "$pkg" 2>&1) || rc=$?
  hits=$(printf '%s\n' "$out" | grep -c ": $rule: " || true)
  if [ "$rc" -ne 1 ]; then
    fail "$name: expected exit 1, got $rc"; printf '%s\n' "$out"; return
  fi
  if [ "$hits" -lt 1 ]; then
    fail "$name: no $rule violation reported"; printf '%s\n' "$out"; return
  fi
  if [ -n "$count" ] && [ "$hits" -ne "$count" ]; then
    fail "$name: expected $count $rule violation(s), got $hits"; printf '%s\n' "$out"; return
  fi
  pass "$name: exit 1 with $hits $rule violation(s)"
}

good_pkg="$tmp/package.json"
printf '{"devDependencies":{"firebase-tools":"15.34.0"}}' > "$good_pkg"
nokey_pkg="$tmp/nokey-package.json"
printf '{"devDependencies":{}}' > "$nokey_pkg"

mkdir "$tmp/tag-pinned" "$tmp/input-in-run" "$tmp/fb-mismatch"
cp "$here/fixtures/tag-pinned.yml" "$tmp/tag-pinned/"
cp "$here/fixtures/input-in-run.yml" "$tmp/input-in-run/"
cp "$here/fixtures/firebase-rules-mismatch.yml" "$tmp/fb-mismatch/firebase-rules.yml"

expect_lint_failure "tag-pinned fixture" "$tmp/tag-pinned" "$good_pkg" uses-pin
expect_lint_failure "input-in-run fixture" "$tmp/input-in-run" "$good_pkg" input-in-run 1
expect_lint_failure "firebase-tools mismatch fixture" "$tmp/fb-mismatch" "$good_pkg" firebase-tools-pin
expect_lint_failure "firebase-tools missing key" "$tmp/fb-mismatch" "$nokey_pkg" firebase-tools-pin

rc=0
out=$(bash "$lint" "$repo/.github/workflows" "$repo/warg/package.json" 2>&1) || rc=$?
if [ "$rc" -eq 0 ]; then
  pass "real workflows: $out"
else
  fail "real workflows: expected exit 0, got $rc"; printf '%s\n' "$out"
fi

for v in 1.11.0 1.0.0-beta 0.0.0-ci-gate 1.11.0+build.5; do
  if bash "$validate" "$v" >/dev/null 2>&1; then pass "version_name '$v' accepted"; else fail "version_name '$v' rejected"; fi
done
for v in '1.11.0; echo pwned' 1.11 v1.11.0 01.2.3 1.2.3-01 1.2.3-..; do
  if bash "$validate" "$v" >/dev/null 2>&1; then fail "version_name '$v' accepted"; else pass "version_name '$v' rejected"; fi
done

if [ "$failures" -gt 0 ]; then
  echo "lint self-test: $failures failure(s)"
  exit 1
fi
echo "lint self-test: all passed"
