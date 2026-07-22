"""Postgres access (self-hosted on the VPS).

A small psycopg3 connection pool + schema bootstrap. Imports are lazy so the app
boots for pure-frontend dev even if psycopg isn't installed yet; the first DB
call raises a clean error instead.
"""
from __future__ import annotations

import logging

from .config import BACKEND_DIR, get_settings

log = logging.getLogger("kbid.db")
settings = get_settings()

_pool = None  # psycopg_pool.ConnectionPool


def get_pool():
    global _pool
    if _pool is None:
        from psycopg_pool import ConnectionPool

        _pool = ConnectionPool(
            settings.database_url,
            min_size=1,
            max_size=5,
            kwargs={"autocommit": True},
            open=True,
        )
    return _pool


def init_db() -> None:
    """Ensure the schema exists (idempotent)."""
    sql = (BACKEND_DIR / "schema.sql").read_text(encoding="utf-8")
    with get_pool().connection() as conn:
        conn.execute(sql)
    log.info("DB schema ensured")


def healthcheck() -> bool:
    try:
        with get_pool().connection() as conn:
            conn.execute("select 1")
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("DB healthcheck failed: %s", e)
        return False


def as_json(value):
    """Wrap a Python object for a jsonb column/param."""
    from psycopg.types.json import Json

    return Json(value)


def log_event(draft_id: str | None, actor_email: str | None, kind: str, detail: str | None = None) -> None:
    try:
        with get_pool().connection() as conn:
            conn.execute(
                "insert into events (draft_id, actor_email, kind, detail) values (%s,%s,%s,%s)",
                (draft_id, actor_email, kind, detail),
            )
    except Exception as e:  # noqa: BLE001 — audit logging must never break a request
        log.warning("log_event failed: %s", e)
