# Full Functional Playwright Suite

## Summary

Expanded the Playwright suite from 14 smoke tests to 94 tests covering every
routed page and the main cross-service workflows, and added an isolated Docker
stack to run it without touching local demo data.

## What Changed

- `docker-compose.e2e.yml` + `scripts/test-e2e-isolated.sh`
  (`npm run test:e2e:isolated`): disposable stack on `:5174` / `:3301` with its
  own volumes and `TRUST_PROXY=1`. CI's Playwright job now runs this script.
- `e2e/support/fixtures.ts`: every test sends its own `X-Forwarded-For`, and
  API sessions are cached per worker. Together these keep a full run below the
  per-IP login and API rate limiters.
- `e2e/global-setup.ts`: waits for health and seeds reference data.
- `e2e/support/{api,wizard,products}.ts`: shared setup, wizard, and product
  payload helpers. Existing specs only changed their `test` import.
- 14 new spec files; see the table in `docs/TEST_PLAN.md`.

## Defects Found And Fixed

Writing the suite surfaced six defects. All are fixed in this change, each with
a unit or route test and a Playwright regression test.

1. **Agents could not complete the Quote Wizard.** The Insureds step used the
   admin customer API (`menu.admin.view` + `admin.customers.*`), which the
   `agent` role does not hold; the 403 was rendered as "No matching customers
   found". Added wizard-scoped endpoints gated on `page.wizard.view`:
   `GET /api/v1/customers/search`, `GET /api/v1/customers/:idOrKey`, and
   `POST /api/v1/customers` (`customerIntakeRoutes`). They reuse the admin
   service functions (tenant scoping, masking, duplicate detection) and expose
   nothing else: no update, merge, export, PII reveal, approval, or delete, and
   no `createAnyway` duplicate override. The wizard now calls them through
   `quoteIntakeApi`, and a failed search is shown as a failure.
   Tests: `customer-intake-routes.test.ts`, `quote-wizard.spec.ts`.
2. **Underwriting Authority banner said gating was OFF on the day a grant was
   created.** `grantAppliesToScope` now compares the date portion of the API
   timestamp. Tests: `UnderwritingAuthorityPage.test.tsx` (timestamp fixtures),
   `underwriting-authority.spec.ts`.
3. **Search "Export CSV" and "Columns" had no click handlers.** Export now
   downloads every policy matching the current filters and sort (also bound to
   the advertised `E` shortcut); Columns opens a chooser whose selection is
   kept in `localStorage`. Tests: `SearchPage.test.tsx`, `dashboard-search.spec.ts`.
4. **Seeding reference data left the `uw-companies` cache stale** for up to 180
   seconds. The seed endpoint now clears the `uw-companies` and `forms-preview`
   prefixes. Test: `seed-reference-data-cache.test.ts`.
5. **Policies lacking wizard-only fields could not be cancelled in the UI.**
   The cancellation wizard no longer validates the read-only insured and
   vehicle steps, and locked transactions re-rate with the stored underwriting
   company instead of demanding a selection that cannot be made. Editable
   transactions (endorsement, renewal) still validate. Test:
   `policy-lifecycle.spec.ts`.
6. **Dates rendered one day early west of UTC.** `formatDisplayDate` now treats
   UTC-midnight timestamps (serialized `DATE` columns) as calendar dates.
   Tests: `dateDisplay.test.ts` (four time zones), `policy-lifecycle.spec.ts`,
   `underwriting-authority.spec.ts`.

## Run After Every Deployment

- Nine tests are tagged `@smoke` (`npm run test:e2e:smoke`): login, route
  guards, API auth/tenancy, health, dashboard, browser quote-to-issue, policy
  view.
- `scripts/deploy-local.sh` (`npm run deploy:local`) deploys the local demo
  stack, runs the smoke tests against it, then the full suite on a disposable
  copy of the build.
- `.github/workflows/e2e-post-deploy.yml` runs the smoke tests against the
  deployed test environment; both deploy workflows call it after `deploy` and
  run the full isolated suite as a gate before `deploy`.
- `selectProduct` falls back to the first underwriting company that writes the
  product when the seeded company is absent, so the wizard smoke test works on
  long-lived environments. `E2E_UW_COMPANY` overrides the default name.
- Not exercised: the cloud deploy workflows themselves. The repository has no
  deployment variables configured, so the post-deploy job has only been
  validated locally against the Docker demo stack.

## Security Notes

- The intake endpoints widen customer read/create to every role with
  `page.wizard.view` (agent, underwriter, admin). Customer and actuary roles
  remain 403, and sensitive identity fields stay masked exactly as in the admin
  read. PII reveal remains admin-only.
- PR #357 review found that caller-supplied contact/address IDs could reach
  shared persistence upserts and overwrite another customer's collections.
  Intake now accepts only entity type, status, identity, contacts, and addresses,
  and discards contact/address IDs so persistence generates fresh IDs. Admin
  collections (external identifiers, relationships, notes, attachments),
  compliance, and metadata are ignored; external-identifier upserts can otherwise
  reassign an existing identifier to the newly created customer.
  Admin create/update behavior is unchanged.
- Regression coverage in `customer-intake-routes.test.ts` first reproduced the
  contact overwrite, then verified fresh contacts/addresses and rejection of
  admin-only sections. `admin-customers.spec.ts` verifies against PostgreSQL
  that an agent can create a distinct insured using existing collection IDs
  without changing the original customer's contacts or addresses.

## Coverage Gaps That Remain

- Aggregation appetite limits (#352) have no admin API or UI; they can only be
  set in the database, so they are covered by integration tests only.
- No DB-backed integration test binds cyber, commercial auto, or professional
  liability; `multi-product.spec.ts` is currently the only end-to-end proof.
- Rating workbook import, MFA enrolment, SSO, non-renewal, rewrite, PDF
  content, notification delivery, and background jobs running to completion
  are not exercised in the browser.
- `e2e/` is not part of any `tsconfig`, so `npm run typecheck` does not cover it.
- Only Chromium desktop is configured.

## Validation

- `npm run test:frontend` (173 passed), `npm run test:server` (423 passed)
- `npm run typecheck`
- `npm run test:e2e:isolated`: 94 passed, none skipped, on a fresh stack
- Full suite repeated twice more on the reused database: 188 passed

### PR review fix validation

- `npm exec --workspace=server -- vitest run src/__tests__/customer-intake-routes.test.ts`: 11 passed
- `npm run test:server`: 425 passed
- `npm run typecheck`, `npm run build`, `git diff --check`: passed
- `npm run test:e2e:isolated`: 95 passed, including the PostgreSQL overwrite regression
