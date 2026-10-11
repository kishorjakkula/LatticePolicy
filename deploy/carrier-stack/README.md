# Carrier Stack Deployment Kit

Runs one carrier on its own full stack: API, UI, PostgreSQL, Redis, and
document storage. The same kit is used when the platform owner hosts a carrier
and when a carrier hosts the stack in its own environment.

- One stack serves exactly one carrier (`CARRIER_TENANT_ID`). Every other
  tenant id is rejected, and tenant row-level security is enforced in the
  database.
- The stack runs published release images. Nothing is built on the host, so a
  carrier-hosted stack is never a special build.
- The carrier chooses when to take a release: `stack.sh upgrade <version>`.

This is a single-host reference using Docker Compose. For a managed cloud
database or an orchestrator, keep the same images and settings and follow
`docs/CLOUD_DEPLOYMENT.md`; see [Using a managed database](#using-a-managed-database).

## Requirements

- Docker Engine with the Compose v2 plugin (the kit uses `docker compose up --wait`).
- Access to the release images, or the images pre-loaded on the host with
  `LATTICE_PULL=0`.
- HTTPS termination in front of the API and UI ports for any non-trial use.

## Files

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | The five services and three data volumes. |
| `carrier.env.example` | Template for the per-carrier settings file. |
| `stack.sh` | Provision, bootstrap, backup, restore, upgrade, and rollback. |

`carrier.env`, `backups/`, and `.stack-state.*` are created at run time and
are ignored by git.

## First install

```bash
cd deploy/carrier-stack

# 1. Create carrier.env with generated secrets.
sh stack.sh init acme-mutual v0.3.0

# 2. Edit carrier.env: set PUBLIC_API_URL and ALLOWED_ORIGINS to the public
#    HTTPS addresses, and CARRIER_NAME to the display name.

# 3. Apply migrations and start the stack.
sh stack.sh up

# 4. Create the carrier and its first administrator.
CARRIER_ADMIN_USERNAME=admin@acme.example \
CARRIER_ADMIN_PASSWORD='choose-a-strong-password' \
  sh stack.sh bootstrap

# 5. Confirm.
sh stack.sh status
```

The administrator password must be at least the policy minimum length with
upper and lower case, a digit, and a symbol. `bootstrap` is safe to run again:
it never changes an existing tenant or resets an existing password.

For a trial on one machine over plain HTTP, set `DEPLOYMENT_ENV=local`,
`PUBLIC_API_URL=http://localhost:3300`, and
`ALLOWED_ORIGINS=http://localhost:8080`. Production settings reject HTTP and
localhost origins.

## Settings that matter

| Setting | Notes |
| --- | --- |
| `CARRIER_TENANT_ID` | Lowercase slug. Cannot be changed after first install. |
| `LATTICE_VERSION` | Release tag to run. Changed by `upgrade` and `rollback`. |
| `PUBLIC_API_URL` | Address browsers use to reach the API. Given to the UI at container start. |
| `ALLOWED_ORIGINS` | Public UI address(es) allowed to call the API. |
| `TENANT_RLS_ENFORCED` | Leave at `1`. |
| `CUSTOMER_DATA_KEY`, `PII_LOOKUP_KEY` | Encrypt and index customer data. **A database backup is unreadable without the same values.** Store `carrier.env` in your secret store alongside your backups, never only on the host. |

Several carriers on one host each need their own directory copy or
`LATTICE_ENV_FILE`, and distinct `API_PORT` and `UI_PORT` values. Each gets its
own Compose project (`lattice-<tenant-id>`), database, and volumes.

## Backup and restore

```bash
sh stack.sh backup nightly
# -> backups/acme-mutual-<UTC timestamp>-<release>-nightly
#      .dump            PostgreSQL custom-format dump
#      .documents.tgz   generated documents

sh stack.sh restore backups/acme-mutual-20261011T004332Z-v0.3.0-nightly
sh stack.sh up
```

- `restore` replaces the current database and documents. It stops the API
  first and clears the cache afterwards.
- Run the release named in the backup file, or a later one. Starting a later
  release applies its migrations to the restored data.
- Copy backups off the host and apply your own retention. Schedule `backup`
  with cron or your scheduler; nothing is scheduled by the kit.
- Test a restore on a non-production host before relying on it.

## Taking a release

```bash
sh stack.sh upgrade v0.4.0
```

`upgrade` does this, in order:

1. Takes a backup labelled `pre-<version>`.
2. Records the current release and that backup.
3. Pulls the new images, stops the API and UI, and applies migrations.
4. Starts the new release and waits for it to report healthy, on the expected
   release, with a schema level it understands.

If any step fails, it restores the pre-upgrade backup, returns to the previous
release, and exits non-zero. Expect downtime for the length of the upgrade.

Before a production upgrade:

- Read the release notes for migrations and for changes to the product pack
  or custom field contracts.
- Run the same `upgrade` on a staging stack restored from a recent production
  backup, and check your own products, fields, and integrations there.
- Choose a window; the stack is unavailable while migrations run.

Supported releases are the current one and the one before it. A stack more
than one release behind should upgrade one release at a time unless the
release notes say a direct jump is supported.

## Rolling back after an upgrade

There are two ways back, and they are not interchangeable.

| Command | What it does | Use when |
| --- | --- | --- |
| `sh stack.sh rollback` | Restores the pre-upgrade backup and the previous release. **Everything written since the upgrade is lost.** | The upgrade damaged data, or nothing important has been written since. |
| `sh stack.sh rollback --keep-data` | Returns to the previous release only. Current data and the newer schema stay. | The new release misbehaves but its migrations are backward compatible with the previous release (stated in the release notes). |

After `--keep-data`, `status` and the API log note that the database schema is
newer than the running release. That is expected until you upgrade again.

Migrations are forward-only; there are no down-migrations. See
`docs/PRODUCTION_RUNBOOKS.md` for the full rollback guidance.

## Checking a stack

```bash
sh stack.sh status
```

- `GET /version` on the API returns the running release, the build commit,
  and the schema level. It needs no login and exposes no carrier data.
- `GET /health` returns database and cache reachability.

## Using a managed database

For a managed PostgreSQL service, run only the `api`, `frontend`, and `cache`
services from these images and point `DATABASE_URL` at the managed database.
In that setup:

- Use the provider's backups and point-in-time recovery instead of
  `stack.sh backup` and `restore`.
- Run `node server/dist/migrate.js` from the API image as a one-off job before
  starting a new release, then `node server/dist/bootstrapCarrier.js` once on
  first install.
- The database user that runs migrations needs `CREATEROLE` so migration 058
  can create the `lattice_tenant_rls` role, or an administrator must create
  and grant that role first (`docs/MULTITENANCY.md`).

## Responsibilities when the carrier hosts

| Area | Carrier-hosted stack |
| --- | --- |
| Hosts, network, TLS, firewalling | Carrier |
| Backups, retention, restore testing | Carrier |
| When to take a release | Carrier, within the supported-release window |
| Security fixes | Platform owner publishes; carrier applies within the agreed deadline |
| Monitoring | Carrier; the platform owner sees only what the carrier chooses to share |
| Release images, migrations, this kit | Platform owner |

## What the kit does not do yet

- No scheduled backups, off-host copy, or retention.
- No zero-downtime upgrade; the API stops while migrations run.
- No TLS termination or reverse proxy.
- No Kubernetes, ECS, or Container Apps templates for a per-carrier stack.
- Upgrade tooling checks the release and schema level only; it does not yet
  check a carrier's own product packs and custom fields against the target
  release.
