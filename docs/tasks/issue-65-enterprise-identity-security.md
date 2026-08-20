# Task Note: Enterprise Identity And Security Controls

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/65
- Pull request:

## Summary

Added a first working slice of enterprise identity/security hardening: a
real OIDC SSO login path (per-tenant configuration, claim-to-role mapping,
find-or-create SSO user), a per-tenant local-auth kill switch, account
lockout and a defined password policy, tightened production CSP/HSTS, and
sensitive-data access audit logging on the codebase's actual PII decrypt
primitive. This repo had no existing identity provider integration before
this change — MFA/TOTP, JWT auth, and CORS allowlisting already existed and
were left untouched.

## Important Files

- `server/migrations/040_enterprise_identity_security.sql`: adds
  `tenants.local_auth_enabled`, `tenants.sso_config`,
  `users.failed_login_attempts`, `users.locked_until`,
  `users.password_updated_at`, `users.auth_provider`,
  `users.external_subject` (unique per tenant when set).
- `server/src/config/tenant-identity.ts` (+ `server/src/tenantIdentity.ts`
  re-export shim, matching the existing `tenantAi.ts`/`tenantSecurity.ts`
  pattern): SSO config and local-auth-enabled read/normalize/memory-fallback
  helpers.
- `server/src/lib/sso.ts`: `mapOidcClaimsToRoles` (pure, unit tested),
  authorization URL building, state generation, client-secret env var
  resolution, token exchange, and `jose`-based `id_token` verification
  against the tenant's JWKS.
- `server/src/routes/sso.routes.ts`: `GET /auth/sso/:tenantId/login` and
  `GET /auth/sso/:tenantId/callback`, mounted in `server/src/app.ts` under
  the existing login rate limiter.
- `server/src/lib/password-policy.ts`: `validatePasswordPolicy`,
  lockout state machine (`recordFailedAttempt`, `isLockedOut`,
  `clearLockoutState`).
- `server/src/auth.ts`: `handleLogin` now checks
  `tenants.local_auth_enabled`, rejects OIDC-provisioned accounts from
  password login, checks/records lockout state, and exported
  `buildAuthUser` (needed by `sso.routes.ts`).
- `server/src/services/user.service.ts`: lockout read/write helpers
  (`recordFailedLoginAttempt`, `resetLoginFailureState`),
  `findOrCreateSsoUser`, and an **opt-in** `enforcePasswordPolicy` flag on
  `createUser`/`updateUser`.
- `server/src/routes/admin.routes.ts`: `GET`/`PATCH /api/v1/admin/tenant`
  now read/write `localAuthEnabled`/`ssoConfig`; `POST`/`PATCH
  /api/v1/admin/users` pass `enforcePasswordPolicy: true`.
- `server/src/app.ts`: explicit helmet CSP (was defaults) and HSTS in
  managed deployments; `/api-docs` CDN/inline-script allowances preserved.
- `server/src/lib/customer-crypto.ts` /
  `server/src/lib/security-audit.ts`: `decryptSensitiveValue` now logs a
  structured `sensitive_data_access` audit line on every call.
- `docs/ENTERPRISE_IDENTITY_SECURITY.md`: full write-up, linked from
  `README.md` and `SECURITY.md`.

## Behavior Rules

- SSO client secrets are never stored in the database — `sso_config` stores
  `clientSecretEnvVar` (a variable **name**); the actual secret is read from
  `process.env` at request time.
- A tenant with `local_auth_enabled = false` rejects `POST /auth/login` with
  `403 LOCAL_AUTH_DISABLED` regardless of password correctness. Defaults to
  `true`.
- An account with `auth_provider = 'oidc'` cannot log in with a password
  (`401 SSO_ACCOUNT`) even if local auth is enabled tenant-wide.
- 5 failed password attempts locks an account for 15 minutes
  (`423 ACCOUNT_LOCKED`); a correct password clears the counter immediately,
  independent of any subsequent MFA step.
- `validatePasswordPolicy` is **not** enforced by default in
  `createUser`/`updateUser` — only when the caller passes
  `enforcePasswordPolicy: true`, which the real admin HTTP routes do. This
  was a deliberate scope decision: hard-enforcing it unconditionally broke
  numerous already-merged integration tests across other features that seed
  fixture users with simple passwords via direct service calls. Enforcement
  belongs at the real admin-facing boundary, not retroactively across every
  internal caller.
- `mapOidcClaimsToRoles` falls back to a tenant's `defaultRoles` when no
  claim value matches `roleMapping`; if that list is also empty, the
  callback returns `403 SSO_NO_ROLE_MAPPING` rather than provisioning a
  roleless user.

## Automated Tests

- Tests added or updated:
  - `server/src/lib/__tests__/sso.test.ts`
  - `server/src/lib/__tests__/password-policy.test.ts`
  - `server/src/__tests__/auth-local-auth-disabled.test.ts`
- Test layer used: unit tests for pure claim-mapping/policy logic (DB-free,
  fast, and directly satisfy the issue's "tests cover SSO claim mapping
  helpers" acceptance criterion), plus one API-level test of the
  local-auth-disabled restriction using the existing `handleLogin`
  mock-`getDb`-as-null pattern from `auth-demo-access.test.ts`.
- Why this layer is enough: claim mapping and password/lockout policy are
  pure functions — unit tests give full branch coverage without a database.
  The full SSO authorization-code + JWKS-verification round trip requires a
  live IdP and is not practical to cover in this repo's test harness; that
  is a known gap (see Follow-Ups).

## Validation

```bash
npm run build
npm run test
npm run typecheck
npm run test:integration   # against a disposable local Postgres 15 container
```

All passed: 157 server unit tests, 74 frontend tests, 29 DB integration
tests (10 files, run against `postgres:15` in Docker — confirms migration
040 applies cleanly and nothing else regressed).

## Follow-Ups Or Risks

- **SAML is not implemented.** Only OIDC. The claim-mapping abstraction is
  structured so a SAML assertion parser could reuse
  `mapOidcClaimsToRoles`-style logic, but no SAML code exists yet.
- **Frontend SPA integration is not wired.** `/auth/sso/:tenantId/callback`
  returns `{ token, user }` as JSON (same shape as `/auth/login`), suitable
  for a server-side or Postman-testable flow, but the browser popup/redirect
  handoff into the React app's auth store is unbuilt.
- **No admin UI for `sso_config`.** It's readable/writable via the existing
  `GET`/`PATCH /api/v1/admin/tenant` JSON API only.
- **No PII-reveal approval workflow.** `decryptSensitiveValue` now audits
  every call, but no endpoint currently returns decrypted values to a UI, so
  there's no existing "reveal" flow to gate with an approval step.
- **No live end-to-end OIDC test.** Token exchange, JWKS fetch, and
  `id_token` verification (`server/src/lib/sso.ts`) are exercised by build/
  typecheck but not by an automated test against a real or mocked IdP —
  doing that well would need an IdP simulator (e.g. a local `oidc-provider`
  test double), which is a reasonable follow-up.
- **Encryption key rotation is manual**, documented in
  `docs/ENTERPRISE_IDENTITY_SECURITY.md` — no key-versioning support in
  `customer-crypto.ts` yet.
- **`enforcePasswordPolicy` is opt-in**, not the service-layer default — see
  Behavior Rules above for why.
