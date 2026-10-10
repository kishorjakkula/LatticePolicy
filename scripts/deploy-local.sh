#!/bin/sh
# Deploys the local Docker Compose demo stack and then runs Playwright.
#
#   sh scripts/deploy-local.sh
#
# 1. Rebuilds and restarts the demo stack (docker-compose.yml, UI :5173, API :3300).
# 2. Runs the @smoke Playwright tests against that deployed stack.
# 3. Runs the full Playwright suite against a disposable copy of the same build
#    (docker-compose.e2e.yml), so demo data stays clean and the per-IP rate
#    limiters on the demo stack are not exhausted.
#
# Set DEPLOY_SKIP_FULL_E2E=1 to stop after the smoke tests.
set -eu

export E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:5173}"
export E2E_API_BASE_URL="${E2E_API_BASE_URL:-http://localhost:3300}"

docker compose up -d --build

echo "Waiting for API health..."
attempts=0
until curl -fsS "$E2E_API_BASE_URL/health" 2>/dev/null | grep -q '"db":true'; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 60 ]; then
    echo "API did not become healthy at $E2E_API_BASE_URL/health" >&2
    docker compose ps >&2 || true
    docker compose logs --tail=120 server >&2 || true
    exit 1
  fi
  sleep 2
done

echo "Running post-deploy smoke tests against $E2E_BASE_URL..."
npx playwright test --grep @smoke

if [ "${DEPLOY_SKIP_FULL_E2E:-0}" = "1" ]; then
  echo "Skipping full suite (DEPLOY_SKIP_FULL_E2E=1)."
  exit 0
fi

echo "Running the full suite against an isolated copy of this build..."
unset E2E_BASE_URL E2E_API_BASE_URL
sh scripts/test-e2e-isolated.sh
