"""Runtime settings, read once from the environment (see .env.example)."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader so the service needs no extra dependency."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv(REPO_ROOT / ".env")


def _csv(name: str, default: str) -> list[str]:
    return [v.strip() for v in os.environ.get(name, default).split(",") if v.strip()]


@dataclass(frozen=True)
class Settings:
    env: str = os.environ.get("INTENTGATE_ENV", "development")
    db_path: Path = Path(os.environ.get("INTENTGATE_DB_PATH", str(REPO_ROOT / "backend" / "data" / "intentgate.db")))
    artifacts_dir: Path = Path(os.environ.get("INTENTGATE_ARTIFACTS", str(REPO_ROOT / "ml" / "artifacts")))
    results_dir: Path = Path(os.environ.get("INTENTGATE_RESULTS", str(REPO_ROOT / "ml" / "results")))
    evidence_dir: Path = Path(os.environ.get("INTENTGATE_EVIDENCE", str(REPO_ROOT / "evidence")))
    # Signs intents and approval grants. A random per-process key is used when unset, which is
    # safe (grants simply do not survive restarts) but should be configured in production.
    signing_key: bytes = field(
        default_factory=lambda: os.environ.get("INTENTGATE_SIGNING_KEY", "").encode() or secrets.token_bytes(32)
    )
    operator_token: str = os.environ.get("INTENTGATE_OPERATOR_TOKEN", "")
    cors_origins: list[str] = field(default_factory=lambda: _csv("INTENTGATE_CORS_ORIGINS", "http://localhost:5173"))
    approval_ttl_s: int = int(os.environ.get("INTENTGATE_APPROVAL_TTL_S", "120"))
    challenge_ttl_s: int = int(os.environ.get("INTENTGATE_CHALLENGE_TTL_S", "900"))
    max_sessions: int = int(os.environ.get("INTENTGATE_MAX_SESSIONS", "200"))
    session_ttl_s: int = int(os.environ.get("INTENTGATE_SESSION_TTL_S", "7200"))
    rate_limit_per_min: int = int(os.environ.get("INTENTGATE_RATE_LIMIT_PER_MIN", "240"))
    max_body_bytes: int = int(os.environ.get("INTENTGATE_MAX_BODY_BYTES", "65536"))
    static_dir: Path | None = (
        Path(os.environ["INTENTGATE_STATIC_DIR"]) if os.environ.get("INTENTGATE_STATIC_DIR") else None
    )


settings = Settings()
