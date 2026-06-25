from typing import ClassVar

from arq import cron
from arq.connections import RedisSettings

from app.config import get_settings
from app.services.ingest import ingest_dataset
from app.services.minio_client import ensure_bucket
from app.services.sheet_sync import enqueue_due_sheet_syncs, sync_sheet_dataset

settings = get_settings()


async def healthcheck(ctx: dict) -> dict:
    return {"status": "ok", "service": "worker"}


async def startup(ctx: dict) -> None:
    # Bucket needs to exist before any ingest job hits MinIO.
    ensure_bucket()


class WorkerSettings:
    functions: ClassVar[list] = [healthcheck, ingest_dataset, sync_sheet_dataset, enqueue_due_sheet_syncs]
    on_startup = startup
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    # Long-running ingestion shouldn't be killed mid-job.
    job_timeout = 60 * 30  # 30 min
    max_jobs = 4
    cron_jobs: ClassVar[list] = [
        # Every 15 minutes — picks up sheets that are due based on their per-row interval.
        cron(enqueue_due_sheet_syncs, minute={0, 15, 30, 45}, run_at_startup=False),
    ]
