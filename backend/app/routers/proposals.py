"""Proposal generation API — narrative (claude -p) + KBID-template .docx/PDF."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from .. import db
from ..auth import require_user
from ..services import docx_builder, indesign_export, proposal_gen

router = APIRouter(prefix="/api/proposal", tags=["proposal"])


class GenIn(BaseModel):
    draft_id: str


class FeedbackIn(BaseModel):
    draft_id: str
    text: str


def _load_state(draft_id: str) -> dict:
    with db.get_pool().connection() as conn:
        row = conn.execute(
            "select data from drafts where id=%s and deleted_at is null", (draft_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Draft not found.")
    return row[0]


def _save_sections(draft_id: str, state: dict, sections: dict, actor: str) -> None:
    state.setdefault("proposal", {})["sections"] = sections
    with db.get_pool().connection() as conn:
        conn.execute(
            "update drafts set data=%s, status='generated', updated_at=now() where id=%s",
            (db.as_json(state), draft_id),
        )
    db.log_event(draft_id, actor, "generated")


def _sections_for(state: dict) -> dict:
    return (state.get("proposal") or {}).get("sections") or proposal_gen.generate(state)


def _filename(sections: dict, ext: str) -> str:
    name = (sections.get("meta", {}) or {}).get("project_name") or "KBID Proposal"
    slug = re.sub(r"[^A-Za-z0-9 _-]", "", name).strip() or "KBID Proposal"
    return f"{slug}.{ext}"


def _docx_to_pdf(docx_bytes: bytes) -> bytes | None:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None
    with tempfile.TemporaryDirectory() as d:
        ip = os.path.join(d, "in.docx")
        with open(ip, "wb") as f:
            f.write(docx_bytes)
        subprocess.run(
            [soffice, "--headless", "--convert-to", "pdf", "--outdir", d, ip],
            capture_output=True, timeout=120, env={**os.environ, "HOME": d},
        )
        op = os.path.join(d, "in.pdf")
        if os.path.exists(op):
            with open(op, "rb") as f:
                return f.read()
    return None


@router.post("/generate")
async def generate(body: GenIn, user=Depends(require_user)) -> dict:
    state = _load_state(body.draft_id)
    sections = proposal_gen.generate(state)
    _save_sections(body.draft_id, state, sections, user["email"])
    return {"ok": True, "sections": sections}


@router.post("/docx")
async def docx(body: GenIn, user=Depends(require_user)) -> Response:
    sections = _sections_for(_load_state(body.draft_id))
    data = docx_builder.build_docx(sections)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{_filename(sections, "docx")}"'},
    )


@router.post("/pdf")
async def pdf(body: GenIn, user=Depends(require_user)) -> Response:
    sections = _sections_for(_load_state(body.draft_id))
    data = _docx_to_pdf(docx_builder.build_docx(sections))
    if data is None:
        raise HTTPException(status_code=501, detail="PDF conversion unavailable (LibreOffice not installed here).")
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{_filename(sections, "pdf")}"'},
    )


@router.post("/feedback")
async def feedback(body: FeedbackIn, user=Depends(require_user)) -> dict:
    """Feedback-loop Option A: log what the user changed, to improve the template later."""
    db.log_event(body.draft_id, user["email"], "feedback", body.text[:2000])
    return {"ok": True}


@router.post("/indesign")
async def indesign(body: GenIn, user=Depends(require_user)) -> Response:
    """InDesign Tagged Text — Kali Places this into KBID's own InDesign template."""
    sections = _sections_for(_load_state(body.draft_id))
    txt = indesign_export.build_tagged_text(sections)
    return Response(
        content=txt.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{_filename(sections, "txt")}"'},
    )
