"""Draft persistence — one project per row, whole state in jsonb, keyed by ?d=<uuid>.

Mirrors the Treadwell proposal tool's draft model (server + localStorage + URL uuid)
but on the self-hosted Postgres. Lists paginate at 25/page (house rule).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .. import db
from ..auth import require_user

router = APIRouter(prefix="/api", tags=["drafts"])

PAGE_SIZE = 25


class DraftIn(BaseModel):
    data: dict = Field(default_factory=dict)
    title: str | None = None
    status: str | None = None


@router.put("/draft/{draft_id}")
async def save_draft(draft_id: str, body: DraftIn, user=Depends(require_user)) -> dict:
    is_new = False
    with db.get_pool().connection() as conn:
        row = conn.execute("select id from drafts where id=%s", (draft_id,)).fetchone()
        is_new = row is None
        conn.execute(
            """
            insert into drafts (id, data, owner_email, title, status, updated_at)
            values (%s, %s, %s, %s, coalesce(%s,'draft'), now())
            on conflict (id) do update set
                data = excluded.data,
                title = coalesce(excluded.title, drafts.title),
                status = coalesce(%s, drafts.status),
                updated_at = now()
            """,
            (draft_id, db.as_json(body.data), user["email"], body.title, body.status, body.status),
        )
    db.log_event(draft_id, user["email"], "created" if is_new else "updated", body.title)
    return {"ok": True, "id": draft_id}


@router.get("/draft/{draft_id}")
async def load_draft(draft_id: str, user=Depends(require_user)) -> dict:
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select id, data, owner_email, title, status, updated_at "
            "from drafts where id=%s and deleted_at is null",
            (draft_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Draft not found.")
    return {
        "id": row[0],
        "data": row[1],
        "owner_email": row[2],
        "title": row[3],
        "status": row[4],
        "updated_at": row[5].isoformat() if row[5] else None,
    }


@router.get("/drafts")
async def list_drafts(user=Depends(require_user), page: int = Query(1, ge=1)) -> dict:
    offset = (page - 1) * PAGE_SIZE
    with db.get_pool().connection() as conn:
        total = conn.execute("select count(*) from drafts where deleted_at is null").fetchone()[0]
        rows = conn.execute(
            "select id, title, status, owner_email, updated_at "
            "from drafts where deleted_at is null "
            "order by updated_at desc limit %s offset %s",
            (PAGE_SIZE, offset),
        ).fetchall()
    return {
        "page": page,
        "page_size": PAGE_SIZE,
        "total": total,
        "items": [
            {
                "id": r[0],
                "title": r[1],
                "status": r[2],
                "owner_email": r[3],
                "updated_at": r[4].isoformat() if r[4] else None,
            }
            for r in rows
        ],
    }


@router.post("/draft/{draft_id}/trash")
async def trash_draft(draft_id: str, user=Depends(require_user)) -> dict:
    with db.get_pool().connection() as conn:
        conn.execute("update drafts set deleted_at=now() where id=%s", (draft_id,))
    db.log_event(draft_id, user["email"], "trashed")
    return {"ok": True}


@router.post("/draft/{draft_id}/restore")
async def restore_draft(draft_id: str, user=Depends(require_user)) -> dict:
    with db.get_pool().connection() as conn:
        conn.execute("update drafts set deleted_at=null where id=%s", (draft_id,))
    db.log_event(draft_id, user["email"], "restored")
    return {"ok": True}
