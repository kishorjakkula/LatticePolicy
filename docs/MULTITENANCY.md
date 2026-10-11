Multi-Tenancy Strategy

Tenant Models
- Shared database with `tenant_id` on all rows; enforce row-level security where supported.
- Optional per-tenant database for large or regulated tenants; same schema, separate connection.

Tenant Resolution
- Resolve from request host, header `X-Tenant`, or auth claims.
- Establish TenantContext early (gateway/middleware). All services must accept it explicitly.

Config Loading (precedence)
1) Base defaults
2) Product pack defaults (LOB-specific)
3) Tenant overrides (config + hooks)
4) Runtime flags/experiments

Isolation
- No patching of core. Only extend via documented hooks and configuration.
- Validate and sandbox tenant-provided rule modules; restrict I/O and network.

Data Partitioning
- All primary keys include `(tenant_id, id)` composite or `tenant_id` indexed.
- Migrations are additive and idempotent; run per-tenant scope when needed.

Versioning and Upgrades
- Keep extension point contracts backward compatible.
- Provide migration guides and compatibility matrix per release.

Single-Carrier Stacks (CARRIER_TENANT_ID)
- The target production model is one full stack per carrier (API, worker, UI,
  database, cache, storage). Set `CARRIER_TENANT_ID=<tenant id>` on the API to
  pin a stack to its carrier.
- When pinned: `tenancyMiddleware` rejects any `X-Tenant`, `?tenant=`, or token
  tenant other than the pinned one with `403 TENANT_NOT_SERVED`, and resolves
  requests that name no tenant to the pinned tenant. Login and the
  `/auth/sso/:tenantId/*` routes apply the same rule.
- When pinned: the job scheduler, job run claims, async outbox worker, and
  rating model cache warm-up only touch the pinned tenant's rows, and demo
  seed users are not created unless the pinned tenant is `sample-carrier`.
- When unset: tenant resolution is unchanged (header, query, then token).

Fail-Closed Rules (all modes)
- `withTenantTx` rejects an empty tenant id (`TENANT_REQUIRED`) and, when
  pinned, any other tenant id. It is the backstop behind the request-edge
  checks; do not open tenant work on the raw pool.
- `toRawQuery` only accepts a handle created by `withTenantTx`/`req.tx`. It no
  longer falls back to the shared pool; passing any other handle throws.
- Login rejects an account whose tenant differs from the tenant being signed
  into, so one tenant's MFA and local-auth settings are never applied to
  another tenant's user.
- Known gap: row-level security policies exist but are not enforced at
  runtime, because the API connects as the table owner and the tables do not
  use `FORCE ROW LEVEL SECURITY`. Application-level tenant filters remain the
  effective control until the non-owner database role work lands.
