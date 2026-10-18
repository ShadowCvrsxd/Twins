#!/bin/sh
# ponytail: дневной бэкап kv-базы + JSON-фолбэка; хранит последние 14 копий базы
set -eu
cd "$(dirname "$0")/.."
BACKUP_DIR=backups
mkdir -p "$BACKUP_DIR"
ts=$(date +%Y%m%d-%H%M%S)
if [ -f twins.db ]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 twins.db ".backup '$BACKUP_DIR/twins.db.$ts'"
  else
    cp twins.db "$BACKUP_DIR/twins.db.$ts"
  fi
fi
[ -f twins_store.json ] && cp twins_store.json "$BACKUP_DIR/twins_store.json.$ts"
# ponytail: O(n) хвост за раз — объём копий конечен (14), сортированный ls дёшев
ls -1t "$BACKUP_DIR"/twins.db.* 2>/dev/null | tail -n +15 | xargs -r rm --
ls -1t "$BACKUP_DIR"/twins_store.json.* 2>/dev/null | tail -n +15 | xargs -r rm --
echo "[Backup] OK: $ts"
