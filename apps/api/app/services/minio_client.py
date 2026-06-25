import logging
from datetime import timedelta
from functools import lru_cache

from minio import Minio
from minio.deleteobjects import DeleteObject
from minio.error import S3Error

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

_PRESIGN_TTL = timedelta(minutes=15)
# Pin a region on the client so `presigned_*_object` doesn't try to phone the
# server for the bucket's region. The public client points at a hostname the
# browser can reach (e.g. `localhost:9000`) but the api container itself
# cannot — letting minio-py round-trip for region discovery hangs or fails.
_REGION = "us-east-1"


@lru_cache(maxsize=1)
def client() -> Minio:
    """Server-side client; talks to the internal docker hostname."""
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
        region=_REGION,
    )


@lru_cache(maxsize=1)
def public_client() -> Minio:
    """Used only to mint presigned URLs the browser can reach."""
    return Minio(
        settings.minio_public_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_public_secure,
        region=_REGION,
    )


def ensure_bucket() -> None:
    c = client()
    if not c.bucket_exists(settings.minio_bucket):
        c.make_bucket(settings.minio_bucket)


def presign_put(object_key: str, content_type: str | None = None) -> str:
    return public_client().presigned_put_object(
        settings.minio_bucket,
        object_key,
        expires=_PRESIGN_TTL,
    )


def presign_get(object_key: str) -> str:
    return public_client().presigned_get_object(
        settings.minio_bucket,
        object_key,
        expires=_PRESIGN_TTL,
    )


def stat_object(object_key: str) -> int | None:
    try:
        return client().stat_object(settings.minio_bucket, object_key).size
    except S3Error:
        return None


def fget_object(object_key: str, local_path: str) -> None:
    client().fget_object(settings.minio_bucket, object_key, local_path)


def remove_object(object_key: str) -> None:
    try:
        client().remove_object(settings.minio_bucket, object_key)
    except S3Error as exc:
        # Treat 404 as success — the caller wants the object gone, and it is.
        logger.warning("minio remove_object(%s) failed: %s", object_key, exc)


def remove_prefix(prefix: str) -> int:
    """Delete every object whose key starts with `prefix`. Returns the count.

    Used for org tear-down: ``remove_prefix(f"{org_id}/")`` flushes parquet
    files and any orphan upload-staging blobs in one sweep.
    """
    c = client()
    targets = [
        DeleteObject(obj.object_name)
        for obj in c.list_objects(
            settings.minio_bucket, prefix=prefix, recursive=True
        )
    ]
    if not targets:
        return 0
    # remove_objects returns a lazy iterator of errors — iterate to drive it.
    for err in c.remove_objects(settings.minio_bucket, targets):
        logger.warning("minio remove_prefix(%s) error: %s", prefix, err)
    return len(targets)
