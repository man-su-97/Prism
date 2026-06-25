"""Google Sheets + Drive client built on Better Auth's stored tokens.

We read access/refresh tokens from the `account` table that Better Auth
maintains on Postgres. Access tokens get refreshed against Google's OAuth
endpoint when they're within 60 seconds of expiry, and the new token is
written back encrypted so subsequent calls reuse it.

Token-at-rest encryption uses AES-256-GCM via token_crypto.py. Set
OAUTH_TOKEN_ENCRYPTION_KEY (64 hex chars) in both the web and api envs to
enable it. Existing plaintext tokens are read transparently (legacy fallback)
and re-encrypted the first time their access token is refreshed.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pandas as pd
import sqlalchemy as sa
from sqlalchemy import text

from app.services.token_crypto import decrypt_token, encrypt_token

logger = logging.getLogger(__name__)

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105
DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
SHEETS_GET_URL = "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}"
SHEETS_VALUES_URL = (
    "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{range}"
)


class GoogleAuthError(RuntimeError):
    """Raised when we can't obtain a usable access token for the user."""


class GoogleApiError(RuntimeError):
    """Raised on non-2xx responses from Google APIs."""


@dataclass
class GoogleCreds:
    access_token: str
    expires_at: datetime
    account_id: str  # primary key in the `account` table


def _client_id() -> str:
    cid = os.getenv("GOOGLE_CLIENT_ID")
    if not cid:
        raise GoogleAuthError("GOOGLE_CLIENT_ID not configured")
    return cid


def _client_secret() -> str:
    cs = os.getenv("GOOGLE_CLIENT_SECRET")
    if not cs:
        raise GoogleAuthError("GOOGLE_CLIENT_SECRET not configured")
    return cs


def get_user_credentials(engine: sa.Engine, user_id: str) -> GoogleCreds:
    """Return a fresh Google access token for the given user.

    Reads the Better Auth `account` row for provider='google'. Refreshes via
    the OAuth token endpoint if the cached access token is missing or due to
    expire shortly. The refreshed token is persisted back to the same row.
    """
    with engine.begin() as conn:
        row = conn.execute(
            text(
                '''
                SELECT id, "accessToken", "refreshToken", "accessTokenExpiresAt"
                FROM account
                WHERE "userId" = :uid AND "providerId" = 'google'
                LIMIT 1
                '''
            ),
            {"uid": user_id},
        ).first()

    if row is None:
        raise GoogleAuthError("user has not connected Google")

    now = datetime.now(UTC)
    expires_at = row.accessTokenExpiresAt
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)

    # Decrypt tokens from DB (no-op for legacy plaintext values).
    # Wrap in try/except: a wrong key after key rotation raises InvalidTag (a
    # cryptography exception) — surface as GoogleAuthError so the router returns
    # 401 with the reconnect CTA instead of a bare 500.
    try:
        access_token_plain = decrypt_token(row.accessToken) if row.accessToken else None
        refresh_token_plain = decrypt_token(row.refreshToken) if row.refreshToken else None
    except Exception as exc:
        raise GoogleAuthError(
            "Could not decrypt stored Google credentials — the encryption key may have changed. "
            "Please reconnect your Google account."
        ) from exc

    # Lazy backfill: if the refresh token is still plaintext, encrypt and write
    # it back now so it doesn't sit unencrypted indefinitely. Best-effort —
    # a failure here must not block the caller from reading their credentials.
    if row.refreshToken and not row.refreshToken.startswith("v1:"):
        try:
            encrypted_rt = encrypt_token(row.refreshToken)
            if encrypted_rt != row.refreshToken:  # encryption is configured
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            '''
                            UPDATE account SET "refreshToken" = :rt, "updatedAt" = NOW()
                            WHERE id = :id
                            '''
                        ),
                        {"rt": encrypted_rt, "id": row.id},
                    )
        except Exception:
            logger.warning("lazy refresh-token encryption failed for account %s", row.id)

    cache_ok = (
        access_token_plain
        and expires_at is not None
        and expires_at - now > timedelta(seconds=60)
    )

    if cache_ok:
        return GoogleCreds(
            access_token=access_token_plain,  # type: ignore[arg-type]
            expires_at=expires_at,
            account_id=row.id,
        )

    if not refresh_token_plain:
        raise GoogleAuthError("no refresh token; user must reconnect Google")

    resp = httpx.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": _client_id(),
            "client_secret": _client_secret(),
            "refresh_token": refresh_token_plain,
            "grant_type": "refresh_token",
        },
        timeout=15,
    )
    if resp.status_code != 200:
        raise GoogleAuthError(f"refresh failed: {resp.status_code} {resp.text[:200]}")
    payload = resp.json()
    new_access_token = payload.get("access_token")
    expires_in = int(payload.get("expires_in", 3600))
    if not new_access_token:
        raise GoogleAuthError("token endpoint returned no access_token")
    new_expires = now + timedelta(seconds=expires_in)

    # Write the refreshed access token back encrypted so legacy plaintext rows
    # self-migrate on first refresh without a separate backfill step.
    with engine.begin() as conn:
        conn.execute(
            text(
                '''
                UPDATE account SET
                  "accessToken" = :tok,
                  "accessTokenExpiresAt" = :exp,
                  "updatedAt" = NOW()
                WHERE id = :id
                '''
            ),
            {"tok": encrypt_token(new_access_token), "exp": new_expires, "id": row.id},
        )

    return GoogleCreds(access_token=new_access_token, expires_at=new_expires, account_id=row.id)


def _auth_headers(creds: GoogleCreds) -> dict[str, str]:
    return {"Authorization": f"Bearer {creds.access_token}"}


def list_spreadsheets(creds: GoogleCreds, query: str | None = None) -> list[dict[str, Any]]:
    """Return up to 50 spreadsheets visible to the user, newest first."""
    q_parts = ["mimeType = 'application/vnd.google-apps.spreadsheet'", "trashed = false"]
    if query:
        # Escape single quotes per Drive query syntax.
        safe = query.replace("'", "\\'")
        q_parts.append(f"name contains '{safe}'")
    params = {
        "q": " and ".join(q_parts),
        "pageSize": 50,
        "fields": "files(id, name, modifiedTime, owners(displayName))",
        "orderBy": "modifiedTime desc",
    }
    resp = httpx.get(DRIVE_FILES_URL, headers=_auth_headers(creds), params=params, timeout=20)
    if resp.status_code != 200:
        raise GoogleApiError(f"drive list failed: {resp.status_code} {resp.text[:200]}")
    return resp.json().get("files", [])


def list_worksheets(creds: GoogleCreds, spreadsheet_id: str) -> list[dict[str, Any]]:
    url = SHEETS_GET_URL.format(spreadsheet_id=spreadsheet_id)
    resp = httpx.get(
        url,
        headers=_auth_headers(creds),
        params={"fields": "sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))"},
        timeout=20,
    )
    if resp.status_code != 200:
        raise GoogleApiError(f"sheets get failed: {resp.status_code} {resp.text[:200]}")
    data = resp.json()
    out: list[dict[str, Any]] = []
    for sheet in data.get("sheets", []):
        p = sheet.get("properties", {}) or {}
        grid = p.get("gridProperties", {}) or {}
        out.append(
            {
                "sheet_id": p.get("sheetId"),
                "title": p.get("title"),
                "row_count": grid.get("rowCount"),
                "column_count": grid.get("columnCount"),
            }
        )
    return out


def _range_for_worksheet(title: str) -> str:
    # Sheets ranges with special chars need single-quote wrapping.
    escaped = title.replace("'", "''")
    return f"'{escaped}'"


def fetch_worksheet_as_dataframe(
    creds: GoogleCreds,
    spreadsheet_id: str,
    worksheet_title: str,
) -> pd.DataFrame:
    """Fetch all values from a worksheet and return a DataFrame.

    Row 0 is treated as the header. Empty trailing cells in a row are padded
    so pandas builds a rectangular frame.
    """
    rng = _range_for_worksheet(worksheet_title)
    url = SHEETS_VALUES_URL.format(spreadsheet_id=spreadsheet_id, range=rng)
    resp = httpx.get(
        url,
        headers=_auth_headers(creds),
        params={"valueRenderOption": "UNFORMATTED_VALUE", "dateTimeRenderOption": "FORMATTED_STRING"},
        timeout=60,
    )
    if resp.status_code != 200:
        raise GoogleApiError(f"sheets values failed: {resp.status_code} {resp.text[:200]}")
    values = resp.json().get("values") or []
    if not values:
        return pd.DataFrame()

    header = [str(h).strip() or f"col_{i}" for i, h in enumerate(values[0])]
    width = len(header)
    rows = []
    for r in values[1:]:
        if len(r) < width:
            r = list(r) + [None] * (width - len(r))
        elif len(r) > width:
            r = r[:width]
        rows.append(r)
    df = pd.DataFrame(rows, columns=header)

    # Sheets `UNFORMATTED_VALUE` returns JSON-native types per cell, so a
    # column like "1, 2, '9A', 3" comes back as a mix of int and str.
    # pyarrow's parquet writer infers a single type per column from the
    # early rows and then fails on the outlier. Coerce any column whose
    # non-null values aren't uniformly one type to string so the writer is
    # deterministic; clean numeric columns keep their inferred dtype.
    for col in df.columns:
        if df[col].dtype != object:
            continue
        inferred = pd.api.types.infer_dtype(df[col], skipna=True)
        if inferred.startswith("mixed"):
            df[col] = df[col].map(lambda v: None if v is None else str(v))
    return df


def has_google_account(engine: sa.Engine, user_id: str) -> bool:
    with engine.begin() as conn:
        row = conn.execute(
            text(
                'SELECT 1 FROM account WHERE "userId" = :uid AND "providerId" = \'google\' LIMIT 1'
            ),
            {"uid": user_id},
        ).first()
    return row is not None


# Tiny convenience for the sync job, since it doesn't want to import time.
def now_epoch() -> int:
    return int(time.time())
