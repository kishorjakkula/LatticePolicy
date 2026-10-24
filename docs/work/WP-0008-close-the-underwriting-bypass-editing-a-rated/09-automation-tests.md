# Automation tests — WP-0008

## Specs added or changed

No Playwright spec changed. The existing wizard specs (quote-wizard, policy-lifecycle,
pre-bind-checks, multi-product, uw-referrals, underwriting-rules, production-policy-scenarios,
qualification-alignment) are the regression check that normal wizard autosaves do not reset a
rating. A wrong fingerprint definition would show there as unexpected 409s.

## Runs

- **Local isolated Playwright:** not run. Free disk (about 3 GB) was below the safe level for the stack build; a full disk crashed Docker and the pilot on 2026-10-20.
- **CI on PR #398:** Playwright E2E (the full suite), DB Integration Tests, Build/Test/Typecheck, CodeQL, the pilot workflow and Container Scan all passed. They passed on `a05669e` and again on the final commit `3e8eb79`, before the merge on 2026-10-23 (235ee7c).

## Environment-only failures

- `ai-audit-phase3.integration.test.ts` and `contact-address.integration.test.ts` failed only in the local host run, which used a plain PostgreSQL role.
  - Both assert the `lattice_tenant_rls` role, which only the Docker integration runner and CI provision.
  - Neither touches quotes or bind.
  - Both pass in CI.
