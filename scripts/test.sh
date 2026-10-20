#!/usr/bin/env sh
set -eu

NODE_VERSION="$(node -p "process.versions.node" 2>/dev/null || echo unknown)"

if node scripts/node-runtime.mjs; then
  npm run test:local
  exit 0
fi

if command -v docker >/dev/null 2>&1; then
  echo "Local Node is v$NODE_VERSION; running tests in Docker Node 22."
  npm run test:docker
  exit 0
fi

echo "Install a supported Node version or Docker, then rerun npm test." >&2
exit 1
