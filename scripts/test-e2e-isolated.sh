#!/bin/sh
# Runs the Playwright suite against a disposable stack (docker-compose.e2e.yml)
# on its own ports and volumes. Unlike scripts/test-e2e-docker.sh this never
# touches the local demo stack or its latticepolicy_pgdata / redisdata volumes.
#
#   sh scripts/test-e2e-isolated.sh                 # full suite
#   sh scripts/test-e2e-isolated.sh e2e/quote-wizard.spec.ts
#   E2E_KEEP_STACK=1 sh scripts/test-e2e-isolated.sh # leave the stack up afterwards
set -eu

COMPOSE="docker compose -f docker-compose.e2e.yml"
export E2E_API_PORT="${E2E_API_PORT:-3301}"
export E2E_UI_PORT="${E2E_UI_PORT:-5174}"
export E2E_BASE_URL="http://localhost:${E2E_UI_PORT}"
export E2E_API_BASE_URL="http://localhost:${E2E_API_PORT}"

cleanup() {
  status=$?
  if [ "${E2E_KEEP_STACK:-0}" != "1" ]; then
    $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

# Always start from an empty database so runs are reproducible.
$COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
$COMPOSE up -d --build

echo "Waiting for API health..."
attempts=0
until curl -fsS "$E2E_API_BASE_URL/health" 2>/dev/null | grep -q '"db":true'; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 60 ]; then
    echo "API did not become healthy at $E2E_API_BASE_URL/health" >&2
    $COMPOSE ps >&2 || true
    $COMPOSE logs --tail=120 >&2 || true
    exit 1
  fi
  sleep 2
done

echo "Waiting for frontend..."
attempts=0
until curl -fsS "$E2E_BASE_URL" >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 60 ]; then
    echo "Frontend did not become ready at $E2E_BASE_URL" >&2
    exit 1
  fi
  sleep 2
done

npx playwright test "$@"
