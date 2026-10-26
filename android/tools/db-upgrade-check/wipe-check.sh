#!/usr/bin/env bash
# Emulator helpers for checking the "Clear data" wipe and the sync-failure row.
#
#   wipe-check.sh snapshot     <emulator-serial> <out-dir> <label>
#       Writes <out-dir>/<label>.txt: the row count of every local table, the number of
#       unsynced changes (rows whose current version Firestore has not confirmed), the
#       number of articles skipped after 3 failed sync runs, and a listing of the archive
#       folder (files/archives).
#   wipe-check.sh seed-archive <emulator-serial> <itemId>
#       Writes one gzipped archive file at files/archives/<itemId>/readability.gz and its
#       local_archive row, the same layout the archive download uses.
#   wipe-check.sh strike       <emulator-serial> <n>
#       Marks the <n> newest live articles as skipped after 3 failed sync runs.
#
# Every mode force-stops the app before it reads or writes the database. Only emulators are
# accepted, and the app must be a debug build (run-as). Needs sqlite3 on PATH.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # keep device paths intact under Git Bash on Windows

usage() {
  echo "usage: $0 snapshot <emulator-serial> <out-dir> <label>" >&2
  echo "       $0 seed-archive <emulator-serial> <itemId>" >&2
  echo "       $0 strike <emulator-serial> <n>" >&2
  exit 2
}

[ $# -ge 3 ] || usage
mode=$1 serial=$2
case "$serial" in
  emulator-*) ;;
  *) echo "refusing $serial: only an emulator serial (emulator-NNNN) is accepted" >&2; exit 2 ;;
esac
command -v sqlite3 >/dev/null || { echo "sqlite3 is not on PATH" >&2; exit 2; }

pkg=com.jayteealao.trails
tables="article article_tags article_images article_authors article_videos local_archive DomainMetadata"
dev() { adb -s "$serial" "$@"; }

# Working copies live in a folder beside the script's output (or the current folder): a
# native sqlite3 on Windows cannot open /tmp paths.
# Under Git Bash, `pwd -W` gives the C:/... form that a native sqlite3 can open.
work_root=${WIPE_CHECK_WORK:-$(pwd -W 2>/dev/null || pwd)}
work="$work_root/.wipe-check-work"
# The sync stamp and the strike counter live in sync_state; a missing row means never
# backed up and no strikes.
synced_rows='article AS a LEFT JOIN sync_state AS s ON s.itemId = a.itemId'
skipped_count='SELECT COUNT(*) FROM sync_state AS s WHERE s.sync_failures >= 3
  AND EXISTS (SELECT 1 FROM article AS a WHERE a.itemId = s.itemId);'
mkdir -p "$work"
trap 'rm -rf "$work"' EXIT

stop_app() { dev shell am force-stop "$pkg"; }

pull_db() { # -> $work/Pocket with the write-ahead log folded in; returns 1 when absent
  rm -f "$work"/Pocket*
  for f in Pocket Pocket-wal Pocket-shm; do
    if dev shell run-as "$pkg" ls "databases/$f" >/dev/null 2>&1; then
      dev exec-out run-as "$pkg" cat "databases/$f" >"$work/$f"
    fi
  done
  [ -s "$work/Pocket" ] || return 1
  sqlite3 "$work/Pocket" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
}

push_db() { # $work/Pocket -> the app's database, dropping the stale write-ahead log
  dev push "$work/Pocket" /data/local/tmp/trails-wipe-check.db >/dev/null
  dev shell chmod 644 /data/local/tmp/trails-wipe-check.db
  dev shell run-as "$pkg" sh -c "'cat /data/local/tmp/trails-wipe-check.db > databases/Pocket && rm -f databases/Pocket-wal databases/Pocket-shm'"
  dev shell rm -f /data/local/tmp/trails-wipe-check.db
}

case "$mode" in
  snapshot)
    [ $# -eq 4 ] || usage
    out=$3 label=$4
    mkdir -p "$out"
    stop_app
    {
      if pull_db; then
        for t in $tables; do
          echo "$t $(sqlite3 "$work/Pocket" "SELECT COUNT(*) FROM $t;")"
        done
        echo "unsynced $(sqlite3 "$work/Pocket" "SELECT COUNT(*) FROM $synced_rows
          WHERE s.backed_up_at IS NULL OR a.timeUpdated > s.backed_up_at;")"
        echo "skipped $(sqlite3 "$work/Pocket" "$skipped_count")"
      else
        echo "database absent"
      fi
      echo "archives:"
      dev shell run-as "$pkg" ls -R files/archives 2>&1 | tr -d '\r' || true
    } >"$out/$label.txt"
    cat "$out/$label.txt"
    ;;
  seed-archive)
    [ $# -eq 3 ] || usage
    item=$3
    case "$item" in
      *[!A-Za-z0-9_-]*) echo "itemId may hold only letters, digits, - and _" >&2; exit 2 ;;
    esac
    stop_app
    pull_db || { echo "no database on the device; open the app once first" >&2; exit 1; }
    printf '# Seeded archive\n\nWritten by wipe-check.sh.\n' | gzip -c >"$work/readability.gz"
    size=$(wc -c <"$work/readability.gz" | tr -d ' ')
    dev push "$work/readability.gz" /data/local/tmp/trails-wipe-check.gz >/dev/null
    dev shell chmod 644 /data/local/tmp/trails-wipe-check.gz
    dev shell run-as "$pkg" sh -c "'mkdir -p files/archives/$item && cat /data/local/tmp/trails-wipe-check.gz > files/archives/$item/readability.gz'"
    dev shell rm -f /data/local/tmp/trails-wipe-check.gz
    now=$(($(date +%s) * 1000))
    sqlite3 "$work/Pocket" "INSERT OR REPLACE INTO local_archive (itemId, archiveKey, localPath, compressedSizeBytes, originalSizeBytes, downloadedAt, status) VALUES ('$item', 'readability', 'archives/$item/readability.gz', $size, 45, $now, 'complete');"
    push_db
    echo "seeded files/archives/$item/readability.gz and its local_archive row"
    ;;
  strike)
    [ $# -eq 3 ] || usage
    n=$3
    case "$n" in
      '' | *[!0-9]*) echo "n must be a whole number" >&2; exit 2 ;;
    esac
    stop_app
    pull_db || { echo "no database on the device; open the app once first" >&2; exit 1; }
    # The strike lives in sync_state (one row per article with a stamp or a strike).
    sqlite3 "$work/Pocket" "INSERT INTO sync_state (itemId, sync_failures)
      SELECT itemId, 3 FROM article WHERE deleted_at IS NULL ORDER BY timeAdded DESC LIMIT $n
      ON CONFLICT(itemId) DO UPDATE SET sync_failures = 3;"
    push_db
    echo "skipped articles now: $(sqlite3 "$work/Pocket" "$skipped_count")"
    ;;
  *)
    usage
    ;;
esac
