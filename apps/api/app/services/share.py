"""Signed view-only share links for dashboards.

Token shape: HS256 JWT with `{aud: "share", sub: dashboard_id, org_id, jti?, exp?}`.
- Verification is stateless on the JWT itself.
- `jti` (set since migration 20260514_0001) names a `dashboard_shares` row;
  callers that want revocation should pass the claim's `jti` to a DB lookup
  and reject when the row is missing or `revoked_at` is set.
- Tokens minted before `jti` existed have no row to revoke; they keep
  validating until they expire or `SHARE_LINK_SECRET` is rotated.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from jose import JWTError, jwt


def _secret() -> str:
    s = os.getenv("SHARE_LINK_SECRET") or os.getenv("BACKEND_JWT_SECRET", "")
    if not s:
        raise InvalidShareToken("share link secret not configured")
    return s


class InvalidShareToken(ValueError):
    """Raised when a share token fails to validate."""


@dataclass(frozen=True)
class ShareClaims:
    dashboard_id: str
    org_id: str
    expires_at: datetime | None
    jti: str | None


def mint(
    dashboard_id: str,
    org_id: str,
    ttl_hours: int | None = None,
    jti: str | None = None,
) -> str:
    payload: dict[str, Any] = {
        "aud": "share",
        "sub": dashboard_id,
        "org_id": org_id,
        "iat": int(datetime.now(UTC).timestamp()),
    }
    if jti is not None:
        payload["jti"] = jti
    if ttl_hours is not None:
        if ttl_hours <= 0 or ttl_hours > 24 * 365:
            raise InvalidShareToken("ttl_hours out of range")
        exp = datetime.now(UTC) + timedelta(hours=ttl_hours)
        payload["exp"] = int(exp.timestamp())
    return jwt.encode(payload, _secret(), algorithm="HS256")


def verify(token: str) -> ShareClaims:
    try:
        payload = jwt.decode(
            token,
            _secret(),
            algorithms=["HS256"],
            audience="share",
            options={"require": ["sub", "org_id"]},
        )
    except JWTError as exc:
        raise InvalidShareToken(str(exc)) from exc

    sub = payload.get("sub")
    org = payload.get("org_id")
    exp = payload.get("exp")
    jti = payload.get("jti")
    if not isinstance(sub, str) or not isinstance(org, str):
        raise InvalidShareToken("invalid_claims")
    expires_at: datetime | None = None
    if exp is not None:
        try:
            expires_at = datetime.fromtimestamp(int(exp), tz=UTC)
        except (TypeError, ValueError) as exc:
            raise InvalidShareToken("bad_exp") from exc
    if jti is not None and not isinstance(jti, str):
        raise InvalidShareToken("bad_jti")
    return ShareClaims(
        dashboard_id=sub,
        org_id=org,
        expires_at=expires_at,
        jti=jti,
    )
