#!/bin/sh
# Operates one carrier stack (see README.md in this directory).
#
#   sh stack.sh init <tenant-id> <version>   write carrier.env with generated secrets
#   sh stack.sh up                           pull images, apply migrations, start
#   sh stack.sh bootstrap                    create the tenant and its first administrator
#   sh stack.sh status                       running release, schema level, health
#   sh stack.sh pack-check [version]         check the carrier pack against a release (default: current)
#   sh stack.sh backup [label]               database + documents into backups/
#   sh stack.sh restore <backup-prefix>      replace database + documents from a backup
#   sh stack.sh upgrade <version>            backup, switch release, migrate, verify
#   sh stack.sh rollback                     return to the release and data before the last upgrade
#   sh stack.sh rollback --keep-data         return to the previous release only; keep current data
#   sh stack.sh down                         stop the stack (data volumes are kept)
#
# The env file defaults to ./carrier.env; override with LATTICE_ENV_FILE.
set -eu

KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${LATTICE_ENV_FILE:-$KIT_DIR/carrier.env}"
BACKUP_DIR="${LATTICE_BACKUP_DIR:-$KIT_DIR/backups}"
RLS_ROLE="lattice_tenant_rls"

die() {
  echo "error: $*" >&2
  exit 1
}

need_env_file() {
  [ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE (run: sh stack.sh init <tenant-id> <version>)"
}

get_env() {
  # Last assignment wins, matching how Compose reads an env file.
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

set_env() {
  key="$1"
  value="$2"
  tmp="$ENV_FILE.tmp.$$"
  if grep -q "^$key=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" 'index($0, k "=") == 1 { print k "=" v; next } { print }' "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

state_file() {
  echo "$KIT_DIR/.stack-state.$(get_env CARRIER_TENANT_ID)"
}

compose() {
  docker compose -p "lattice-$(get_env CARRIER_TENANT_ID)" --env-file "$ENV_FILE" -f "$KIT_DIR/docker-compose.yml" "$@"
}

random_secret() {
  # 48 hex characters; clears the API's 32-character minimum.
  od -An -N24 -tx1 /dev/urandom | tr -d ' \n'
}

pull_images() {
  if [ "$(get_env LATTICE_PULL)" = "0" ]; then
    echo "Skipping image pull (LATTICE_PULL=0)."
  else
    compose pull api frontend
  fi
}

api_get() {
  compose exec -T api wget -qO- "http://localhost:3000$1" 2>/dev/null
}

wait_for_api() {
  attempts=0
  until api_get /health | grep -q '"db":true'; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 60 ]; then
      compose logs --tail=80 api >&2 || true
      return 1
    fi
    sleep 2
  done
}

# Fails when the running API does not report the release in the env file.
# Tags that are not semantic versions (for example a commit sha) are not checked.
verify_running_version() {
  want="$(get_env LATTICE_VERSION)"
  body="$(api_get /version || true)"
  [ -n "$body" ] || { echo "API did not answer /version" >&2; return 1; }
  case "$want" in
    v[0-9]*.[0-9]*.[0-9]*)
      echo "$body" | grep -q "\"version\":\"${want#v}\"" || {
        echo "Expected release ${want#v}, API reports: $body" >&2
        return 1
      }
      ;;
  esac
}

# True when the database holds migrations the running release does not know.
# Expected after an application-only rollback; never acceptable after an upgrade.
schema_is_ahead() {
  api_get /version | grep -q '"schemaAhead":true'
}

note_if_schema_ahead() {
  if schema_is_ahead; then
    echo "note: the database schema is newer than release $(get_env LATTICE_VERSION) (application-only rollback state)."
  fi
}

# --wait blocks until the healthchecks pass; a started container is not yet
# a database that accepts connections.
start_data_services() {
  compose up -d --wait db cache >/dev/null
}

# Checks the mounted carrier pack with the image of the given release, without
# starting or changing anything. Succeeds when no pack is configured.
check_pack() {
  release="${1:-$(get_env LATTICE_VERSION)}"
  if [ -z "$(get_env CARRIER_PACK_PATH)" ]; then
    echo "No carrier pack configured (CARRIER_PACK_PATH is empty)."
    return 0
  fi
  [ -d "$(get_env CARRIER_PACK_PATH)" ] || { echo "carrier pack not found: $(get_env CARRIER_PACK_PATH)" >&2; return 1; }
  # A value in the shell environment overrides the env file for this one call.
  LATTICE_VERSION="$release" compose run --rm -T --no-deps api node server/dist/validateCarrierPack.js /carrier-pack
}

# Every service that runs the release image, plus the UI.
stop_app_services() {
  compose stop api worker dispatcher frontend
}

run_migrations() {
  start_data_services
  compose run --rm -T --no-deps api node server/dist/migrate.js
}

cmd_init() {
  tenant="${1:-}"
  version="${2:-}"
  [ -n "$tenant" ] && [ -n "$version" ] || die "usage: stack.sh init <tenant-id> <version>"
  echo "$tenant" | grep -Eq '^[a-z0-9][a-z0-9-]{1,62}$' || die "tenant id must be 2-63 lowercase letters, digits, or hyphens"
  [ ! -e "$ENV_FILE" ] || die "$ENV_FILE already exists; refusing to overwrite its secrets"
  cp "$KIT_DIR/carrier.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  set_env CARRIER_TENANT_ID "$tenant"
  set_env CARRIER_NAME "$tenant"
  set_env LATTICE_VERSION "$version"
  set_env DB_PASSWORD "$(random_secret)"
  set_env JWT_SECRET "$(random_secret)"
  set_env CUSTOMER_DATA_KEY "$(random_secret)"
  set_env PII_LOOKUP_KEY "$(random_secret)"
  set_env MFA_TOKEN_SECRET "$(random_secret)"
  echo "Wrote $ENV_FILE."
  echo "Set PUBLIC_API_URL and ALLOWED_ORIGINS, then run: sh stack.sh up"
  echo "Store this file with your secrets: backups cannot be read without CUSTOMER_DATA_KEY."
}

cmd_pack_check() {
  need_env_file
  check_pack "${1:-}"
}

cmd_up() {
  need_env_file
  pull_images
  check_pack || die "the carrier pack is not valid for release $(get_env LATTICE_VERSION)"
  run_migrations
  compose up -d
  wait_for_api || die "API did not become healthy"
  verify_running_version || die "running release does not match LATTICE_VERSION"
  note_if_schema_ahead
  cmd_status
}

cmd_bootstrap() {
  need_env_file
  [ -n "${CARRIER_ADMIN_USERNAME:-}" ] && [ -n "${CARRIER_ADMIN_PASSWORD:-}" ] \
    || die "set CARRIER_ADMIN_USERNAME and CARRIER_ADMIN_PASSWORD in the environment for this command"
  start_data_services
  compose run --rm -T --no-deps \
    -e CARRIER_ADMIN_USERNAME="$CARRIER_ADMIN_USERNAME" \
    -e CARRIER_ADMIN_PASSWORD="$CARRIER_ADMIN_PASSWORD" \
    api node server/dist/bootstrapCarrier.js
}

cmd_status() {
  need_env_file
  echo "carrier:  $(get_env CARRIER_TENANT_ID)"
  echo "release:  $(get_env LATTICE_VERSION) (configured)"
  echo "version:  $(api_get /version || echo 'API not reachable')"
  echo "health:   $(api_get /health || echo 'API not reachable')"
  echo "services:"
  compose ps --format '  {{.Service}}: {{.State}}' 2>/dev/null || true
}

# Writes <prefix>.dump (database) and <prefix>.documents.tgz, prints the prefix.
cmd_backup() {
  need_env_file
  label="${1:-manual}"
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  prefix="$BACKUP_DIR/$(get_env CARRIER_TENANT_ID)-$stamp-$(get_env LATTICE_VERSION)-$label"
  start_data_services
  compose exec -T db pg_dump -U "$(get_env DB_USER)" -d "$(get_env DB_NAME)" -Fc > "$prefix.dump"
  [ -s "$prefix.dump" ] || die "database backup is empty"
  compose run --rm -T --no-deps api tar -czf - -C /data/documents . > "$prefix.documents.tgz"
  echo "$prefix"
}

cmd_restore() {
  need_env_file
  prefix="${1:-}"
  [ -n "$prefix" ] || die "usage: stack.sh restore <backup-prefix>"
  prefix="${prefix%.dump}"
  [ -s "$prefix.dump" ] || die "backup not found: $prefix.dump"
  db_user="$(get_env DB_USER)"
  db_name="$(get_env DB_NAME)"

  echo "Restoring $(get_env CARRIER_TENANT_ID) from $prefix (this replaces current data)..."
  # Nothing may write to the database while it is being replaced.
  stop_app_services >/dev/null 2>&1 || true
  start_data_services
  # The restricted RLS role is cluster-wide and referenced by the dump's grants.
  compose exec -T db psql -v ON_ERROR_STOP=1 -U "$db_user" -d postgres -c \
    "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$RLS_ROLE') THEN CREATE ROLE $RLS_ROLE NOLOGIN NOINHERIT; END IF; END \$\$;" >/dev/null
  compose exec -T db psql -v ON_ERROR_STOP=1 -U "$db_user" -d postgres -c "DROP DATABASE IF EXISTS \"$db_name\" WITH (FORCE);" >/dev/null
  compose exec -T db psql -v ON_ERROR_STOP=1 -U "$db_user" -d postgres -c "CREATE DATABASE \"$db_name\" OWNER \"$db_user\";" >/dev/null
  compose exec -T db pg_restore --exit-on-error --no-owner -U "$db_user" -d "$db_name" < "$prefix.dump"
  if [ -s "$prefix.documents.tgz" ]; then
    compose run --rm -T --no-deps api sh -c 'find /data/documents -mindepth 1 -delete && tar -xzf - -C /data/documents' < "$prefix.documents.tgz"
  fi
  # Cached reads may describe the data being replaced.
  compose exec -T cache redis-cli FLUSHALL >/dev/null
  echo "Restore complete."
}

cmd_upgrade() {
  need_env_file
  target="${1:-}"
  [ -n "$target" ] || die "usage: stack.sh upgrade <version>"
  current="$(get_env LATTICE_VERSION)"
  [ "$target" != "$current" ] || die "already configured for $target"

  echo "Upgrading $(get_env CARRIER_TENANT_ID): $current -> $target"
  # Check the carrier's customisations against the new release before anything
  # is stopped, backed up, or migrated.
  if [ "$(get_env LATTICE_PULL)" != "0" ]; then
    LATTICE_VERSION="$target" compose pull api
  fi
  check_pack "$target" || die "the carrier pack does not fit release $target; nothing was changed"
  backup="$(cmd_backup "pre-$target")"
  printf 'PREVIOUS_VERSION=%s\nPREVIOUS_BACKUP=%s\n' "$current" "$backup" > "$(state_file)"
  echo "Backup: $backup"

  set_env LATTICE_VERSION "$target"
  if pull_images && stop_app_services && run_migrations && compose up -d \
     && wait_for_api && verify_running_version && ! schema_is_ahead; then
    echo "Upgrade to $target complete."
    cmd_status
    return 0
  fi

  echo "Upgrade to $target failed; rolling back to $current." >&2
  cmd_rollback
  exit 1
}

cmd_rollback() {
  need_env_file
  state="$(state_file)"
  [ -f "$state" ] || die "no upgrade recorded for this carrier; nothing to roll back to"
  previous_version="$(sed -n 's/^PREVIOUS_VERSION=//p' "$state")"
  previous_backup="$(sed -n 's/^PREVIOUS_BACKUP=//p' "$state")"
  [ -n "$previous_version" ] && [ -n "$previous_backup" ] || die "upgrade record is incomplete: $state"

  if [ "${1:-}" = "--keep-data" ]; then
    # Application-only rollback: valid only when the newer schema is backward
    # compatible with the previous release (see the release notes).
    echo "Rolling back to $previous_version and keeping current data"
    set_env LATTICE_VERSION "$previous_version"
    pull_images
    compose up -d
    wait_for_api || die "API did not become healthy after rollback"
    verify_running_version || die "running release does not match $previous_version after rollback"
    note_if_schema_ahead
    cmd_status
    return 0
  fi

  echo "Rolling back to $previous_version using $previous_backup"
  echo "Data written since that backup will be lost."
  set_env LATTICE_VERSION "$previous_version"
  # Migrations are forward-only, so the pre-upgrade data comes back with the release.
  cmd_restore "$previous_backup"
  compose up -d
  wait_for_api || die "API did not become healthy after rollback"
  verify_running_version || die "running release does not match $previous_version after rollback"
  # The restored backup is exactly the pre-upgrade state, which may itself
  # have been an application-only rollback.
  note_if_schema_ahead
  cmd_status
}

cmd_down() {
  need_env_file
  compose down
}

command="${1:-}"
[ -n "$command" ] || { sed -n '2,15p' "$0"; exit 1; }
shift
case "$command" in
  init) cmd_init "$@" ;;
  up) cmd_up ;;
  bootstrap) cmd_bootstrap ;;
  status) cmd_status ;;
  pack-check) cmd_pack_check "$@" ;;
  backup) cmd_backup "$@" ;;
  restore) cmd_restore "$@" ;;
  upgrade) cmd_upgrade "$@" ;;
  rollback) cmd_rollback "$@" ;;
  down) cmd_down ;;
  *) die "unknown command: $command" ;;
esac
