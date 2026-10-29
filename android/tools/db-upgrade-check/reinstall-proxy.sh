#!/usr/bin/env bash
# Stands in for "uninstall, reinstall, restore" while keeping the signed-in session.
#
#   reinstall-proxy.sh <emulator-serial> <out-dir>          wipe the local library
#   reinstall-proxy.sh <emulator-serial> --after <out-dir>  record it after the restore
#
# Wipe mode: stops the app, records every deleted article in the local database
# (<out-dir>/before-wipe.deleted.txt), deletes the database files and relaunches the
# app. The sign-in session in shared_prefs is kept, so the next sync restores the
# library from the backup through the same path a fresh install takes.
#
# After mode (run once the restore has finished): records the deleted articles again
# (<out-dir>/after-restore.deleted.txt) and the count of live articles
# (<out-dir>/after-restore.live-count.txt).
#
# Needs sqlite3 on PATH. Only emulators are accepted: the script deletes app data.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # keep device paths intact under Git Bash on Windows

usage() { echo "usage: $0 <emulator-serial> [--after] <out-dir>" >&2; exit 2; }
[ $# -ge 2 ] || usage
serial=$1
mode=wipe
if [ "$2" = "--after" ]; then
  [ $# -ge 3 ] || usage
  mode=after
  out=$3
else
  out=$2
fi
case "$serial" in
  emulator-*) ;;
  *) echo "refusing $serial: only an emulator serial (emulator-NNNN) is accepted" >&2; exit 2 ;;
esac
command -v sqlite3 >/dev/null || { echo "sqlite3 is not on PATH" >&2; exit 2; }

pkg=com.jayteealao.trails
mkdir -p "$out"
# Working copies live under <out-dir>: a native sqlite3 on Windows cannot open /tmp paths.
work="$out/work"
mkdir -p "$work"
trap 'rm -rf "$work"' EXIT

dev() { adb -s "$serial" "$@"; }

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

deleted_rows() {
  sqlite3 "$work/Pocket" "SELECT itemId, title, deleted_at FROM article WHERE deleted_at IS NOT NULL ORDER BY itemId;"
}

dev shell am force-stop "$pkg"
pull_db

if [ "$mode" = "after" ]; then
  deleted_rows >"$out/after-restore.deleted.txt"
  sqlite3 "$work/Pocket" "SELECT COUNT(*) FROM article WHERE deleted_at IS NULL;" >"$out/after-restore.live-count.txt"
  echo "deleted after the restore:"
  cat "$out/after-restore.deleted.txt"
  echo "live articles: $(cat "$out/after-restore.live-count.txt")"
  exit 0
fi

deleted_rows >"$out/before-wipe.deleted.txt"
echo "deleted before the wipe:"
cat "$out/before-wipe.deleted.txt"

dev shell run-as "$pkg" rm -f databases/Pocket databases/Pocket-wal databases/Pocket-shm
if dev shell run-as "$pkg" ls databases/Pocket >/dev/null 2>&1; then
  echo "the database file is still on the device" >&2
  exit 1
fi
echo "local library wiped; the sign-in session is kept"

dev shell am start -W -n "$pkg/.MainActivity" >/dev/null
echo "app relaunched: run the sync from Settings, then: $0 $serial --after $out"
