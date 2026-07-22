"""Runtime configuration for the KBID Proposal Generator.

Dependency-light on purpose: reads a `.env` (if present) plus the process
environment, with no third-party settings library, so the skeleton boots with
just FastAPI + uvicorn installed. Richer deps (psycopg, PyJWT) come online in
the DB/auth layers.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent      # .../KBIDS/backend
PROJECT_DIR = BACKEND_DIR.parent                           # .../KBIDS


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines, '#' comments, no interpolation.

    Existing process env always wins (so `DATABASE_URL=... uvicorn ...` overrides
    the file). Missing file is a no-op.
    """
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip('"').strip("'")
        os.environ.setdefault(key, val)


_load_dotenv(BACKEND_DIR / ".env")


def _bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(int(default))).strip().lower() in {"1", "true", "yes", "on"}


def _csv(name: str) -> list[str]:
    return [x.strip().lower() for x in os.environ.get(name, "").split(",") if x.strip()]


class Settings:
    def __init__(self) -> None:
        self.app_env: str = os.environ.get("APP_ENV", "dev")
        self.port: int = int(os.environ.get("PORT", "8902"))

        fd = os.environ.get("FRONTEND_DIR", "../frontend")
        fdp = Path(fd)
        self.frontend_dir: Path = fdp if fdp.is_absolute() else (BACKEND_DIR / fdp).resolve()

        self.database_url: str = os.environ.get(
            "DATABASE_URL", "postgresql://kbid:kbid_dev_pw@127.0.0.1:5438/kbid"
        )

        # Clerk
        self.clerk_publishable_key: str = os.environ.get("CLERK_PUBLISHABLE_KEY", "")
        self.clerk_secret_key: str = os.environ.get("CLERK_SECRET_KEY", "")
        self.clerk_issuer: str = os.environ.get("CLERK_ISSUER", "").rstrip("/")
        self.clerk_jwks_url: str = os.environ.get("CLERK_JWKS_URL", "")
        self.auth_allowlist: list[str] = _csv("AUTH_ALLOWLIST")
        self.auth_admins: list[str] = _csv("AUTH_ADMINS")
        self.dev_auth_bypass: bool = _bool("DEV_AUTH_BYPASS", default=False)

        # Claude CLI narrative/autofill
        self.claude_bin: str = os.environ.get("CLAUDE_BIN", "claude")
        self.claude_model: str = os.environ.get("CLAUDE_MODEL", "sonnet")

    @property
    def is_prod(self) -> bool:
        return self.app_env.lower() == "prod"

    def clerk_frontend_api(self) -> str:
        """Derive the Clerk Frontend API host from the publishable key when the
        issuer/JWKS aren't set explicitly. pk_(test|live)_<base64 host with '$'>."""
        if self.clerk_issuer:
            return self.clerk_issuer
        pk = self.clerk_publishable_key
        if not pk or "_" not in pk:
            return ""
        import base64
        try:
            encoded = pk.split("_", 2)[2]
            host = base64.b64decode(encoded + "==").decode("utf-8").rstrip("$")
            return f"https://{host}" if host else ""
        except Exception:
            return ""

    def jwks_url(self) -> str:
        if self.clerk_jwks_url:
            return self.clerk_jwks_url
        fe = self.clerk_frontend_api()
        return f"{fe}/.well-known/jwks.json" if fe else ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
