#!/usr/bin/env sh
set -eu

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo unknown)"

if [ "$NODE_MAJOR" = "20" ]; then
  npm run test:local
  exit 0
fi

if command -v docker >/dev/null 2>&1; then
  echo "Local Node is v$NODE_MAJOR; running tests in Docker Node 20."
  npm run test:docker
  exit 0
fi

echo "Local Node is v$NODE_MAJOR, but this project expects Node 20." >&2
echo "Install Node 20 or Docker, then rerun npm test." >&2
exit 1
