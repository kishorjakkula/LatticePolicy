#!/usr/bin/env sh
set -eu

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for integration tests." >&2
  exit 1
fi

CONTAINER_NAME="lattice-policy-test-db-$$"
DB_USER="lattice_policy"
DB_PASSWORD="integration_password"
DB_NAME="lattice_policy_integration"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run -d \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="$DB_PASSWORD" \
  -e POSTGRES_DB="$DB_NAME" \
  -p 127.0.0.1::5432 \
  postgres:15 >/dev/null

echo "Waiting for disposable PostgreSQL container..."
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
  echo "PostgreSQL did not become ready in time." >&2
  docker logs "$CONTAINER_NAME" >&2 || true
  exit 1
fi

HOST_PORT="$(docker inspect -f '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$CONTAINER_NAME")"
IMAGE="${NODE_TEST_IMAGE:-node:20-alpine}"
VOLUME="${NODE_TEST_VOLUME:-latticepolicy-test-node-modules}"
DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@host.docker.internal:${HOST_PORT}/${DB_NAME}"

docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL="$DATABASE_URL" \
  -v "$PWD":/app \
  -v "$VOLUME":/app/node_modules \
  -w /app \
  "$IMAGE" \
  sh -lc 'npm install --include=optional && npm run test:integration --workspace=server'
