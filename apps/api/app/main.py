from datetime import UTC, datetime

from fastapi import FastAPI

from app.config import get_settings
from app.routers import (
    admin,
    billing,
    chat,
    dashboards,
    datasets,
    me,
    share,
    sheets,
    tenant_probe,
    workspaces,
)
from app.services.observability import install as install_observability

settings = get_settings()

app = FastAPI(
    title="Prism API",
    version="0.0.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
)

install_observability(app)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "api",
        "env": settings.app_env,
        "timestamp": datetime.now(UTC).isoformat(),
    }


app.include_router(me.router)
app.include_router(tenant_probe.router)
app.include_router(datasets.router)
app.include_router(dashboards.router)
app.include_router(chat.router)
app.include_router(sheets.router)
app.include_router(billing.router)
app.include_router(share.router)
app.include_router(workspaces.router)
app.include_router(admin.router)
