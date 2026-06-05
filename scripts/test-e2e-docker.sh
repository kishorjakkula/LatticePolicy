#!/bin/sh
set -eu

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

export DB_PASSWORD="${DB_PASSWORD:-lattice_policy_dev}"
export JWT_SECRET="${JWT_SECRET:-dev-secret}"
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://localhost:3300}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:5173}"
export E2E_API_BASE_URL="${E2E_API_BASE_URL:-http://localhost:3300}"

docker compose up -d --build db cache server frontend

echo "Waiting for API health..."
for _ in $(seq 1 60); do
  if curl -fsS "$E2E_API_BASE_URL/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "Waiting for frontend..."
for _ in $(seq 1 60); do
  if curl -fsS "$E2E_BASE_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

npx playwright test "$@"
