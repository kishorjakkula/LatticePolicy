# Task Note: v0.2.1 Release Readiness

## Links

- Release tag: `v0.2.1`
- Previous release: `v0.2.0`
- GitHub release:

## Summary

Prepared the `v0.2.1` patch release after the post-`v0.2.0` dependency,
security, Docker runtime, contributor-readiness, and platform-slice updates.
This release keeps the project in the pre-1.0 adoption-checkpoint model:
it is suitable for contributors and pilot evaluation, but it is not a turnkey
production PAS.

## Release Scope

- Clears npm audit / Dependabot findings across root, frontend, and server
  lockfiles.
- Keeps root, frontend, server, and shared type package metadata aligned on
  `0.2.1`.
- Includes the server Docker runtime layout fix so workspace-scoped production
  dependencies resolve correctly in the API image.
- Captures the post-`v0.2.0` platform slices for exposure management,
  reinsurance, bordereaux, ACORD/GRLC mapping, operational admin, data import,
  job queue, enterprise identity, audit replay, and carrier onboarding.
- Includes contributor onboarding, local health-check, CI troubleshooting, and
  first-good-task documentation.

## Compatibility Notes

- No new SQL migration compatibility warning is introduced by the release
  metadata bump itself; adopters should still run all migrations deliberately
  before routing traffic to a newly deployed API image.
- No npm packages are published. All workspaces remain private.
- GHCR release images are expected to publish from the semantic version tag.

## Validation Performed

Run from the repository root before tagging on 2026-08-21:

```bash
npm ci                    # passed, 0 vulnerabilities
npm run security:audit    # passed, 0 unapproved vulnerabilities
npm run build             # passed
npm run test              # passed, 225 server + 90 frontend tests
npm run typecheck         # passed
npm run test:integration  # passed, 59 tests across 17 files
npm run test:e2e:docker   # passed, 8 Playwright smoke tests
curl http://localhost:3300/health
# {"status":"ok","db":true,"cache":true,...}
```

Note: the frontend test suite emitted an existing non-blocking React warning
about a missing list key in `SearchPage`; tests still passed and this release
does not expand scope to fix it.

## Known Follow-Ups

- Track the upstream `@vitejs/plugin-react` peer range for Vite 8 and remove
  the frontend-only legacy peer dependency maintenance path when possible.
- Either wire `loadDomPurify()` into the PDF flows for defense in depth or
  remove the unused export.
- Continue hardening production SSO, product governance, and document artifact
  storage on the roadmap.
