"""KBID Proposal Generator — FastAPI entrypoint.

Serves the JSON API under /api/* and the vanilla single-page frontend at /.
Run locally:  uvicorn app.main:app --reload --port 8902   (from backend/)
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("kbid")

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure the DB schema exists; non-fatal so the app still serves the UI/API
    # if Postgres isn't up yet (DB-backed endpoints will 503 until it is).
    try:
        from . import db

        db.init_db()
    except Exception as e:  # noqa: BLE001
        log.warning("DB init skipped (%s). DB-backed endpoints will fail until Postgres is up.", e)
    yield


app = FastAPI(title="KBID Proposal Generator", version="0.1.0", lifespan=lifespan)

if not settings.is_prod:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.get("/healthz")
def healthz() -> dict:
    try:
        from . import db

        db_ok = db.healthcheck()
    except Exception:  # noqa: BLE001
        db_ok = False
    return {"ok": True, "app": "kbid-proposal-tool", "env": settings.app_env, "db": db_ok}


@app.get("/api/config")
def public_config() -> JSONResponse:
    """Public, unauthenticated: what the frontend needs to boot Clerk."""
    return JSONResponse(
        {
            "appEnv": settings.app_env,
            "clerkPublishableKey": settings.clerk_publishable_key,
            "devAuthBypass": settings.dev_auth_bypass,
        }
    )


# --- routers ----------------------------------------------------------------
from .routers import estimates  # noqa: E402

app.include_router(estimates.router)

try:  # drafts need psycopg; keep the app bootable if it isn't installed yet
    from .routers import drafts  # noqa: E402

    app.include_router(drafts.router)
except Exception as e:  # noqa: BLE001
    log.warning("drafts router disabled (%s)", e)

try:  # proposals need python-docx + the claude CLI
    from .routers import proposals  # noqa: E402

    app.include_router(proposals.router)
except Exception as e:  # noqa: BLE001
    log.warning("proposals router disabled (%s)", e)


# --- static frontend (mounted last so it doesn't shadow /api or /healthz) ----
if settings.frontend_dir.is_dir():
    app.mount("/", StaticFiles(directory=str(settings.frontend_dir), html=True), name="frontend")
    log.info("Serving frontend from %s", settings.frontend_dir)
else:
    log.warning("Frontend dir not found: %s (API-only)", settings.frontend_dir)
