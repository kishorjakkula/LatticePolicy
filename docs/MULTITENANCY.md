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

