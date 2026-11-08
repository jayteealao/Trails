#!/usr/bin/env bash
# Workflow lint. Fails on:
#   uses-pin            a `uses:` line not pinned as owner/repo[/path]@<40-hex> # vX.Y.Z
#                       (local ./ actions are exempt)
#   input-in-run        ${{ inputs.* }} or ${{ github.event.inputs.* }} inside a run: value
#   develop-branch      a `- develop` branch entry
#   pr-signing          keystore or signing secrets named in pr-build-check.yml
#   firebase-tools-pin  firebase-rules.yml installs a firebase-tools version other than the
#                       exact one warg/package.json declares (checked when it installs one)
#   rules-deploy-in-ci  firebase-rules.yml runs a firebase deploy (rules deploy only through
#                       warg/scripts/deploy.sh)
#   article-write-guard warg-ci.yml has no step running node scripts/check-article-writes.mjs,
#                       or its on.pull_request.paths list has no 'warg/**' entry
#   drift-android-trigger a workflow running shared-types/check-drift.ts lacks 'android/**'
#                       in on.pull_request.paths or on.push.paths, or has a job-level if:
#                       that can skip the drift job
# Usage: lint-workflows.sh [workflow-dir] [warg-package-json]
set -euo pipefail

dir=${1:-.github/workflows}
pkg=${2:-warg/package.json}
violations=0

report() {
  echo "$1"
  violations=$((violations + 1))
}

# paths_missing <file> <event> <path>: prints nothing when on.<event>.paths lists <path>
# (quoted or not, block or flow list), else the line to blame
paths_missing() {
  awk -v q="'" -v event="$2" -v want="$3" '
    function trim(s) { sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); return s }
    {
      sub(/\r$/, "")
      gsub(/"/, "")
      gsub(q, "")
      if ($0 ~ /^[[:space:]]*(#.*)?$/) next
      match($0, /^[[:space:]]*/)
      ind = RLENGTH
      body = substr($0, ind + 1)
      if (ind == 0) { inon = ($0 ~ /^on:/); inev = 0; inpaths = 0; next }
      if (!inon) next
      if (inpaths && (ind > pathsind || (ind == pathsind && body ~ /^-/))) {
        if (body ~ /^-/) {
          item = substr(body, 2)
          sub(/#.*/, "", item)
          if (trim(item) == want) found = 1
        }
        next
      }
      inpaths = 0
      if (inev && ind <= evind) inev = 0
      if (!inev && index(body, event ":") == 1) { inev = 1; evind = ind; evline = NR; next }
      if (inev && body ~ /^paths:/) {
        pathsline = NR
        if (body ~ /\[/) {
          list = body
          sub(/^[^[]*\[/, "", list)
          sub(/\].*/, "", list)
          n = split(list, items, ",")
          for (i = 1; i <= n; i++) if (trim(items[i]) == want) found = 1
        } else { inpaths = 1; pathsind = ind }
      }
    }
    END { if (!found) print (pathsline ? pathsline : (evline ? evline : 1)) }
  ' "$1"
}

shopt -s nullglob
files=("$dir"/*.yml "$dir"/*.yaml)
if [ "${#files[@]}" -eq 0 ]; then
  echo "lint-workflows: no workflow files in $dir" >&2
  exit 2
fi

for f in "${files[@]}"; do
  # uses-pin
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    line=${hit%%:*}
    text=${hit#*:}
    value=$(printf '%s' "$text" | sed -E 's/^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]*//')
    case $value in
      ./*|\"./*|\'./*) continue ;;
    esac
    if ! printf '%s' "$value" | grep -qE '^[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}[[:space:]]+#[[:space:]]+v[0-9]+\.[0-9]+\.[0-9]+[[:space:]]*$'; then
      report "$f:$line: uses-pin: $value"
    fi
  done < <(grep -nE '^[[:space:]]*(-[[:space:]]+)?uses:' "$f" || true)

  # input-in-run: track run: block scalars by indentation, plus single-line run: values
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    report "$hit"
  done < <(awk -v file="$f" '
    function flag(s) { return s ~ /\$\{\{[[:space:]]*(github\.event\.)?inputs\./ }
    {
      sub(/\r$/, "")
      if (inrun) {
        if ($0 ~ /^[[:space:]]*$/) next
        match($0, /^[[:space:]]*/)
        if (RLENGTH > runindent) {
          if (flag($0)) printf "%s:%d: input-in-run: %s\n", file, NR, $0
          next
        }
        inrun = 0
      }
      if (match($0, /^[[:space:]]*(-[[:space:]]+)?run:/)) {
        line = $0
        match(line, /^[[:space:]]*/)
        indent = RLENGTH
        if (line ~ /^[[:space:]]*-[[:space:]]+run:/) {
          # the key sits after "- "; its block content is deeper than the dash
          match(line, /^[[:space:]]*-[[:space:]]+/)
          indent = RLENGTH
        }
        rest = line
        sub(/^[[:space:]]*(-[[:space:]]+)?run:[[:space:]]*/, "", rest)
        if (rest ~ /^[|>][-+0-9]*[[:space:]]*(#.*)?$/) {
          inrun = 1
          runindent = indent
        } else if (flag(rest)) {
          printf "%s:%d: input-in-run: %s\n", file, NR, line
        }
      }
    }
  ' "$f")

  # develop-branch
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    report "$f:${hit%%:*}: develop-branch: ${hit#*:}"
  done < <(grep -nE "^[[:space:]]*-[[:space:]]*['\"]?develop['\"]?[[:space:]]*$" "$f" || true)

  base=$(basename "$f")

  # pr-signing
  if [ "$base" = "pr-build-check.yml" ]; then
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      report "$f:${hit%%:*}: pr-signing: ${hit#*:}"
    done < <(grep -inE 'keystore|SIGNING_STORE|SIGNING_KEY' "$f" || true)
  fi

  # article-write-guard
  if [ "$base" = "warg-ci.yml" ]; then
    if ! grep -qE '^[[:space:]]*(-[[:space:]]+)?(run:[[:space:]]*)?node[[:space:]]+scripts/check-article-writes\.mjs([[:space:]]|$)' "$f"; then
      report "$f:1: article-write-guard: no step runs node scripts/check-article-writes.mjs"
    fi
    missing=$(paths_missing "$f" pull_request 'warg/**')
    if [ -n "$missing" ]; then
      report "$f:$missing: article-write-guard: pull_request paths lack 'warg/**'"
    fi
  fi

  # drift-android-trigger
  if grep -qE '(^|[[:space:]])shared-types/check-drift\.ts([[:space:]]|$)' "$f"; then
    for event in pull_request push; do
      missing=$(paths_missing "$f" "$event" 'android/**')
      if [ -n "$missing" ]; then
        report "$f:$missing: drift-android-trigger: $event paths lack 'android/**'"
      fi
    done
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      report "$f:${hit%%:*}: drift-android-trigger: job-level if: can skip the drift job"
    done < <(grep -nE '^    if:' "$f" || true)
  fi

  if [ "$base" = "firebase-rules.yml" ]; then
    # rules-deploy-in-ci
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      report "$f:${hit%%:*}: rules-deploy-in-ci: ${hit#*:}"
    done < <(grep -nE 'firebase[[:space:]]+deploy' "$f" || true)

    # firebase-tools-pin
    install=$(grep -nE 'npm (install|i) .*firebase-tools' "$f" || true)
    [ -n "$install" ] || continue
    line=${install%%:*}
    used=$(printf '%s' "$install" | sed -nE 's/.*firebase-tools@([^[:space:]]+).*/\1/p')
    declared=""
    if [ -f "$pkg" ]; then
      declared=$(node -p "(require(require('path').resolve(process.argv[1])).devDependencies || {})['firebase-tools'] || ''" "$pkg")
    fi
    if [ -z "$used" ]; then
      report "$f:$line: firebase-tools-pin: install has no version (warg declares '${declared:-nothing}' in $pkg)"
    elif [ -z "$declared" ]; then
      report "$f:$line: firebase-tools-pin: $pkg declares no devDependencies firebase-tools (workflow installs $used)"
    elif ! [[ $used =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || ! [[ $declared =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      report "$f:$line: firebase-tools-pin: versions must be exact X.Y.Z (workflow $used, $pkg $declared)"
    elif [ "$used" != "$declared" ]; then
      report "$f:$line: firebase-tools-pin: workflow installs $used but $pkg declares $declared"
    fi
  fi
done

if [ "$violations" -gt 0 ]; then
  echo "lint-workflows: $violations violation(s)"
  exit 1
fi
echo "lint-workflows: ${#files[@]} file(s) clean"
