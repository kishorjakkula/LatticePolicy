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
VOLUME="${NODE_TEST_VOLUME:-latticepolicy-test-node-modules}"
DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@host.docker.internal:${HOST_PORT}/${DB_NAME}"

# The suite renders PDFs with Puppeteer, so the runner needs a browser. By
# default build the test-only runner image (scripts/integration-test-runner.Dockerfile),
# which mirrors the production server image: node:22-alpine plus Alpine's
# Chromium with PUPPETEER_EXECUTABLE_PATH set. Docker's layer cache makes
# repeat builds near-instant.
#   NODE_TEST_BASE_IMAGE  base image for that build (default node:22-alpine)
#   NODE_TEST_IMAGE       use this image as-is instead of building; it must
#                         provide a browser Puppeteer can launch
#   NODE_TEST_PUPPETEER_EXECUTABLE_PATH  browser path inside NODE_TEST_IMAGE
if [ -n "${NODE_TEST_IMAGE:-}" ]; then
  IMAGE="$NODE_TEST_IMAGE"
else
  IMAGE="latticepolicy-integration-runner:local"
  SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
  echo "Building integration test runner image ($IMAGE)..."
  # No build context is needed: the Dockerfile copies nothing from the repo.
  docker build -q \
    --build-arg NODE_BASE_IMAGE="${NODE_TEST_BASE_IMAGE:-node:22-alpine}" \
    -t "$IMAGE" \
    - < "$SCRIPT_DIR/integration-test-runner.Dockerfile" >/dev/null
fi

set --
if [ -n "${NODE_TEST_PUPPETEER_EXECUTABLE_PATH:-}" ]; then
  set -- -e PUPPETEER_EXECUTABLE_PATH="$NODE_TEST_PUPPETEER_EXECUTABLE_PATH"
fi

docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL="$DATABASE_URL" \
  -e LATTICE_DISPOSABLE_TEST_DATABASE=true \
  -e TENANT_RLS_ENFORCED=true \
  "$@" \
  -v "$PWD":/app \
  -v "$VOLUME":/app/node_modules \
  -w /app \
  "$IMAGE" \
  sh -lc 'npm install --include=optional && npm run test:integration --workspace=server'
