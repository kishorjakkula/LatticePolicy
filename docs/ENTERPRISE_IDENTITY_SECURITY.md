# Enterprise Identity And Security Controls

This document covers enterprise carrier deployment identity/access hardening:
SSO, local-auth restriction, account lockout, password policy, production
CORS/CSP, and sensitive-data audit logging. See also `SECURITY.md` for
vulnerability reporting and `docs/PRODUCTION_RUNBOOKS.md` for deployment
operations.

## Single Sign-On (OIDC)

Each tenant can configure an OIDC identity provider via `tenants.sso_config`
(managed through `GET`/`PATCH /api/v1/admin/tenant`, permission
`admin.tenant.manage`):

```json
{
  "enabled": true,
  "issuer": "https://idp.example.com",
  "clientId": "lattice-policy",
  "clientSecretEnvVar": "ACME_OIDC_CLIENT_SECRET",
  "authorizationEndpoint": "https://idp.example.com/authorize",
  "tokenEndpoint": "https://idp.example.com/token",
  "jwksUri": "https://idp.example.com/.well-known/jwks.json",
  "redirectUri": "https://api.example.com/auth/sso/acme/callback",
  "rolesClaim": "roles",
  "roleMapping": { "lattice-underwriter": "underwriter", "lattice-admin": "admin" },
  "defaultRoles": ["agent"]
}
```

The client secret is never stored in the database. `clientSecretEnvVar` names
an environment variable the server process reads at request time — set that
variable in the deployment environment, not in `sso_config` itself.

Flow:

1. `GET /auth/sso/:tenantId/login` redirects the browser to the IdP's
   authorization endpoint (standard OIDC authorization code flow, `state` is
   itself a short-lived signed JWT carrying the tenant and nonce — no server
   session store required).
2. `GET /auth/sso/:tenantId/callback?code=&state=` exchanges the code for
   tokens, verifies the `id_token` against the tenant's JWKS (issuer +
   audience + nonce checked), maps claims to internal roles via
   `rolesClaim`/`roleMapping`/`defaultRoles` (`server/src/lib/sso.ts`,
   `mapOidcClaimsToRoles` — unit tested), finds or creates a
   `auth_provider = 'oidc'` user keyed by `(tenant_id, external_subject)`, and
   returns `{ token, user }` in the same shape as `POST /auth/login`.

**Follow-up, not in this slice:** wiring the callback into the frontend SPA
(popup or redirect-with-fragment handoff) and SAML support. SAML is
significantly more complex than OIDC (XML signing/encryption, IdP-initiated
flows); the claim-mapping abstraction in `tenant-identity.ts`/`sso.ts` is
structured so a SAML assertion could be mapped through the same
`mapOidcClaimsToRoles`-style function when that work is scoped.

## Disabling Local Password Auth

Set `tenants.local_auth_enabled = false` (same admin tenant endpoint) to
reject username/password login for that tenant — `POST /auth/login` returns
`403 LOCAL_AUTH_DISABLED`. Intended for tenants that have fully cut over to
SSO. Defaults to `true` so existing deployments are unaffected.

## Account Lockout And Password Policy

- `server/src/lib/password-policy.ts` defines the policy: minimum 12
  characters, upper/lower/digit/symbol required, common weak passwords
  rejected (`validatePasswordPolicy`, unit tested).
- Lockout: 5 failed attempts locks the account for 15 minutes
  (`MAX_FAILED_LOGIN_ATTEMPTS`, `LOCKOUT_DURATION_MINUTES`). `POST
  /auth/login` returns `423 ACCOUNT_LOCKED` while locked. A successful
  password check clears the counter.
- Enforcement: `admin.routes.ts`'s `POST /api/v1/admin/users` and `PATCH
  /api/v1/admin/users/:id` pass `enforcePasswordPolicy: true`, so
  admin-created/changed passwords are validated. `createUser`/`updateUser`
  in `user.service.ts` do **not** enforce the policy by default — many
  existing tests and internal seed/fixture paths create users with simple
  passwords, and retroactively hard-blocking every caller broke unrelated,
  already-merged test suites. Enforcement lives at the real admin-facing
  HTTP boundary instead of the shared service layer.

## Production CORS/CSP

- CORS already enforced an explicit `ALLOWED_ORIGINS` allowlist and rejected
  wildcard/localhost origins in managed deployments (`server/src/config.ts`,
  `validateDeploymentConfig`) before this change.
- `server/src/app.ts` now sets an explicit Content-Security-Policy via
  `helmet` (`default-src 'self'`, `object-src 'none'`, `frame-ancestors
  'none'`) instead of helmet's defaults. `/api-docs` renders swagger-ui from
  `unpkg.com` with an inline bootstrap script, so `script-src`/`style-src`
  allow that CDN and inline execution — `/api-docs` is already admin-only
  (`requireAdminDocs`). HSTS is enabled in managed deployments.

## Sensitive Data Access Auditing

`server/src/lib/customer-crypto.ts`'s `decryptSensitiveValue` now logs a
structured `sensitive_data_access` audit line (via the existing `pino`
logger) on every decryption, with optional tenant/user/resource/field
context (`server/src/lib/security-audit.ts`). This is the codebase's actual
PII-reveal primitive today; no caller currently exposes decrypted values
through an API response, so there is no live "PII reveal" endpoint to wire
richer approval workflow around yet. When one is built, call
`logSensitiveAccess`/pass `auditContext` at that call site.

**Follow-up, not in this slice:** a PII-reveal approval workflow (e.g.
requiring a second approver before a full SSN is returned to a UI) and
encryption key rotation automation. For now: `CUSTOMER_DATA_KEY` rotation is
manual — decrypt existing values with the old key, re-encrypt with the new
key, and update the environment variable during a maintenance window, since
`encryptSensitiveValue`/`decryptSensitiveValue` derive a single AES-256-GCM
key from `CUSTOMER_DATA_KEY` via SHA-256 with no key-versioning today.

## Testing

- `server/src/lib/__tests__/sso.test.ts` — claim mapping, authorization URL
  building, state generation, client secret resolution (unit, DB-free).
- `server/src/lib/__tests__/password-policy.test.ts` — password policy and
  lockout state machine (unit).
- `server/src/__tests__/auth-local-auth-disabled.test.ts` — API-level test
  of the local-auth-disabled restriction via `handleLogin`.
