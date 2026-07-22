"""Generate a KBID proposal from intake + estimate.

Claude (`claude -p`) writes only the voice-critical prose — cover letter, scope
overview, per-phase descriptions, schedule — few-shot on KBID's real proposals.
The legal/boilerplate sections (Exhibit A, payment, reimbursables, documents,
limitation, notice) are VERBATIM constants, and fees/exclusions come from the
estimate/intake — so those are never paraphrased by the model.
"""
from __future__ import annotations

from .claude_cli import call_claude_json

# ---- KBID constants (verbatim from the real proposals) ----------------------
FIRM = {
    "name": "Kali Buchanan Interior Design",
    "legal": "Kali Buchanan Interior Design, LLC",
    "address": "1707 E 123rd Terrace",
    "city": "Olathe, KS 66061",
    "email": "kali@kalibuchananid.com",
    "phone": "913.214.0209",
    "signatory": "Kali Buchanan NCIDQ, RID, IIDA, LEED AP",
    "signatory_short": "Kali Buchanan, RID, NCIDQ, IIDA, LEED AP",
}
COVER_OPENER = ('Thank you so much for the opportunity to prepare this letter agreement for interior '
                'design services to be performed by Kali Buchanan Interior Design, LLC (“KBID” '
                'and/or “Interior Designer”) to complete the project at the above project address. '
                'The scope of work, projected Interior Design fees and suggested process are set forth below. '
                'Please sign this letter agreement below and return it so that your project will be scheduled.')
COVER_CLOSER = ('We look forward to the opportunity to work with you on this special project. This proposal '
                'is valid for 30 days. If you have any questions, please do not hesitate to let us know or give us a call.')
EXHIBIT_A = ('Additional Terms and Conditions to this Agreement are attached as Exhibit A and incorporated by '
             'reference as if fully set forth herein. Client acknowledges that Client has read and understands '
             'the additional terms and conditions set forth in Exhibit A.')
PAYMENT = ('The Fees and Reimbursable expenses will be invoiced monthly. Payment is due within thirty (30) days '
           'of receipt of the invoice. Invoices will be sent via email. Payment is not dependent on the success '
           'or failure of the project, project approvals or denials, or project feasibility. If payment is not '
           'received by KBID within 30 calendar days of the invoice date, the Client shall pay interest as an '
           'additional charge of 1% of the Past Due amount per month. Payment thereafter shall first be applied '
           'to accrued interest and then to the unpaid principal balance.')
REIMBURSABLES = ["Printing and reproductions", "Courier and delivery charges", "Relative Material Sample Costs",
                 "Professional Rendering and/or Video beyond what is included", "Photography", "Mail / Shipping",
                 "Mileage / Travel / Lodging"]
DOCUMENTS = ('All reports, notes, sketches, drawings, documentation, calculations, specifications, schedules, and '
             'other documents prepared by KBID shall remain the property of KBID, whether or not the project is '
             'executed. Client may retain copies of drawings and specifications for informational and reference '
             'use related to the project’s occupancy. These documents shall not be used for other projects, '
             'additions, or completion by others (unless KBID is in default), except with written agreement. KBID '
             'reserves the right to photograph project areas before, during, and after completion, with respect '
             'for Client’s privacy. Client’s identity shall remain confidential unless consent for '
             'disclosure is given, and KBID shall be credited as the designer if the project is published.')
LIMITATION = ('KBID shall not be liable for any indirect, special, consequential, or punitive damages (including '
              'lost profits) arising out of or relating to this Letter Agreement or the transactions it '
              'contemplates (whether breach of contract, tort, negligence, or other form of action). In no event '
              'shall KBID’s liability exceed the Fees paid by the Client for the services giving rise to the '
              'claim or cause of action.')
NOTICE = ('KBID will not commence services on this project without receiving this Letter Agreement signed by '
          'client and returned to us. Once we have received the executed agreement, we will schedule your project.')

# ---- few-shot voice exemplars (condensed from the real Switzer/Vertebra proposals) ----
STYLE_EXEMPLARS = """\
EXAMPLE — Scope overview (residential):
"The scope includes Interior Design services for the remodel and small addition of the Client's current main
level kitchen area and a second floor whiskey room which will require the remodel of the main level Kitchen and
Laundry. KBID will prepare existing conditions drawings as the basis for the new work... following KBID's
standard full service design process."

EXAMPLE — Pre-Design phase:
"We will begin the process by identifying and confirming the design intent, schedule, and budget with the Client.
KBID will initiate this phase with a site visit to measure and photograph the existing space, review the Client's
budget, goals, and inspiration. During this phase, KBID will also begin developing the space plan... This phase
includes one (1) client meeting and site visit conducted over a two (2) week period."

EXAMPLE — Design Development phase:
"Working from the previous phase, KBID will begin to apply and refine the design and material selections in this
phase. The design will evolve using drawings, images and (3-4) critical interior renderings... This phase will be
the most involved from a Client selection standpoint and include (2-3) client meetings over 6 weeks of time."

EXAMPLE — Schedule:
"After receipt of the signed Letter Agreement, KBID has the ability to start with the pre-design phase in [month].
The project is expected to be completed within the estimated timeframe outlined above. Additional work, meetings,
or time beyond the agreed scope will incur additional fees. The final project schedule will be confirmed upon
award, with projects scheduled on a first-come, first-served basis."
"""

SYSTEM = (
    "You are Kali Buchanan writing an interior-design letter-agreement proposal for KBID. "
    "Match the voice of the provided examples EXACTLY: warm but professional, first-person plural (“we”/“KBID”), "
    "confident, specific, no marketing fluff, no em-dashes. Each phase paragraph ends by stating the meeting count "
    "and duration like “...includes (2-3) client meetings over 6 weeks of time.” "
    "Adjust language for the architect relationship, decision-making style, and timeline urgency given. "
    "Return ONLY valid JSON, no prose around it."
)

PHASE_LABELS = {
    "pre_design": "Pre-Design", "schematic": "Schematic Design", "design_development": "Design Development",
    "construction_documents": "Construction Documents", "construction_observation": "Construction Observation",
}
ARCHITECT_NOTE = {
    "none": "No separate architect; KBID owns the full drawing set and coordinates directly with the contractor.",
    "kbid_lead": "KBID is the prime/lead; an architect consults on structural/envelope only.",
    "kbid_sub": "KBID is a sub-consultant to the architect of record; decisions flow through the architect.",
    "parallel": "KBID and the architect are parallel team members, each contracted directly with the client.",
    "kbid_hires": "KBID will source and manage a permit/structural architect as part of the scope.",
}


def _facts(state: dict) -> str:
    k = state.get("intake", {})
    est = (state.get("estimate", {}) or {}).get("result") or {}
    client = k.get("client", {}); proj = k.get("project", {}); ctx = k.get("context", {})
    phases = [PHASE_LABELS.get(p, p) for p in k.get("phases", [])]
    lines = [
        f"Project type: {k.get('projectType','')}",
        f"Client: {client.get('name','')}",
        f"Project: {proj.get('name','')} at {proj.get('address','')}",
        f"Architect relationship: {ARCHITECT_NOTE.get(k.get('architect',''),'')}",
        f"Decision-making style: {ctx.get('decision','')}",
        f"Timeline urgency: {ctx.get('timeline','')}",
        f"Tone guidance: {ctx.get('tone','')}",
        f"Scope notes: {k.get('scope',{}).get('text','')}",
        f"Square footage: {k.get('scope',{}).get('sqft','')}",
        f"Construction type: {k.get('scope',{}).get('kind','')}",
        f"Design phases: {', '.join(phases)}",
        f"Unique context: {ctx.get('notes','')}",
    ]
    mtgs = k.get("meetings", {})
    for pid in k.get("phases", []):
        m = mtgs.get(pid, {})
        lines.append(f"  - {PHASE_LABELS.get(pid,pid)}: {m.get('meetings','?')} meetings over {m.get('weeks','?')} weeks")
    if est.get("phases"):
        lines.append("Fee per phase (rounded): " + ", ".join(f"{p['name']} {round(p.get('total_rounded') or p['total_raw'])}" for p in est["phases"]))
    return "\n".join(lines)


def generate_prose(state: dict) -> dict:
    prompt = (
        f"{STYLE_EXEMPLARS}\n\nPROJECT FACTS:\n{_facts(state)}\n\n"
        "Write the proposal prose in KBID's voice. Return JSON with keys:\n"
        '{ "cover_letter": [<2-3 paragraph strings; do NOT include the standard opener/closer, only the '
        'project-specific middle if any>], "scope_overview": "<one paragraph>", '
        '"phases": [ {"name": "<phase name>", "description": "<paragraph ending with the meeting count + duration>"} ], '
        '"schedule": "<one paragraph>" }'
    )
    data = call_claude_json(prompt, SYSTEM, timeout=150)
    return data if isinstance(data, dict) else {}


def build_sections(state: dict, prose: dict | None = None) -> dict:
    """Assemble the full ordered proposal (prose + constants + intake/estimate)."""
    k = state.get("intake", {})
    prose = prose or {}
    client = k.get("client", {}); proj = k.get("project", {})
    excl = [x for x in (k.get("exclusions") or []) if isinstance(x, str)]
    # phase prose keyed by label, fall back to a template sentence
    prose_phases = {p.get("name"): p.get("description") for p in (prose.get("phases") or []) if isinstance(p, dict)}
    phases = []
    for pid in k.get("phases", []):
        label = PHASE_LABELS.get(pid, pid)
        m = k.get("meetings", {}).get(pid, {})
        desc = prose_phases.get(label) or (
            f"KBID will complete the {label} phase for this project. This phase includes "
            f"({m.get('meetings','TBD')}) client meetings over {m.get('weeks','TBD')} weeks of time.")
        phases.append({"name": label, "description": desc})
    return {
        "meta": {
            "firm": FIRM, "date": proj.get("date", ""),
            "client_name": client.get("name", ""), "client_address": client.get("address", ""),
            "client_contact": client.get("contact", ""), "client_phone": client.get("phone", ""),
            "client_email": client.get("email", ""), "client_title": client.get("title", ""),
            "project_name": proj.get("name", ""), "project_address": proj.get("address", ""),
            "re": proj.get("name", "") or "Interior Design Services",
        },
        "cover_opener": COVER_OPENER,
        "cover_body": prose.get("cover_letter") or [],
        "cover_closer": COVER_CLOSER,
        "scope_overview": prose.get("scope_overview") or k.get("scope", {}).get("text", ""),
        "phases": phases,
        "terms": EXHIBIT_A,
        "exclusions": excl,
        "schedule": prose.get("schedule") or "",
        "payment": PAYMENT,
        "reimbursables": REIMBURSABLES,
        "documents": DOCUMENTS,
        "limitation": LIMITATION,
        "notice": NOTICE,
        "estimate": (state.get("estimate", {}) or {}).get("result"),
        "fee_mode": (state.get("estimate", {}) or {}).get("feeMode", "lump"),
        "consultants": (state.get("estimate", {}) or {}).get("consultants", {}),
    }


def generate(state: dict) -> dict:
    return build_sections(state, generate_prose(state))
