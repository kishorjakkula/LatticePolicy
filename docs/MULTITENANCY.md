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

Row-Level Security Enforcement (TENANT_RLS_ENFORCED)
- Postgres does not apply RLS policies to a table's owner or to a superuser,
  and the API connects as the owner. With `TENANT_RLS_ENFORCED` off (default)
  the policies exist but are not evaluated; application-level tenant filters
  are the effective control.
- With `TENANT_RLS_ENFORCED=1`, `withTenantTx` runs `SET LOCAL ROLE
  lattice_tenant_rls` at the start of every tenant transaction. That role is
  not an owner, cannot bypass RLS, and cannot log in, so every policy applies:
  an unfiltered query sees only the transaction's tenant and a write for
  another tenant is rejected. The connection returns to the owner role at
  COMMIT/ROLLBACK.
- Migration `058_tenant_rls_enforcement.sql` creates the role, grants it DML
  on current and future tables, adds parent-scoped policies for `user_roles`,
  `party_contacts`, `party_licenses`, and `party_roles`, and enables RLS on
  `auto_vehicles`, `dwellings`, and `short_rate_tables`.
- If the migration user lacks `CREATEROLE`, the migration still applies but
  logs a notice. An operator then runs `CREATE ROLE lattice_tenant_rls NOLOGIN
  NOINHERIT;`, `GRANT lattice_tenant_rls TO <app user>;` and the table and
  sequence grants from the migration before turning enforcement on. Startup
  refuses to run with enforcement on when the role is unusable.
- Still on the owner connection by design: migrations, the cross-tenant
  claim queries in the job scheduler, job queue, and outbox worker, the
  username lookup at login, and the rating model cache warm-up. Scope any new
  raw-pool query by tenant explicitly.
- Every new tenant table needs `ENABLE ROW LEVEL SECURITY` and a
  `tenant_isolation` policy; `tenant-rls-enforcement.integration.test.ts`
  fails if one is missing.
