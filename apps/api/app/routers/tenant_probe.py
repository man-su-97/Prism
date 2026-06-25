from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps.auth import Principal, principal, tenant_session

router = APIRouter(prefix="/api/tenant-probe", tags=["tenant-probe"])


class ProbeRow(BaseModel):
    id: str
    org_id: str
    note: str


class CreateProbe(BaseModel):
    note: str


@router.get("", response_model=list[ProbeRow])
async def list_probes(session: AsyncSession = Depends(tenant_session)) -> list[ProbeRow]:
    """List rows visible to the caller's org. RLS does the filtering."""
    result = await session.execute(text("SELECT id, org_id, note FROM tenant_probe ORDER BY created_at DESC"))
    return [ProbeRow(id=str(r.id), org_id=r.org_id, note=r.note) for r in result]


@router.post("", response_model=ProbeRow, status_code=201)
async def create_probe(
    body: CreateProbe,
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> ProbeRow:
    """Insert a probe row. RLS WITH CHECK enforces org_id = current org."""
    result = await session.execute(
        text(
            "INSERT INTO tenant_probe (org_id, note) VALUES (:org, :note) "
            "RETURNING id, org_id, note"
        ),
        {"org": p.org_id, "note": body.note},
    )
    row = result.one()
    return ProbeRow(id=str(row.id), org_id=row.org_id, note=row.note)
