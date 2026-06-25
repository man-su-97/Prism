#!/usr/bin/env bash
# Snapshot Postgres + MinIO + Parquet volume into a single dated tarball.
# Usage: ./infra/backup.sh [output_dir]
# Default output: ./backups/<UTC-date>/

set -euo pipefail

cd "$(dirname "$0")/.."

OUT_ROOT="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_ROOT/$STAMP"
mkdir -p "$OUT"

COMPOSE="docker compose -f infra/docker-compose.yml"

echo "[backup] target $OUT"

echo "[backup] dumping postgres…"
$COMPOSE exec -T postgres pg_dump -U strata -d strata --format=custom \
  > "$OUT/postgres.dump"

echo "[backup] archiving minio volume…"
$COMPOSE run --rm --no-deps --entrypoint sh -v "$PWD/$OUT:/out" minio \
  -c "cd /data && tar -czf /out/minio.tar.gz ."

echo "[backup] archiving parquet volume…"
$COMPOSE run --rm --no-deps --entrypoint sh -v "$PWD/$OUT:/out" api \
  -c "cd /data/parquet && tar -czf /out/parquet.tar.gz ."

echo "[backup] writing manifest…"
cat > "$OUT/manifest.json" <<JSON
{
  "created_at": "$STAMP",
  "components": ["postgres", "minio", "parquet"],
  "note": "Restore order: postgres → minio → parquet."
}
JSON

echo "[backup] done. Files in $OUT:"
ls -la "$OUT"
