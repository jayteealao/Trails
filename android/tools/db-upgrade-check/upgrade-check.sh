#!/usr/bin/env bash
# Checks that a library saved by an older build survives an update to a newer build.
#
#   upgrade-check.sh <emulator-serial> <old.apk> <new.apk> <out-dir> [search-word] [expected-version]
#
# 1. Installs the old APK on an emulator that does not have the app, opens it once and
#    enters the local library ("Skip Login"), so the old build creates its database.
# 2. Pulls the database, seeds it on the host with seed-v7-library.sql (needs sqlite3 on
#    PATH) and pushes it back.
# 3. Records the row count of every table and the search result for one title word
#    -> <out-dir>/before.counts.txt, and the schema version -> <out-dir>/before.version.txt.
# 4. Installs the new APK over the old one, opens it, captures the list and the search
#    screen, then records the same numbers again -> <out-dir>/after.counts.txt and
#    <out-dir>/after.version.txt.
# The search line lists the ids that match the word, with the query that fits the file:
# the FTS4 index (below version 10) or the FTS5 index (version 10 and later).
# Exits 0 only when the before version is 7, the after version equals expected-version
# (default 10), and the before and after counts-and-search records are identical.
#
# Only emulators are accepted: the script installs, seeds and force-stops the app.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # keep device paths intact under Git Bash on Windows

if [ $# -lt 4 ]; then
  echo "usage: $0 <emulator-serial> <old.apk> <new.apk> <out-dir> [search-word] [expected-version]" >&2
  exit 2
fi
serial=$1 old_apk=$2 new_apk=$3 out=$4 word=${5:-roses} expected_version=${6:-10}
case "$serial" in
  emulator-*) ;;
  *) echo "refusing $serial: only an emulator serial (emulator-NNNN) is accepted" >&2; exit 2 ;;
esac
command -v sqlite3 >/dev/null || { echo "sqlite3 is not on PATH" >&2; exit 2; }

pkg=com.jayteealao.trails
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
# Working copies live under <out-dir>: a native sqlite3 on Windows cannot open /tmp paths.
work="$out/work"
mkdir -p "$work"
trap 'rm -rf "$work"' EXIT

dev() { adb -s "$serial" "$@"; }

launch() {
  dev shell am start -W -n "$pkg/.MainActivity" >/dev/null
  sleep 4
}

# Taps the first on-screen element whose text or content description matches $1.
tap() {
  local node bounds x1 y1 x2 y2
  node=$(dev exec-out uiautomator dump /dev/tty 2>/dev/null | grep -o '<node [^>]*>' |
    grep -iE "(text|content-desc)=\"[^\"]*$1" | head -1) || true
  [ -n "$node" ] || return 1
  bounds=$(echo "$node" | grep -o 'bounds="[^"]*"' | tr -c '0-9\n' ' ')
  read -r x1 y1 x2 y2 <<<"$bounds"
  dev shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2))
  sleep 2
}

pull_db() { # -> $work/Pocket, with the write-ahead log folded in
  rm -f "$work"/Pocket*
  for f in Pocket Pocket-wal Pocket-shm; do
    if dev shell run-as "$pkg" ls "databases/$f" >/dev/null 2>&1; then
      dev exec-out run-as "$pkg" cat "databases/$f" >"$work/$f"
    fi
  done
  [ -s "$work/Pocket" ] || { echo "no database file on the device" >&2; exit 1; }
  sqlite3 "$work/Pocket" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
}

record() { # $1 = side (before or after)
  local version ids
  version=$(sqlite3 "$work/Pocket" 'PRAGMA user_version;')
  echo "$version" >"$out/$1.version.txt"
  if [ "$version" -ge 10 ]; then
    ids=$(sqlite3 "$work/Pocket" "SELECT group_concat(itemId, ',') FROM (SELECT article.itemId FROM article_fts JOIN article ON article.rowid = article_fts.rowid WHERE article_fts MATCH '\"$word\"' ORDER BY article.itemId);")
  else
    ids=$(sqlite3 "$work/Pocket" "SELECT group_concat(itemId, ',') FROM (SELECT article.itemId FROM article JOIN article_fts ON article.itemId = article_fts.itemId WHERE article_fts MATCH '*\"*$word*\"*' ORDER BY article.itemId);")
  fi
  {
    for t in article article_tags article_images article_authors article_videos local_archive DomainMetadata; do
      echo "$t $(sqlite3 "$work/Pocket" "SELECT COUNT(*) FROM $t;")"
    done
    echo "search \"$word\": $ids"
  } >"$out/$1.counts.txt"
}

if dev shell pm list packages | grep -qx "package:$pkg"; then
  echo "$pkg is already installed on $serial; use an emulator without it" >&2
  exit 2
fi

echo "1/4 install the old build and let it create its database"
dev install "$old_apk" >/dev/null
launch
tap "Skip Login" || echo "  (no Skip Login button; continuing)"
sleep 3
dev shell am force-stop "$pkg"

echo "2/4 seed the library"
pull_db
sqlite3 "$work/Pocket" <"$here/seed-v7-library.sql"
dev push "$work/Pocket" /data/local/tmp/trails-seeded.db >/dev/null
dev shell chmod 644 /data/local/tmp/trails-seeded.db
dev shell run-as "$pkg" sh -c "'cat /data/local/tmp/trails-seeded.db > databases/Pocket && rm -f databases/Pocket-wal databases/Pocket-shm'"
dev shell rm -f /data/local/tmp/trails-seeded.db

echo "3/4 record the library before the update"
pull_db
record before
echo "user_version $(cat "$out/before.version.txt")"
cat "$out/before.counts.txt"

echo "4/4 install the new build over it"
dev install -r "$new_apk" >/dev/null
dev logcat -c
launch
tap "Skip Login" || true
sleep 3
dev exec-out screencap -p >"$out/list.png"
if tap "[Ss]earch"; then
  dev shell input text "$word"
  dev shell input keyevent 66 # search runs on submit
  sleep 4
  dev exec-out screencap -p >"$out/search.png"
else
  echo "  (no search control found on screen; search.png not captured)"
fi
pid=$(dev shell pidof "$pkg" | tr -d '\r' || true)
if [ -n "$pid" ]; then dev logcat -d '*:E' --pid="$pid" >"$out/logcat.txt"; else dev logcat -d '*:E' >"$out/logcat.txt"; fi
dev shell am force-stop "$pkg"
pull_db
record after
echo "user_version $(cat "$out/after.version.txt")"
cat "$out/after.counts.txt"

before_version=$(cat "$out/before.version.txt") after_version=$(cat "$out/after.version.txt")
if [ "$before_version" != 7 ]; then
  echo "FAIL: the old build left schema version $before_version, expected 7" >&2
  exit 1
fi
if [ "$after_version" != "$expected_version" ]; then
  echo "FAIL: the new build left schema version $after_version, expected $expected_version" >&2
  exit 1
fi
if diff -u "$out/before.counts.txt" "$out/after.counts.txt"; then
  echo "PASS: schema version 7 -> $after_version; every count and the search result are unchanged"
else
  echo "FAIL: the library changed across the update" >&2
  exit 1
fi
