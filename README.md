# KBID Proposal Generator

Internal tool for **Kali Buchanan Interior Design (KBID)** — a multi-step intake form,
a live fee estimate, and a client-ready proposal in KBID's voice and template.
Standalone (own repo / container / subdomain), built *like* the Treadwell proposal tool.
See `CLAUDE.md` for the full decision log and the plan at
`~/.claude/plans/so-we-are-tasked-curried-ripple.md`.

## Stack
- **Backend:** FastAPI (Python 3.11) — serves the API and the static frontend.
- **Frontend:** single-page vanilla HTML/CSS/JS (`frontend/`), ported from the approved
  Claude Design UI. Stages: **Intake → Estimate → Proposal → Files**.
- **Auth:** Clerk (`@clerk/clerk-js` gate + FastAPI JWKS verify); invitation-only allowlist.
- **DB:** self-hosted Postgres (Docker) — drafts/estimates/users/events.
- **Estimate:** server-authoritative calc engine (`backend/app/services/calc_engine.py`),
  reproduces KBID's Switzer workbook math exactly.

## Layout
```
backend/app/       config.py · main.py · auth.py · db.py
backend/app/services/calc_engine.py     # KBID fee math (Section C)
backend/app/routers/  estimates.py · drafts.py
backend/schema.sql · requirements.txt · .env.example
frontend/          index.html · styles.css · app.js
deploy/            ship.sh · nginx.conf
Dockerfile · docker-compose.yml
Info Sheet/        Local-only private KBID brief, proposal samples, and workbook (not committed)
```

## Local dev
```bash
# 1. Postgres (Docker) on 127.0.0.1:5438
docker run -d --name kbid-db-dev -e POSTGRES_USER=kbid -e POSTGRES_PASSWORD=kbid_dev_pw \
  -e POSTGRES_DB=kbid -p 127.0.0.1:5438:5432 postgres:16-alpine

# 2. Backend deps
cd backend && pip install -r requirements.txt

# 3. Env: cp .env.example .env   (DEV_AUTH_BYPASS=1 skips Clerk locally)

# 4. Run  (schema auto-creates on startup)
uvicorn app.main:app --reload --port 8902
# -> http://127.0.0.1:8902
```
Verify the calc engine against the Switzer workbook:
`python -m app.services.calc_engine`  (expects design fee $44,210).

## Deploy (kbid.wetreadwell.com)
Build off-box, ship prebuilt — **never build on the VPS**:
```bash
VPS_HOST=your-server deploy/ship.sh  # docker build -> save|ssh load -> compose up -d
```
Prereqs on the VPS: `/opt/kbid/backend/.env` with prod Clerk keys, a strong
`POSTGRES_PASSWORD`, and `DEV_AUTH_BYPASS=0`; nginx block (`deploy/nginx.conf`) + certbot.

**One-time Claude auth (required for the Proposal section to work at all).**
Proposal generation shells out to `claude -p` inside the container. Without this
step every "Generate proposal" click either times out or silently returns a
near-blank proposal (see `backend/app/services/claude_cli.py`'s `ClaudeUnavailable`
error, visible in `docker logs kbid-proposal-tool`, and `/healthz`'s `claude_bin`
field for a quick presence check):
```bash
# on a machine already logged in to Claude Code:
claude setup-token
# add the printed token to /opt/kbid/backend/.env on the VPS:
echo 'CLAUDE_CODE_OAUTH_TOKEN=...' >> /opt/kbid/backend/.env
# then (re)deploy — docker-compose.yml's env_file passes it straight into the
# container, and `claude` reads it with no interactive login needed.
```
`docker-compose.yml` also mounts a persistent `claude_credentials` volume for
`/root/.claude`, so an interactive `docker exec -it kbid-proposal-tool claude login`
(fallback path) survives redeploys too — but the token above is the primary,
non-interactive method and doesn't require re-doing anything on every deploy.

## Status
- Done: P1 scaffold + Clerk (backend) + Postgres · P2 intake + live estimate calculator
- Done: P3 proposal generation (`claude -p` narrative + reverse-engineered KBID `.docx`/PDF template)
- Done: P4 InDesign-ready export · P5 deployed to kbid.wetreadwell.com
- Pending: P6 feedback loop (Option B: upload-and-diff)
