#!/usr/bin/env bash
# Ship KBID prebuilt to the VPS. Build OFF-BOX, load remotely, compose up (no --build).
# The VPS is 1 vCPU / 2 GB — building images on it browns out every site. Never do it.
set -euo pipefail

VPS_HOST="${VPS_HOST:?set VPS_HOST to the deployment server hostname or IP}"
VPS_USER="${VPS_USER:-root}"
APP_DIR="${APP_DIR:-/opt/kbid}"
IMAGE="kbid-proposal-tool:latest"

cd "$(dirname "$0")/.."

echo "==> [1/4] build image off-box"
docker build -t "$IMAGE" .

echo "==> [2/4] ship image  (docker save | gzip | ssh docker load)"
docker save "$IMAGE" | gzip | ssh "${VPS_USER}@${VPS_HOST}" "gunzip | docker load"

echo "==> [3/4] sync compose file"
ssh "${VPS_USER}@${VPS_HOST}" "mkdir -p ${APP_DIR}/backend"
scp docker-compose.yml "${VPS_USER}@${VPS_HOST}:${APP_DIR}/docker-compose.yml"
# backend/.env (prod Clerk keys, POSTGRES_PASSWORD, DEV_AUTH_BYPASS=0) is provisioned
# on the VPS ONCE at ${APP_DIR}/backend/.env — never shipped from a dev machine.

echo "==> [4/4] up (no --build) + health check"
ssh "${VPS_USER}@${VPS_HOST}" "cd ${APP_DIR} && docker compose up -d"
ssh "${VPS_USER}@${VPS_HOST}" "sleep 4 && curl -fsS http://127.0.0.1:8902/healthz && echo '  <- healthy'"
echo "==> done. Public URL fronted by nginx: https://kbid.wetreadwell.com"
