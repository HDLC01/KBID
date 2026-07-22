"""KBID estimate calc engine.

Pure-Python port of KBID's fee-estimating math, reverse-engineered from
`Info Sheet/412 - Switzer Residence.xlsx` (Sheet1). Deterministic and
dependency-free so it can be unit-tested standalone and reused by the API.

Model (per the Switzer workbook):
  * Per phase, per role:   hours = duration_weeks * weekly_hours
                           fee   = hours * role_rate
  * Meetings:              meeting_fee = meetings * meeting_role_rate   (Design Director $200)
  * Phase total:           sum(role fees) + meeting_fee                  (then optionally rounded)
  * Contingency:           total * contingency_pct                       (often "baked in" -> 0)
  * Consultants:           flat allowances (Code / Architecture / MEP / Structural)
Cross-checks (Proposal Guide tab): fee as % of construction budget (target ~5-12%),
and $/SF benchmarks (residential $10 / commercial-TI $3.50 / commercial $9.50).

Run `python -m app.services.calc_engine` (from backend/) to execute the
self-test that reproduces the Switzer numbers exactly.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Roles in display order; keys are stable identifiers used across the app.
ROLES: tuple[str, ...] = ("owner_director", "design_director", "interior_designer", "designer")
ROLE_LABELS: dict[str, str] = {
    "owner_director": "Owner / Director",
    "design_director": "Design Director",
    "interior_designer": "Interior Designer",
    "designer": "Designer",
}

# Rate sets (Section C). "current" is KBID's present schedule; "legacy" was a flat $175.
CURRENT_RATES: dict[str, float] = {
    "owner_director": 210.0,
    "design_director": 200.0,
    "interior_designer": 170.0,
    "designer": 150.0,
}
LEGACY_RATES: dict[str, float] = {r: 175.0 for r in ROLES}

# $/SF quick-quote benchmarks (Proposal Guide tab).
SF_BENCHMARKS: dict[str, float] = {
    "residential": 10.0,
    "commercial_ti": 3.5,
    "commercial": 9.5,
}


def round_to(value: float, step: int) -> float:
    """Round to the nearest `step` (e.g. 250/500/1000). step<=0 => no rounding."""
    if not step or step <= 0:
        return value
    return float(round(value / step) * step)


@dataclass
class Phase:
    name: str
    duration_weeks: float = 0.0
    meetings: float = 0.0                       # count (may be fractional, as the sheet derives it)
    hours_per_week: dict[str, float] = field(default_factory=dict)  # role -> weekly hours


@dataclass
class EstimateInput:
    phases: list[Phase]
    roles: list[str] = field(default_factory=lambda: list(ROLES))
    rates: dict[str, float] = field(default_factory=lambda: dict(CURRENT_RATES))
    meeting_role: str = "design_director"       # meeting fee billed at this role's rate
    contingency_pct: float = 0.0
    consultants: dict[str, float] = field(default_factory=dict)  # label -> allowance $
    construction_budget: float = 0.0
    square_footage: float = 0.0
    project_type: str = "residential"           # keys into SF_BENCHMARKS for the $/SF check
    round_step: int = 0                          # 0 = report raw only


def compute(inp: EstimateInput) -> dict:
    rates = inp.rates
    meeting_rate = float(rates.get(inp.meeting_role, 0.0))

    phases_out: list[dict] = []
    total_hours = 0.0
    total_fee_raw = 0.0

    for p in inp.phases:
        role_lines: dict[str, dict] = {}
        phase_hours = 0.0
        phase_fee = 0.0
        for role in inp.roles:
            wph = float(p.hours_per_week.get(role, 0.0) or 0.0)
            hrs = p.duration_weeks * wph
            fee = hrs * float(rates.get(role, 0.0))
            role_lines[role] = {"weekly_hours": wph, "hours": hrs, "fee": fee}
            phase_hours += hrs
            phase_fee += fee

        meeting_fee = float(p.meetings) * meeting_rate
        phase_total = phase_fee + meeting_fee

        phases_out.append(
            {
                "name": p.name,
                "duration_weeks": p.duration_weeks,
                "meetings": p.meetings,
                "roles": role_lines,
                "labor_fee": phase_fee,
                "meeting_fee": meeting_fee,
                "hours": phase_hours,
                "total_raw": phase_total,
                "total_rounded": round_to(phase_total, inp.round_step),
            }
        )
        total_hours += phase_hours
        total_fee_raw += phase_total

    design_fee_rounded = (
        sum(pp["total_rounded"] for pp in phases_out) if inp.round_step else total_fee_raw
    )
    consultants_total = float(sum(inp.consultants.values()))
    contingency = total_fee_raw * inp.contingency_pct
    grand_total = design_fee_rounded + contingency + consultants_total

    fee_pct = (total_fee_raw / inp.construction_budget) if inp.construction_budget else None
    sf_benchmarks = (
        {k: inp.square_footage * v for k, v in SF_BENCHMARKS.items()} if inp.square_footage else {}
    )
    sf_for_type = (
        inp.square_footage * SF_BENCHMARKS.get(inp.project_type, 0.0)
        if inp.square_footage
        else None
    )

    return {
        "phases": phases_out,
        "total_hours": total_hours,
        "total_fee_raw": total_fee_raw,
        "design_fee_rounded": design_fee_rounded,
        "contingency": contingency,
        "consultants_total": consultants_total,
        "grand_total": grand_total,
        "checks": {
            "fee_pct_of_budget": fee_pct,
            "fee_pct_in_band": (0.05 <= fee_pct <= 0.12) if fee_pct is not None else None,
            "sf_benchmarks": sf_benchmarks,
            "sf_benchmark_for_type": sf_for_type,
        },
    }


# ---------------------------------------------------------------------------
# Self-test: reproduce the Switzer Residence workbook (Sheet1) exactly.
# ---------------------------------------------------------------------------
def _switzer_input() -> EstimateInput:
    # weekly hours per role, straight from the sheet's "Weekly Hours" (D/H/L/P) cells.
    return EstimateInput(
        phases=[
            Phase("Pre-Design", 2, 1, {"owner_director": 1, "design_director": 3, "interior_designer": 16, "designer": 0}),
            Phase("Schematic Design", 3, 1.5, {"owner_director": 1, "design_director": 4, "interior_designer": 8, "designer": 0}),
            Phase("Design Development", 6, 3, {"owner_director": 1, "design_director": 4.5, "interior_designer": 5, "designer": 5}),
            Phase("Construction Documents", 2, 1, {"owner_director": 0, "design_director": 4, "interior_designer": 32, "designer": 0}),
        ],
        rates=dict(CURRENT_RATES),
        consultants={"Structural": 8000.0},
        construction_budget=300000.0,
        square_footage=0.0,
        project_type="residential",
    )


def _selftest() -> None:
    r = compute(_switzer_input())
    expected_phase_totals = {
        "Pre-Design": 7260.0,
        "Schematic Design": 7410.0,
        "Design Development": 16860.0,
        "Construction Documents": 12680.0,
    }
    print(f"{'Phase':<24}{'hours':>8}{'labor':>10}{'mtg':>8}{'total':>10}  expected")
    ok = True
    for p in r["phases"]:
        exp = expected_phase_totals[p["name"]]
        mark = "OK" if abs(p["total_raw"] - exp) < 0.005 else "!! MISMATCH"
        ok = ok and mark == "OK"
        print(
            f"{p['name']:<24}{p['hours']:>8.0f}{p['labor_fee']:>10.0f}"
            f"{p['meeting_fee']:>8.0f}{p['total_raw']:>10.0f}  {exp:>8.0f} {mark}"
        )
    total = r["total_fee_raw"]
    exp_total = 44210.0
    tmark = "OK" if abs(total - exp_total) < 0.005 else "!! MISMATCH"
    ok = ok and tmark == "OK"
    print(f"\nDesign fee (raw)       = ${total:,.0f}  (expected ${exp_total:,.0f}) {tmark}")
    print(f"+ Structural allowance = ${r['consultants_total']:,.0f}")
    print(f"Grand total            = ${r['grand_total']:,.0f}")
    print(f"Fee % of $300k budget  = {r['checks']['fee_pct_of_budget']*100:.1f}%")
    print("\nRESULT:", "ALL MATCH - OK" if ok else "MISMATCH - check the math")
    assert ok, "calc_engine self-test failed"


if __name__ == "__main__":
    _selftest()
