#!/bin/sh
set -eu

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

export DB_PASSWORD="${DB_PASSWORD:-lattice_policy_dev}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-latticepolicy}"
export DEPLOYMENT_ENV="${DEPLOYMENT_ENV:-local}"
export JWT_SECRET="${JWT_SECRET:-dev-secret}"
export CUSTOMER_DATA_KEY="${CUSTOMER_DATA_KEY:-customer-data-key-for-local-docker-e2e}"
export MFA_TOKEN_SECRET="${MFA_TOKEN_SECRET:-mfa-token-secret-for-local-docker-e2e}"
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:5173}"
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://localhost:3300}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:5173}"
export E2E_API_BASE_URL="${E2E_API_BASE_URL:-http://localhost:3300}"

wait_for_url() {
  name="$1"
  url="$2"
  attempts="${3:-60}"

  echo "Waiting for $name..."
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name is ready"
      return 0
    fi
    sleep 2
  done

  echo "$name did not become ready at $url" >&2
  docker compose ps >&2 || true
  docker compose logs --tail=120 db cache server frontend >&2 || true
  return 1
}

wait_for_api_health() {
  echo "Waiting for API health..."
  for _ in $(seq 1 60); do
    health="$(curl -fsS "$E2E_API_BASE_URL/health" 2>/dev/null || true)"
    if echo "$health" | grep -q '"db":true'; then
      echo "API health is ready"
      return 0
    fi
    sleep 2
  done

  echo "API health did not become ready at $E2E_API_BASE_URL/health" >&2
  docker compose ps >&2 || true
  docker compose logs --tail=120 db cache server frontend >&2 || true
  return 1
}

docker compose down -v --remove-orphans
docker compose up -d --build db cache server frontend

wait_for_api_health
wait_for_url "frontend" "$E2E_BASE_URL"

npx playwright test "$@"
