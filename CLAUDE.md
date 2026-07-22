# I am KBID Proposal-Tool Agent

This repository is the **KBID Proposal Generator** for Kali Buchanan Interior Design
(KBID). If a session begins here, confirm with: **"I am KBID Proposal-Tool Agent"**.

## Scope and non-negotiable source material

KBID is a separate client/company from Treadwell. Time is billed separately and must be
recorded in this project's `TIME_LOG.md` when it exists. The system produces a complete,
client-ready KBID proposal from a guided intake, live fee math, and staff review.

`Info Sheet/` contains the functional brief, six real KBID proposals, and the Switzer
estimate workbook. They are the ground truth for voice, fee presentation, and document
layout. Read the brief and samples before changing proposal generation. Never overwrite,
rename, or modify those originals; derive outputs in memory or in new files only.

## Locked architecture — verified from source on 2026-07-22

- Standalone FastAPI application plus static vanilla HTML/CSS/JS frontend, served from one
  container on port `8902`; target domain `kbid.wetreadwell.com`.
- Clerk is the managed, invitation-only identity layer. Backend JWT validation uses Clerk
  JWKS; `AUTH_ALLOWLIST` is the access boundary and `AUTH_ADMINS` is the admin subset.
- Data is in this app's Dockerized Postgres database — never the shared Treadwell
  Supabase database. Drafts, estimates, user records, and events are local to KBID.
- The server-authoritative calculation engine reproduces the Switzer fee math. The
  browser may display a preview but must not become the pricing authority.
- Narrative generation uses local `claude -p`; `.docx`/PDF output uses `python-docx` and
  LibreOffice. The deployment image includes the Claude CLI and LibreOffice; runtime
  Claude auth remains a private environment/volume concern.
- InDesign Tagged Text is a supporting export for Kali's final workflow. It does not
  replace the primary Word `.docx` deliverable.

## Actual implementation status

- P1/P2 foundation is present: Clerk gate, schema, draft lifecycle, intake SPA, and live
  estimate endpoints (`/api/estimate/compute`, `/api/estimate/rates`).
- P3 implementation is present in source: `proposal_gen.py` builds ordered proposal
  sections, calls Claude only for voice-critical prose, and `docx_builder.py` renders the
  KBID layout. Endpoints generate proposal sections, `.docx`, and PDF.
- P4 implementation is present in source: `/api/proposal/indesign` returns Tagged Text;
  feedback text is recorded as an event.
- Before treating P3/P4 as released, run an end-to-end local test using a non-production
  draft and compare the output against the KBID samples. Rendering, voice, legal text,
  fee totals, and PDF conversion all require human verification.
- Deployment remains a planned/approval-gated operation. This workspace repository has
  no committed history yet, so establish a clean initial commit and test evidence before
  enabling a production release.

## Proposal and pricing rules

- Fees are included. The standard rate table is Owner/Director $210, Design Director
  $200, Interior Designer $170, and Designer $150 per hour, with phase fees/meeting fees
  and budget/$-per-SF cross-checks managed by `services/calc_engine.py`.
- Claude may write only the project-specific cover/scope/phase/schedule prose. It must not
  invent fee values, change exclusions, paraphrase fixed legal clauses, or fabricate facts.
- The proposal ordering is fixed: cover, scope/fees, selected phases, terms, exclusions,
  schedule, fees/reimbursables, payment, documents/photos, limitation, notice, signature.
- Boilerplate in `proposal_gen.py` originates from KBID's own material. Preserve it unless
  the client explicitly approves a legal/content change.
- The document design is US Letter, 1-inch margins, Arial, KBID mark/footer, fee blocks,
  Word bullets, and a two-column signature block. Do not replace it with a generic new
  layout merely because a template is unavailable.

## Code map

| Location | Responsibility |
|---|---|
| `backend/app/main.py` | App boot, Clerk browser config, static frontend serving. |
| `backend/app/auth.py` | Clerk JWT verification, allowlist/admin role checks, dev-only bypass. |
| `backend/schema.sql`, `app/db.py` | Postgres schema, pools, events, draft persistence. |
| `routers/drafts.py`, `estimates.py` | Draft lifecycle, compute/rates APIs. |
| `routers/proposals.py` | Generate, document/PDF, feedback, and Tagged Text download APIs. |
| `services/calc_engine.py` | Server-authoritative Switzer fee calculations. |
| `services/proposal_gen.py` | KBID facts/boilerplate and constrained Claude prose assembly. |
| `services/docx_builder.py`, `indesign_export.py` | Word/PDF layout and Tagged Text export. |
| `frontend/` | Approved-design-derived single-page Intake → Estimate → Proposal → Files workflow. |

## Local development and verification

```powershell
# create/run local Postgres on loopback 5438, or use the documented Docker command in README.md
cd backend
pip install -r requirements.txt
copy .env.example .env
# DEV_AUTH_BYPASS=1 is allowed only locally; never in production
uvicorn app.main:app --reload --port 8902

# calculator regression against the provided Switzer workbook
python -m app.services.calc_engine
```

Then test draft save/restore, estimate calculation, proposal section generation, `.docx`,
PDF conversion, and Tagged Text download. Use real sample data only under the scope of
this client engagement and never send generated material without KBID review.

## Deploy and safety rules

- `deploy/ship.sh` builds off-box, sends a prebuilt image, and runs Compose without
  `--build`. The shared VPS is 1 vCPU/2 GB; never build images on it.
- Production needs private `backend/.env` Clerk values, a strong Postgres password,
  `DEV_AUTH_BYPASS=0`, and working Claude credentials. Do not commit any of them.
- Keep `Info Sheet/` immutable, protect customer names/content, and log billed work.
- Test locally and get Hanz's explicit approval before push, deployment, DNS, or client
  release changes.
