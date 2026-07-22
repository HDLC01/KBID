"""Estimate API — live fee calculator.

POST /api/estimate/compute runs the KBID calc engine (server-authoritative, like
Treadwell's estimate tool) so the frontend grid gets one source of truth for
totals. GET /api/estimate/rates exposes the rate tables + role labels + $/SF
benchmarks the UI needs to render.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import require_user
from ..services import calc_engine as ce

router = APIRouter(prefix="/api/estimate", tags=["estimate"])


class PhaseIn(BaseModel):
    name: str
    duration_weeks: float = 0.0
    meetings: float = 0.0
    hours_per_week: dict[str, float] = Field(default_factory=dict)


class EstimateIn(BaseModel):
    phases: list[PhaseIn] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=lambda: list(ce.ROLES))
    rate_set: str = "current"                     # current | legacy | custom
    rates: dict[str, float] | None = None         # used when rate_set == "custom"
    meeting_role: str = "design_director"
    contingency_pct: float = 0.0
    consultants: dict[str, float] = Field(default_factory=dict)
    construction_budget: float = 0.0
    square_footage: float = 0.0
    project_type: str = "residential"
    round_step: int = 0


def _resolve_rates(body: EstimateIn) -> dict[str, float]:
    if body.rate_set == "custom" and body.rates:
        return dict(body.rates)
    if body.rate_set == "legacy":
        return dict(ce.LEGACY_RATES)
    return dict(ce.CURRENT_RATES)


@router.post("/compute")
async def compute(body: EstimateIn, user=Depends(require_user)) -> dict:
    inp = ce.EstimateInput(
        phases=[
            ce.Phase(p.name, p.duration_weeks, p.meetings, dict(p.hours_per_week))
            for p in body.phases
        ],
        roles=list(body.roles),
        rates=_resolve_rates(body),
        meeting_role=body.meeting_role,
        contingency_pct=body.contingency_pct,
        consultants=dict(body.consultants),
        construction_budget=body.construction_budget,
        square_footage=body.square_footage,
        project_type=body.project_type,
        round_step=body.round_step,
    )
    return ce.compute(inp)


@router.get("/rates")
async def rates(user=Depends(require_user)) -> dict:
    return {
        "roles": list(ce.ROLES),
        "role_labels": ce.ROLE_LABELS,
        "rate_sets": {"current": ce.CURRENT_RATES, "legacy": ce.LEGACY_RATES},
        "sf_benchmarks": ce.SF_BENCHMARKS,
        "meeting_role": "design_director",
    }
