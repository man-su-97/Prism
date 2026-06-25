"""AES-256-GCM encryption for OAuth tokens stored in the account table.

Encrypted format:  v1:<nonce_b64>:<ciphertext_b64>
  - nonce     : 12 random bytes (96-bit, standard for GCM)
  - ciphertext: plaintext bytes + 16-byte GCM authentication tag

Key source: OAUTH_TOKEN_ENCRYPTION_KEY env var — 64 hex chars (32 bytes).
Generate with: python -c "import secrets; print(secrets.token_hex(32))"

If the env var is unset, encrypt() returns the plaintext unchanged and
decrypt() returns plaintext-looking values as-is (legacy fallback). This
lets the service boot without the key set; tokens are just stored plaintext
as before. Set the key in prod to enable encryption.
"""
from __future__ import annotations

import base64
import os
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_KEY_ENV = "OAUTH_TOKEN_ENCRYPTION_KEY"
_V1_PREFIX = "v1:"


def _get_key() -> bytes | None:
    hex_key = os.getenv(_KEY_ENV, "")
    if not hex_key:
        return None
    if len(hex_key) != 64:
        raise RuntimeError(
            f"{_KEY_ENV} must be a 64-char hex string (32 bytes). "
            "Generate with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    return bytes.fromhex(hex_key)


def encrypt_token(plaintext: str) -> str:
    """Encrypt *plaintext* with AES-256-GCM. Returns plaintext unchanged if key not set."""
    key = _get_key()
    if key is None:
        return plaintext
    nonce = secrets.token_bytes(12)
    ct_with_tag = AESGCM(key).encrypt(nonce, plaintext.encode(), None)
    return f"{_V1_PREFIX}{base64.b64encode(nonce).decode()}:{base64.b64encode(ct_with_tag).decode()}"


def decrypt_token(value: str) -> str:
    """Decrypt an encrypted token. Returns value unchanged for legacy plaintext tokens."""
    if not value.startswith(_V1_PREFIX):
        return value  # legacy plaintext — not yet encrypted
    key = _get_key()
    if key is None:
        raise RuntimeError(f"{_KEY_ENV} not set — cannot decrypt token")
    rest = value[len(_V1_PREFIX):]
    sep = rest.find(":")
    if sep < 0:
        raise ValueError("invalid encrypted token format")
    nonce = base64.b64decode(rest[:sep])
    ct_with_tag = base64.b64decode(rest[sep + 1:])
    plaintext = AESGCM(key).decrypt(nonce, ct_with_tag, None)
    return plaintext.decode()
