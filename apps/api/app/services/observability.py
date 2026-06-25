"""Centralised observability wiring.

Three concerns, intentionally lazy:
- Structured JSON logs (always on; cheap)
- Sentry error reporting (only if `SENTRY_DSN` is set)
- Prometheus metrics at `/metrics` (only if the dep is installed)

Imports for optional deps live inside `install()` so a fresh check-out without
those packages still boots.
"""
from __future__ import annotations

import logging
import os
import sys
from typing import Any

from fastapi import FastAPI


def _configure_logging() -> None:
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    fmt = os.getenv("LOG_FORMAT", "json").lower()

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setLevel(level)

    if fmt == "json":
        try:
            from pythonjsonlogger.json import JsonFormatter  # type: ignore[import-not-found]

            handler.setFormatter(
                JsonFormatter(
                    fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
                    rename_fields={"levelname": "level", "asctime": "ts"},
                )
            )
        except ImportError:
            try:
                from pythonjsonlogger import jsonlogger  # type: ignore[import-not-found]

                handler.setFormatter(
                    jsonlogger.JsonFormatter(
                        fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
                        rename_fields={"levelname": "level", "asctime": "ts"},
                    )
                )
            except ImportError:
                handler.setFormatter(
                    logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
                )
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # Quiet down particularly chatty deps.
    for noisy in ("httpx", "httpcore", "watchfiles", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _install_sentry() -> bool:
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        return False
    try:
        import sentry_sdk
        from sentry_sdk.integrations.asgi import SentryAsgiMiddleware  # noqa: F401
        from sentry_sdk.integrations.logging import LoggingIntegration
    except ImportError:
        logging.getLogger(__name__).warning("SENTRY_DSN set but sentry-sdk not installed")
        return False

    sentry_sdk.init(
        dsn=dsn,
        environment=os.getenv("APP_ENV", "local"),
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.0")),
        profiles_sample_rate=float(os.getenv("SENTRY_PROFILES_SAMPLE_RATE", "0.0")),
        integrations=[
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
        send_default_pii=False,
    )
    return True


def _install_prometheus(app: FastAPI) -> bool:
    # prometheus-fastapi-instrumentator >=7.0.0 crashes on every request with
    # AttributeError: '_IncludedRouter' object has no attribute 'path' when
    # the app uses include_router. Disabled until the library ships a fix.
    return False


def install(app: FastAPI) -> dict[str, Any]:
    """Wire all three concerns and return what got enabled."""
    _configure_logging()
    sentry = _install_sentry()
    prom = _install_prometheus(app)
    logging.getLogger(__name__).info(
        "observability ready", extra={"sentry": sentry, "prometheus": prom}
    )
    return {"sentry": sentry, "prometheus": prom}
