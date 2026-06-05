#!/usr/bin/env sh
set -eu

IMAGE="${NODE_TEST_IMAGE:-node:20-alpine}"
VOLUME="${NODE_TEST_VOLUME:-latticepolicy-test-node-modules}"

docker run --rm \
  -v "$PWD":/app \
  -v "$VOLUME":/app/node_modules \
  -w /app \
  "$IMAGE" \
  sh -lc 'npm install --include=optional && npm run test:server && npm run test:frontend && npm run typecheck'
