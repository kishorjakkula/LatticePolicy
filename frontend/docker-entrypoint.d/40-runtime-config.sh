#!/bin/sh
# Writes /runtime-config.js from environment variables at container start so
# one published frontend image can serve any carrier stack. Runs from the
# nginx image's /docker-entrypoint.d hook before nginx starts.
#
#   LATTICE_API_BASE_URL          -> VITE_API_BASE_URL
#   LATTICE_CARRIER_TENANT_ID     -> VITE_CARRIER_TENANT_ID
#   LATTICE_USE_MOCK              -> VITE_USE_MOCK
#   LATTICE_SHOW_DEMO_CREDENTIALS -> VITE_SHOW_DEMO_CREDENTIALS
#
# Unset variables are omitted, leaving any build-time VITE_* value in effect.
set -eu

target="${LATTICE_RUNTIME_CONFIG_PATH:-/usr/share/nginx/html/runtime-config.js}"

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/</\\u003c/g'
}

entries=""
add_entry() {
  key="$1"
  value="$2"
  [ -n "$value" ] || return 0
  [ -z "$entries" ] || entries="$entries,"
  entries="$entries\"$key\":\"$(json_escape "$value")\""
}

add_entry VITE_API_BASE_URL "${LATTICE_API_BASE_URL:-}"
add_entry VITE_CARRIER_TENANT_ID "${LATTICE_CARRIER_TENANT_ID:-}"
add_entry VITE_USE_MOCK "${LATTICE_USE_MOCK:-}"
add_entry VITE_SHOW_DEMO_CREDENTIALS "${LATTICE_SHOW_DEMO_CREDENTIALS:-}"

printf 'window.__LATTICE_RUNTIME_CONFIG__ = {%s}\n' "$entries" > "$target"
