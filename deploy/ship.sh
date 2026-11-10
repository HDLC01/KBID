#!/usr/bin/env bash
# Ship KBID prebuilt to the VPS. Build OFF-BOX, load remotely, compose up (no --build).
# The VPS is 1 vCPU / 2 GB — building images on it browns out every site. Never do it.
#
# The default target is the `treadwell-vps` alias in ~/.ssh/config, which supplies the
# host, port, user and key. It logs in as a non-root user and the box runs every
# command (and scp) as root via sudo. VPS_HOST / VPS_USER still override it.
set -euo pipefail

VPS_HOST="${VPS_HOST:-treadwell-vps}"
VPS_USER="${VPS_USER:-}"
TARGET="${VPS_USER:+${VPS_USER}@}${VPS_HOST}"
APP_DIR="${APP_DIR:-/opt/kbid}"
IMAGE="kbid-proposal-tool:latest"

cd "$(dirname "$0")/.."

echo "==> [1/4] build image off-box"
docker build -t "$IMAGE" .

echo "==> [2/4] ship image  (docker save | gzip | ssh docker load)"
docker save "$IMAGE" | gzip | ssh "${TARGET}" "gunzip | docker load"

echo "==> [3/4] sync compose file"
ssh "${TARGET}" "mkdir -p ${APP_DIR}/backend"
scp docker-compose.yml "${TARGET}:${APP_DIR}/docker-compose.yml"
# backend/.env (prod Clerk keys, POSTGRES_PASSWORD, DEV_AUTH_BYPASS=0, and
# CLAUDE_CODE_OAUTH_TOKEN — see README.md's Deploy section; without it the
# Proposal section silently fails) is provisioned on the VPS ONCE at
# ${APP_DIR}/backend/.env — never shipped from a dev machine.

echo "==> [4/4] up (no --build) + health check"
ssh "${TARGET}" "cd ${APP_DIR} && docker compose up -d"
ssh "${TARGET}" "sleep 4 && curl -fsS http://127.0.0.1:8902/healthz && echo '  <- healthy'"
echo "==> done. Public URL fronted by nginx: https://kbid.wetreadwell.com"
echo "==> verify claude auth if the Proposal section was ever broken:"
echo "      ssh ${TARGET} docker exec kbid-proposal-tool claude -p 'say ok'"
