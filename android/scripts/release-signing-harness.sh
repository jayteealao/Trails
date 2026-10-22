#!/usr/bin/env bash
# Release-signing harness: proves the release signing path end to end with
# throwaway keys, so the real keystores are never needed.
#
#   bash android/scripts/release-signing-harness.sh [case ...]
#
# Cases (default: all, in this order):
#   caught-store             no release signing values: assembleRelease and, in a
#                            separate run, bundleRelease fail naming every missing
#                            value, and no APK or AAB exists
#   caught-lineage-missing   the lineage path does not exist: the build fails naming
#                            SIGNING_LINEAGE_FILE, and no APK exists
#   caught-lineage-corrupt   a truncated lineage: the re-sign fails, and no APK remains
#   caught-lineage-mismatch  a lineage to another key: the re-sign fails, and no APK remains
#   workflow-steps           runs the release workflows' keystore decode and export steps
#                            with the harness keystores as base64 secrets, then the pass
#                            checks through the environment they export
#   pass                     assembleRelease bundleRelease with the harness keys: one APK
#                            and one AAB; v1/v2/v3 signed by the debug-like key, v3.1 by
#                            the release-like key, both in the APK's lineage; the .idsig
#                            verifies; 16 KB alignment holds; the workflows' APK glob
#                            matches one file; the re-sign takes 30 s or less
#   emulator-artifacts       a debug APK signed with the debug-like key, for installing
#                            the release APK over it on an emulator
#
# It runs `./gradlew clean` once, then generates the keys with
# :app:generateSigningHarness (app/build/signing-harness/, ignored by git).
# Every case writes its log to .scratch/signing-harness/<case>.log at the repo
# root and prints PASS or FAIL; the script exits non-zero on any FAIL.
# Gradle heavy builds: run it where a full release build is allowed.
set -euo pipefail

ANDROID_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REPO_DIR=$(cd "$ANDROID_DIR/.." && pwd)
HARNESS="$ANDROID_DIR/app/build/signing-harness"
LOGS="$REPO_DIR/.scratch/signing-harness"
APK_DIR="$ANDROID_DIR/app/build/outputs/apk/release"
AAB_DIR="$ANDROID_DIR/app/build/outputs/bundle/release"
BUILD_TOOLS=${BUILD_TOOLS:-36.0.0}
MAX_RESIGN_MS=30000
SIGNING_VARS=(SIGNING_STORE_FILE SIGNING_STORE_PASSWORD SIGNING_KEY_ALIAS SIGNING_KEY_PASSWORD
  KEYSTORE_FILE KEYSTORE_PASSWORD SIGNING_DEBUG_STORE_FILE SIGNING_LINEAGE_FILE)
RELEASE_NAMES=(SIGNING_STORE_FILE SIGNING_STORE_PASSWORD SIGNING_KEY_ALIAS SIGNING_KEY_PASSWORD)

mkdir -p "$LOGS"

# ---- tools ----
sdk_dir() {
  if [ -n "${ANDROID_HOME:-}" ]; then printf '%s' "$ANDROID_HOME"; return; fi
  if [ -n "${ANDROID_SDK_ROOT:-}" ]; then printf '%s' "$ANDROID_SDK_ROOT"; return; fi
  local line
  line=$(grep -E '^sdk\.dir=' "$ANDROID_DIR/local.properties" 2>/dev/null || true)
  [ -n "$line" ] || { echo "Set ANDROID_HOME or sdk.dir in android/local.properties." >&2; exit 2; }
  printf '%s' "${line#sdk.dir=}" | sed -e 's/\\:/:/g' -e 's/\\\\/\//g'
}
SDK=$(sdk_dir)
BT="$SDK/build-tools/$BUILD_TOOLS"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) APKSIGNER="$BT/apksigner.bat"; ZIPALIGN="$BT/zipalign.exe" ;;
  *) APKSIGNER="$BT/apksigner"; ZIPALIGN="$BT/zipalign" ;;
esac
for tool in "$APKSIGNER" "$ZIPALIGN"; do
  [ -f "$tool" ] || { echo "Missing $tool; install Android SDK build-tools $BUILD_TOOLS." >&2; exit 2; }
done
KEYTOOL=$(command -v keytool || true)
[ -n "$KEYTOOL" ] || KEYTOOL="${JAVA_HOME:-}/bin/keytool"

# A developer's own signing values must not mask the caught cases.
refuse_local_signing() {
  local f
  for f in "$ANDROID_DIR/local.properties" "$ANDROID_DIR/gradle.properties" "${GRADLE_USER_HOME:-$HOME/.gradle}/gradle.properties"; do
    if [ -f "$f" ] && grep -qE '^[[:space:]]*(SIGNING_|KEYSTORE_)[A-Z_]*[[:space:]]*=' "$f"; then
      echo "$f sets a signing value; move it to the environment before running the harness." >&2
      exit 2
    fi
  done
}

# ---- helpers ----
FAILED=0
CASE=""
LOG=""
note() { printf '%s\n' "$*" >> "$LOG"; }
fail() { note "ASSERT FAILED: $*"; echo "  $CASE: $*"; CASE_OK=0; }
start_case() { CASE=$1; LOG="$LOGS/$CASE.log"; : > "$LOG"; CASE_OK=1; echo "== $CASE"; }
end_case() {
  if [ "$CASE_OK" = 1 ]; then echo "PASS $CASE"; note "PASS"; else echo "FAIL $CASE (log: $LOG)"; note "FAIL"; FAILED=1; fi
}

# Runs gradlew with no signing value in the environment, plus the given NAME=VALUE pairs.
gradle_with() {
  local args=() v
  for v in "${SIGNING_VARS[@]}"; do args+=(-u "$v"); done
  local envs=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do envs+=("$1"); shift; done
  shift
  note "\$ ./gradlew $*"
  (cd "$ANDROID_DIR" && env "${args[@]}" "${envs[@]}" ./gradlew --console=plain "$@") >> "$LOG" 2>&1
}

harness_env() {
  # The SIGNING_* pairs written by :app:generateSigningHarness.
  sed -n "s/^export \([A-Z_]*\)='\(.*\)'$/\1=\2/p" "$HARNESS/harness.env"
}

clear_outputs() { rm -rf "$APK_DIR" "$AAB_DIR"; }
count_files() { if [ -d "$1" ]; then find "$1" -type f -name "$2" | wc -l | tr -d ' '; else echo 0; fi; }

lineage_digest() { # <lineage or apk> <signer number>
  "$APKSIGNER" lineage --in "$1" --print-certs 2>&1 | tr -d '\r' \
    | sed -n "s/^Signer #$2 in lineage certificate SHA-256 digest: //p"
}

# ---- cases ----
case_caught_store() {
  start_case caught-store
  local out names from
  for task in assembleRelease bundleRelease; do
    clear_outputs
    from=$(($(wc -l < "$LOG") + 1))
    if gradle_with -- ":app:$task"; then
      fail "$task succeeded with no release signing values"
    fi
    out=$(tail -n "+$from" "$LOG" | tr -d '\r' | grep -m1 'Release signing is not configured. Missing:' || true)
    [ -n "$out" ] || fail "$task: no 'Missing:' message"
    for names in "${RELEASE_NAMES[@]}"; do
      printf '%s' "$out" | grep -q "$names" || fail "$task: message does not name $names"
    done
    note "$task message: $out"
    [ "$(count_files "$APK_DIR" '*.apk')" = 0 ] || fail "$task left an APK"
    [ "$(count_files "$AAB_DIR" '*.aab')" = 0 ] || fail "$task left an AAB"
  done
  end_case
}

case_caught_lineage() { # <case> <lineage path> <expected text>
  start_case "$1"
  clear_outputs
  local envs=()
  mapfile -t envs < <(harness_env | grep -v '^SIGNING_LINEAGE_FILE=')
  envs+=("SIGNING_LINEAGE_FILE=$2")
  if gradle_with "${envs[@]}" -- :app:assembleRelease; then
    fail "assembleRelease succeeded with lineage $2"
  fi
  tr -d '\r' < "$LOG" | grep -q "$3" || fail "no '$3' in the build output"
  if [ "$1" = caught-lineage-missing ]; then
    local msg
    msg=$(tr -d '\r' < "$LOG" | grep -m1 'Release signing is not configured. Missing:' || true)
    note "message: $msg"
    for names in "${RELEASE_NAMES[@]}"; do
      printf '%s' "$msg" | grep -q "$names" && fail "message names $names, which is set"
    done
  fi
  [ "$(count_files "$APK_DIR" '*.apk')" = 0 ] || fail "an APK remains under outputs/apk/release"
  [ "$(count_files "$APK_DIR" '*.idsig')" = 0 ] || fail "an .idsig remains under outputs/apk/release"
  end_case
}

# Builds both release outputs with the given NAME=VALUE pairs and checks them.
build_and_verify() {
  clear_outputs
  gradle_with "$@" -- :app:assembleRelease :app:bundleRelease || { fail "assembleRelease bundleRelease failed"; return; }
  local apks aabs apk report dbg rel ms glob
  apks=$(count_files "$APK_DIR" '*.apk'); aabs=$(count_files "$AAB_DIR" '*.aab')
  [ "$apks" = 1 ] || fail "expected one APK, found $apks"
  [ "$aabs" = 1 ] || fail "expected one AAB, found $aabs"
  [ "$apks" = 1 ] || return
  apk=$(find "$APK_DIR" -type f -name '*.apk')
  note "APK: $apk"

  dbg=$(lineage_digest "$HARNESS/harness.lineage" 1)
  rel=$(lineage_digest "$HARNESS/harness.lineage" 2)
  [ -n "$dbg" ] && [ -n "$rel" ] || fail "cannot read the harness lineage digests"
  note "debug-like SHA-256: $dbg"; note "release-like SHA-256: $rel"

  if ! report=$("$APKSIGNER" verify -v --print-certs "$apk" 2>&1); then fail "apksigner verify exited non-zero"; fi
  report=$(printf '%s' "$report" | tr -d '\r'); note "$report"
  local scheme
  for scheme in "v2 scheme (APK Signature Scheme v2)" "v3 scheme (APK Signature Scheme v3)" "v3.1 scheme (APK Signature Scheme v3.1)"; do
    printf '%s\n' "$report" | grep -qxF "Verified using $scheme: true" || fail "not verified using $scheme"
  done
  printf '%s\n' "$report" | grep -q '^WARNING\|^ERROR' && note "(apksigner printed warnings above)"
  printf '%s\n' "$report" | grep -q '^ERROR' && fail "apksigner reported an error"
  printf '%s\n' "$report" | grep -qE "^Signer \(minSdkVersion=33, maxSdkVersion=[0-9]+\) certificate SHA-256 digest: $rel$" \
    || fail "the v3.1 signer (Android 13+) is not the release-like key"
  printf '%s\n' "$report" | grep -qE "^Signer \(minSdkVersion=24, maxSdkVersion=32\) certificate SHA-256 digest: $dbg$" \
    || fail "the v1/v2/v3 signer (Android 7-12) is not the debug-like key"
  # minSdk 24 makes apksigner skip the v1 report; ask for it at minSdk 18.
  if ! report=$("$APKSIGNER" verify -v --min-sdk-version 18 "$apk" 2>&1); then fail "apksigner verify (minSdk 18) exited non-zero"; fi
  printf '%s\n' "$report" | tr -d '\r' | grep -qxF "Verified using v1 scheme (JAR signing): true" || fail "not verified using v1"

  [ "$(lineage_digest "$apk" 1)" = "$dbg" ] || fail "the APK lineage's first signer is not the debug-like key"
  [ "$(lineage_digest "$apk" 2)" = "$rel" ] || fail "the APK lineage's second signer is not the release-like key"

  if [ -f "$apk.idsig" ]; then
    "$APKSIGNER" verify --v4-signature-file "$apk.idsig" "$apk" >> "$LOG" 2>&1 || fail "the .idsig does not verify"
  else
    fail "no .idsig beside the APK"
  fi
  "$ZIPALIGN" -c -P 16 -v 4 "$apk" > "$LOG.zipalign" 2>&1 || fail "zipalign -c -P 16 failed"
  tail -n 1 "$LOG.zipalign" >> "$LOG"; rm -f "$LOG.zipalign"

  glob=$(cd "$ANDROID_DIR" && find . -type f -path "*/build/outputs/apk/*elease/*.apk" ! -name "*-unsigned.apk" ! -name "*-unaligned.apk" | wc -l | tr -d ' ')
  note "workflow APK glob matches: $glob"
  [ "$glob" = 1 ] || fail "the workflows' APK glob matches $glob files"

  local aab
  aab=$(find "$AAB_DIR" -type f -name '*.aab')
  "$KEYTOOL" -printcert -jarfile "$aab" 2>&1 | tr -d '\r' | grep -q 'CN=Harness Release' \
    || fail "the AAB is not signed by the release-like key"

  ms=$(tr -d '\r' < "$LOG" | sed -n 's/^Re-signed .* with the key-rotation lineage in \([0-9]*\) ms\.$/\1/p' | tail -n1)
  note "re-sign time: ${ms:-?} ms"
  [ -n "$ms" ] && [ "$ms" -le "$MAX_RESIGN_MS" ] || fail "re-sign time ${ms:-unknown} ms exceeds $MAX_RESIGN_MS ms"
}

case_pass() {
  start_case pass
  local envs=()
  mapfile -t envs < <(harness_env)
  build_and_verify "${envs[@]}"
  end_case
}

# Prints the run: block of the step named $2 in workflow $1, dedented, with
# ${{ secrets.NAME }} replaced by $NAME (exported by the caller).
step_script() {
  awk -v want="$2" '
    { sub(/\r$/, "") }
    /^[[:space:]]*- name:/ { name = $0; sub(/^[[:space:]]*- name:[[:space:]]*/, "", name); inrun = 0; instep = (name == want); next }
    instep && /^[[:space:]]*run: \|/ { inrun = 1; match($0, /^[[:space:]]*/); indent = RLENGTH; next }
    instep && inrun {
      if ($0 ~ /^[[:space:]]*$/) { print ""; next }
      match($0, /^[[:space:]]*/)
      if (RLENGTH <= indent) { inrun = 0; instep = 0; next }
      print substr($0, indent + 3)
    }
  ' "$1" | sed -E 's/\$\{\{[[:space:]]*secrets\.([A-Z0-9_]+)[[:space:]]*\}\}/${\1}/g'
}

case_workflow_steps() {
  start_case workflow-steps
  local wf decode export_step dir pass_envs=() line
  local -A h=()
  while IFS= read -r line; do h[${line%%=*}]=${line#*=}; done < <(harness_env)
  for wf in manual-release release-on-tag; do
    decode="Decode keystore"; export_step="Write signing properties"
    dir="$LOGS/workflow-$wf"; rm -rf "$dir"; mkdir -p "$dir"
    step_script "$REPO_DIR/.github/workflows/$wf.yml" "$decode" > "$dir/decode.sh"
    step_script "$REPO_DIR/.github/workflows/$wf.yml" "$export_step" > "$dir/export.sh"
    [ -s "$dir/decode.sh" ] && [ -s "$dir/export.sh" ] || { fail "$wf: decode or export step not found"; continue; }
    note "--- $wf decode step"; cat "$dir/decode.sh" >> "$LOG"
    note "--- $wf export step"; cat "$dir/export.sh" >> "$LOG"
    : > "$dir/github.env"
    (
      cd "$dir"
      export GITHUB_ENV="$dir/github.env"
      export SIGNING_STORE_FILE_B64; SIGNING_STORE_FILE_B64=$(base64 -w0 < "${h[SIGNING_STORE_FILE]}")
      export DEBUG_KEYSTORE_B64; DEBUG_KEYSTORE_B64=$(base64 -w0 < "${h[SIGNING_DEBUG_STORE_FILE]}")
      export SIGNING_STORE_PASSWORD="${h[SIGNING_STORE_PASSWORD]}" SIGNING_KEY_ALIAS="${h[SIGNING_KEY_ALIAS]}" SIGNING_KEY_PASSWORD="${h[SIGNING_KEY_PASSWORD]}"
      # GitHub Actions runs bash steps as `bash -eo pipefail`.
      bash -eo pipefail decode.sh && bash -eo pipefail export.sh
    ) >> "$LOG" 2>&1 || fail "$wf: the decode or export step failed"
    cmp -s "$dir/keystore.jks" "${h[SIGNING_STORE_FILE]}" || fail "$wf: keystore.jks differs from the harness release keystore"
    cmp -s "$dir/debug.keystore" "${h[SIGNING_DEBUG_STORE_FILE]}" || fail "$wf: debug.keystore differs from the harness debug keystore"
    grep -qx "SIGNING_DEBUG_STORE_FILE=$dir/debug.keystore" "$dir/github.env" || fail "$wf: SIGNING_DEBUG_STORE_FILE not exported"
    note "--- $wf exported names: $(sed 's/=.*//' "$dir/github.env" | tr '\n' ' ')"
    # Caught: an empty debug-keystore secret stops the decode step.
    if (cd "$dir" && SIGNING_STORE_FILE_B64=$(base64 -w0 < "${h[SIGNING_STORE_FILE]}") DEBUG_KEYSTORE_B64='' \
        bash -eo pipefail decode.sh) > "$dir/empty.out" 2>&1; then
      fail "$wf: the decode step passed with an empty DEBUG_KEYSTORE_B64"
    fi
    grep -q 'DEBUG_KEYSTORE_B64 is empty' "$dir/empty.out" || fail "$wf: no message for an empty DEBUG_KEYSTORE_B64"
    cat "$dir/empty.out" >> "$LOG"
  done
  # Build through what manual-release exported. The committed lineage belongs to
  # the real keys, so the harness lineage stands in for it.
  if [ "$CASE_OK" = 1 ]; then
    mapfile -t pass_envs < "$LOGS/workflow-manual-release/github.env"
    pass_envs+=("SIGNING_LINEAGE_FILE=${h[SIGNING_LINEAGE_FILE]}")
    build_and_verify "${pass_envs[@]}"
  fi
  rm -rf "$LOGS/workflow-manual-release" "$LOGS/workflow-release-on-tag"
  end_case
}

case_emulator_artifacts() {
  start_case emulator-artifacts
  gradle_with -- :app:assembleDebug || fail "assembleDebug failed"
  local debug_apk="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk" out="$HARNESS/app-debug-harness.apk"
  if [ -f "$debug_apk" ]; then
    "$APKSIGNER" sign --ks "$HARNESS/debug-like.keystore" --ks-key-alias androiddebugkey \
      --ks-pass pass:android --key-pass pass:android --out "$out" "$debug_apk" >> "$LOG" 2>&1 || fail "signing the debug APK failed"
    "$APKSIGNER" verify --print-certs "$out" 2>&1 | tr -d '\r' | grep -q 'CN=Harness Debug' || fail "$out is not signed by the debug-like key"
    rm -f "$out.idsig"
    note "wrote $out"
  else
    fail "no $debug_apk"
  fi
  end_case
}

# ---- main ----
cases=("$@")
[ ${#cases[@]} -gt 0 ] && [ "${cases[0]}" != all ] || cases=(caught-store caught-lineage-missing caught-lineage-corrupt caught-lineage-mismatch workflow-steps pass emulator-artifacts)

refuse_local_signing
start_case setup
gradle_with -- clean :app:generateSigningHarness || fail "clean or generateSigningHarness failed"
[ -f "$HARNESS/harness.env" ] || fail "no harness.env"
head -c 200 "$HARNESS/harness.lineage" > "$HARNESS/corrupt.lineage" 2>/dev/null || true
end_case
[ "$FAILED" = 0 ] || exit 1

for c in "${cases[@]}"; do
  case $c in
    caught-store) case_caught_store ;;
    caught-lineage-missing) case_caught_lineage caught-lineage-missing "$HARNESS/missing.lineage" "Missing: SIGNING_LINEAGE_FILE" ;;
    caught-lineage-corrupt) case_caught_lineage caught-lineage-corrupt "$HARNESS/corrupt.lineage" "the APK was deleted" ;;
    caught-lineage-mismatch) case_caught_lineage caught-lineage-mismatch "$HARNESS/other.lineage" "the APK was deleted" ;;
    workflow-steps) case_workflow_steps ;;
    pass) case_pass ;;
    emulator-artifacts) case_emulator_artifacts ;;
    *) echo "Unknown case: $c" >&2; exit 2 ;;
  esac
done

if [ "$FAILED" = 0 ]; then echo "All cases passed."; else echo "Some cases failed; logs in $LOGS."; exit 1; fi
