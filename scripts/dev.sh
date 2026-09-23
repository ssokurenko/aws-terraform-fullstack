#!/usr/bin/env bash
# Run the whole app locally with no AWS account:
#   Postgres + MinIO in Docker, the real Lambda handlers behind a local dev server,
#   and the Vite dev server with hot reload.
# Ctrl+C stops the Node processes; containers keep running (docker compose -f local/compose.yaml down).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/_lib.sh"

npm_install() { if [ -f package-lock.json ]; then npm ci; else npm install; fi; }

echo "==> Starting Postgres and S3 emulator"
docker compose -f "$ROOT/local/compose.yaml" up -d --wait

[ -d "$ROOT/backend/node_modules" ] || (cd "$ROOT/backend" && npm_install)
[ -d "$ROOT/frontend/node_modules" ] || (cd "$ROOT/frontend" && npm_install)

echo "==> Starting API dev server on :3001 and Vite on :5173"
(cd "$ROOT/backend" && npm run dev) &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' INT TERM
trap 'rc=$?; kill $API_PID 2>/dev/null || true; __pause $rc' EXIT

cd "$ROOT/frontend"
VITE_API_ORIGIN=http://localhost:3001 npm run dev
