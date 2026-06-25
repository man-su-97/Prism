#!/usr/bin/env bash
set -euo pipefail

cd /app

# Migrations need to run as the table owner (strata) — they CREATE EXTENSION,
# CREATE TABLE, ALTER ROLE attributes, etc., and may grant on future tables
# via ALTER DEFAULT PRIVILEGES. The app itself connects as a less-privileged
# role (strata_app) so that ENABLE/FORCE ROW LEVEL SECURITY policies actually
# fire (RLS is bypassed for SUPERUSER and BYPASSRLS roles). MIGRATION_DATABASE_URL
# falls back to DATABASE_URL for local-only setups that haven't split roles.
echo "[entrypoint] running alembic migrations…"
DATABASE_URL="${MIGRATION_DATABASE_URL:-$DATABASE_URL}" alembic upgrade head

echo "[entrypoint] ensuring MinIO bucket…"
python -c "from app.services.minio_client import ensure_bucket; ensure_bucket()"

echo "[entrypoint] starting uvicorn"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
