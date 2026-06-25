from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = Field(default="local")
    log_level: str = Field(default="INFO")

    database_url: str = Field(
        default="postgresql+asyncpg://strata:strata@postgres:5432/strata",
    )
    redis_url: str = Field(default="redis://redis:6379/0")

    minio_endpoint: str = Field(default="minio:9000")
    minio_public_endpoint: str = Field(default="localhost:9000")
    minio_access_key: str = Field(default="strata")
    minio_secret_key: str = Field(default="strata-secret")
    minio_bucket: str = Field(default="strata")
    minio_secure: bool = Field(default=False)
    minio_public_secure: bool = Field(default=False)

    parquet_root: str = Field(default="/data/parquet")

    backend_jwt_secret: str = Field(default="dev-insecure-change-me")
    anthropic_api_key: str = Field(default="")

    # Comma-separated allowlist of emails that may access /api/admin/*.
    # Parsed as CSV (not list[str]) because pydantic-settings turns a CSV
    # env var into a one-element list unless a custom parser is wired —
    # CSV-string + helper matches the BETTER_AUTH_TRUSTED_ORIGINS shape.
    superadmin_emails: str = Field(default="")

    def superadmin_email_set(self) -> set[str]:
        return {
            e.strip().lower()
            for e in self.superadmin_emails.split(",")
            if e.strip()
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
