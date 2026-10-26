#!/usr/bin/env bash
# Emulator helpers for checking the two-word search on a version 10 (FTS5) build.
#
#   search-check.sh <emulator-serial> <out-dir> seed
#       Force-stops the app, pulls its database, applies seed-search-corpus.sql on the host
#       (needs sqlite3 with FTS5 on PATH), runs the FTS5 integrity check and pushes the
#       database back. Writes <out-dir>/seed.txt with the article and index row counts.
#   search-check.sh <emulator-serial> <out-dir> expect [words...]
#       Pulls the database and writes <out-dir>/expect.txt: the number of rows the app shows
#       for the search (every live match, capped at 100) and the top 10 titles, best first by
#       bm25, from the same query the app runs. The words default to "harbor lantern".
#   search-check.sh <emulator-serial> <out-dir> pull
#       Pulls the database and writes <out-dir>/pull.txt: the row count of every table and of
#       the search index, after the drive.
#
# Every mode force-stops the app before it reads or writes the database. Only emulators are
# accepted, and the app must be a debug build (run-as).
set -euo pipefail
export MSYS_NO_PATHCONV=1 # keep device paths intact under Git Bash on Windows

usage() {
  echo "usage: $0 <emulator-serial> <out-dir> seed|expect|pull [words...]" >&2
  exit 2
}

[ $# -ge 3 ] || usage
serial=$1 out=$2 mode=$3
shift 3
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
db() { sqlite3 "$work/Pocket" "$@"; }

pull_db() { # -> $work/Pocket, with the write-ahead log folded in
  dev shell am force-stop "$pkg"
  rm -f "$work"/Pocket*
  for f in Pocket Pocket-wal Pocket-shm; do
    if dev shell run-as "$pkg" ls "databases/$f" >/dev/null 2>&1; then
      dev exec-out run-as "$pkg" cat "databases/$f" >"$work/$f"
    fi
  done
  [ -s "$work/Pocket" ] || { echo "no database file on the device" >&2; exit 1; }
  db "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
  local version
  version=$(db 'PRAGMA user_version;')
  [ "$version" -ge 10 ] || { echo "schema version $version has no FTS5 search index; install a version 10 build" >&2; exit 1; }
}

push_db() {
  dev push "$work/Pocket" /data/local/tmp/trails-search.db >/dev/null
  dev shell chmod 644 /data/local/tmp/trails-search.db
  dev shell run-as "$pkg" sh -c "'cat /data/local/tmp/trails-search.db > databases/Pocket && rm -f databases/Pocket-wal databases/Pocket-shm'"
  dev shell rm -f /data/local/tmp/trails-search.db
}

counts() {
  for t in article article_tags article_images article_authors article_videos local_archive DomainMetadata; do
    echo "$t $(db "SELECT COUNT(*) FROM $t;")"
  done
  echo "live articles $(db 'SELECT COUNT(*) FROM article WHERE deleted_at IS NULL;')"
  echo "search index rows $(db 'SELECT COUNT(*) FROM article_fts_docsize;')"
}

case "$mode" in
  seed)
    pull_db
    db <"$here/seed-search-corpus.sql"
    # Raises an error (and stops the script) when the index does not match the articles.
    db "INSERT INTO article_fts(article_fts, rank) VALUES ('integrity-check', 1);"
    counts >"$out/seed.txt"
    push_db
    cat "$out/seed.txt"
    ;;
  expect)
    [ $# -gt 0 ] || set -- harbor lantern
    # The match string the app builds for plain words: each word quoted, joined with OR.
    match=""
    for w in "$@"; do
      [ -z "$match" ] || match="$match OR "
      match="$match\"${w//\"/\"\"}\""
    done
    sql_match=${match//\'/\'\'}
    pull_db
    from="FROM article_fts JOIN article ON article.rowid = article_fts.rowid WHERE article_fts MATCH '$sql_match' AND article.deleted_at IS NULL"
    {
      echo "match $match"
      echo "shown $(db "SELECT MIN(COUNT(*), 100) $from;") of $(db "SELECT COUNT(*) $from;") live matches"
      echo "deleted matches $(db "SELECT COUNT(*) FROM article_fts JOIN article ON article.rowid = article_fts.rowid WHERE article_fts MATCH '$sql_match' AND article.deleted_at IS NOT NULL;") (never shown)"
      echo "top 10 by bm25:"
      db "SELECT article.title $from ORDER BY bm25(article_fts) LIMIT 10;"
    } >"$out/expect.txt"
    cat "$out/expect.txt"
    ;;
  pull)
    pull_db
    counts >"$out/pull.txt"
    cat "$out/pull.txt"
    ;;
  *) usage ;;
esac
