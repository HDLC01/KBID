# KBID Proposal Generator — single app image (FastAPI serves API + static frontend).
# Built OFF-BOX and shipped prebuilt (see deploy/ship.sh) — never built on the VPS.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

# System deps: tini/curl; libreoffice-writer for .docx -> PDF; Node + the Claude
# Code CLI for `claude -p` narrative generation (auth via CLAUDE_CODE_OAUTH_TOKEN).
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl tini ca-certificates gnupg libreoffice-writer \
      fonts-crosextra-carlito fonts-liberation \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
ENV CLAUDE_CONFIG_DIR=/root/.claude

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY backend/ /app/
COPY frontend/package.json /app/frontend/package.json
RUN npm install --omit=dev --ignore-scripts --prefix /app/frontend
COPY frontend/ /app/frontend/

ENV FRONTEND_DIR=/app/frontend PORT=8902 APP_ENV=prod
EXPOSE 8902
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:8902/healthz || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8902", "--workers", "1"]
