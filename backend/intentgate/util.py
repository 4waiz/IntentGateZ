"""Small shared helpers: canonical JSON, hashing, HMAC signatures, ids."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from typing import Any


def canonical_json(obj: Any) -> str:
    """Deterministic JSON: sorted keys, no whitespace, UTF-8, floats via repr."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=_default)


def _default(o: Any) -> Any:
    if hasattr(o, "model_dump"):
        return o.model_dump(mode="json")
    if hasattr(o, "value"):
        return o.value
    if isinstance(o, (set, frozenset, tuple)):
        return list(o)
    return str(o)


def sha256_hex(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def hmac_hex(key: bytes, data: str) -> str:
    return hmac.new(key, data.encode("utf-8"), hashlib.sha256).hexdigest()


def hmac_ok(key: bytes, data: str, signature: str) -> bool:
    return hmac.compare_digest(hmac_hex(key, data), signature or "")


def new_id(prefix: str, nbytes: int = 6) -> str:
    return f"{prefix}_{secrets.token_hex(nbytes)}"


def now() -> float:
    return time.time()


def iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ts)) + f".{int((ts % 1) * 1000):03d}Z"
