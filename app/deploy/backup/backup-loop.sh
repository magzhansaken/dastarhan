#!/bin/sh
# Бэкап каждые 6ч + ротация 14 дней. Проверка: файл не пустой.
set -eu
while true; do
  ts=$(date +%Y%m%d_%H%M%S)
  f="/backup/dastarhan_${ts}.sql.gz"
  pg_dump -h postgres -U "${DB_USER:-dastarhan}" "${DB_NAME:-dastarhan}" | gzip > "$f"
  if [ ! -s "$f" ]; then
    echo "ОШИБКА: бэкап пуст!" >&2
    rm -f "$f"
  else
    echo "бэкап ок: $f ($(du -h "$f" | cut -f1))"
  fi
  find /backup -name 'dastarhan_*.sql.gz' -mtime +14 -delete
  sleep 21600
done
