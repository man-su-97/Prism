from collections.abc import AsyncIterator
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import SessionFactory

settings = get_settings()

JWT_ALG = "HS256"


@dataclass(frozen=True)
class Principal:
    user_id: str
    org_id: str


@dataclass(frozen=True)
class UserPrincipal:
    """Identity-only principal for endpoints that span multiple workspaces
    (e.g. account-teardown). No `org_id` claim required.
    """

    user_id: str


def _decode(token: str) -> Principal:
    try:
        payload = jwt.decode(
            token,
            settings.backend_jwt_secret,
            algorithms=[JWT_ALG],
            options={"require": ["exp", "sub", "org_id"]},
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
        ) from exc

    # Share tokens carry aud="share" and are signed with SHARE_LINK_SECRET
    # (which may equal BACKEND_JWT_SECRET when the env var is unset). Reject
    # any token that carries an aud claim so a share link can never be used
    # as an API bearer token to gain full tenant access.
    if payload.get("aud") is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_claims",
        )

    user_id = payload.get("sub")
    org_id = payload.get("org_id")
    if not isinstance(user_id, str) or not isinstance(org_id, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_claims",
        )
    return Principal(user_id=user_id, org_id=org_id)


def _decode_user_only(token: str) -> UserPrincipal:
    try:
        payload = jwt.decode(
            token,
            settings.backend_jwt_secret,
            algorithms=[JWT_ALG],
            options={"require": ["exp", "sub"]},
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
        ) from exc

    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_claims",
        )
    return UserPrincipal(user_id=user_id)


async def principal(
    authorization: str | None = Header(default=None),
) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing_bearer",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.split(" ", 1)[1].strip()
    return _decode(token)


async def principal_user_only(
    authorization: str | None = Header(default=None),
) -> UserPrincipal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing_bearer",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.split(" ", 1)[1].strip()
    return _decode_user_only(token)


async def tenant_session(
    p: Principal = Depends(principal),
) -> AsyncIterator[AsyncSession]:
    """Yield a session with `app.org_id` set for the lifetime of one txn.

    RLS policies key off `current_setting('app.org_id')::uuid`, so every
    request that touches tenant tables MUST go through this dep.
    """
    async with SessionFactory() as session:
        try:
            await session.execute(
                text("SELECT set_config('app.org_id', :org, true)"),
                {"org": p.org_id},
            )
            await session.execute(
                text("SELECT set_config('app.user_id', :uid, true)"),
                {"uid": p.user_id},
            )
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@dataclass(frozen=True)
class SuperAdminPrincipal:
    """Identity for the read-only super-admin portal. Not org-scoped."""

    user_id: str
    email: str


async def require_super_admin(
    authorization: str | None = Header(default=None),
) -> SuperAdminPrincipal:
    """Gate /api/admin/* on the SUPERADMIN_EMAILS allowlist.

    Every failure path returns 404, not 401/403 — the portal must not
    reveal its own existence to non-admin callers (including signed-in
    users with the wrong email).
    """
    not_found = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_found")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise not_found
    try:
        up = _decode_user_only(authorization.split(" ", 1)[1].strip())
    except HTTPException as exc:
        raise not_found from exc

    allow = settings.superadmin_email_set()
    if not allow:
        raise not_found

    async with SessionFactory() as session:
        row = (
            await session.execute(
                text('SELECT email FROM "user" WHERE id = :uid'),
                {"uid": up.user_id},
            )
        ).first()
    if row is None:
        raise not_found
    email = (row.email or "").lower()
    if email not in allow:
        raise not_found
    return SuperAdminPrincipal(user_id=up.user_id, email=email)


async def admin_session(
    p: SuperAdminPrincipal = Depends(require_super_admin),
) -> AsyncIterator[AsyncSession]:
    """Yield a session with `app.is_admin='true'` for the lifetime of one txn.

    The bypass policy added in migration 20260514_0003 unlocks SELECT
    across every tenant table when this GUC is set. Endpoints that only
    read non-RLS tables (user/organization/member/session) can depend on
    `require_super_admin` directly without going through this session.
    """
    async with SessionFactory() as session:
        try:
            await session.execute(
                text("SELECT set_config('app.is_admin', 'true', true)")
            )
            await session.execute(
                text("SELECT set_config('app.user_id', :uid, true)"),
                {"uid": p.user_id},
            )
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
