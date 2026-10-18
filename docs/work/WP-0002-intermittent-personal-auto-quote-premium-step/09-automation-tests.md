# Automation tests — WP-0002

> Automation test agent. Local stack rebuilt from the branch (compose project `latticepolicy`, API restarted between runs to reset the login rate limiter).

## Specs added or changed

- `e2e/quote-wizard.spec.ts` (smoke, line 20): after rating, asserts the Premium step has no row for the homeowners coverages seen in the defect (`END_WB`, `END_PPRC`, `END_ORD`, `END_ERC`, Dwelling), next to the existing BI row check. Premium rows render as `CODE - Name`, so a leaked row matches.
- `e2e/support/products.ts`: the homeowners fixture used the undefined code `DWELLING`; it now uses `A` (Dwelling), which the new server check requires.

## Runs

Stack built from 88b06a4 (the spec assertion was added after it; spec-only change):

| Run | Command | Result |
| --- | --- | --- |
| Smoke repeated in parallel (REQ-6) | `npx playwright test e2e/quote-wizard.spec.ts:20 --repeat-each 10 --workers 4` | 10 passed, before and after the new assertion |
| Related suites | `npx playwright test e2e/multi-product.spec.ts e2e/policy-lifecycle.spec.ts e2e/pre-bind-checks.spec.ts e2e/quote-wizard.spec.ts --grep-invert "limits the product list" --workers 3` | 21 passed |
| Smoke | `npx playwright test --grep @smoke --workers 4` | 9 passed |

The first rebuild (from 44e3b74) failed the smoke spec 10/10: the coverage step stayed on "Loading product config...". That was a real regression from b6ed111, fixed in 88b06a4 (07-code-review.md, last row). The excluded spec "limits the product list" selects the underwriting company "Sample Carrier Property". In the long-lived local database the companies are named "CA UW Company", "HO UW Company" and so on, so the option does not exist and the spec times out (run alone: 1 failed, page snapshot shows those options). Environment data only; CI seeds a fresh database.

CI: PR #385 (head 0ac9585, includes the new assertion) — Playwright E2E pass: https://github.com/kishorjakkula/LatticePolicy/actions/runs/39146112985/job/117730179355 ; DB Integration Tests pass: https://github.com/kishorjakkula/LatticePolicy/actions/runs/39146112985/job/117730179402

## Environment-only failures

- One run after the rebuild had 4 of 10 failures at "Bound" and one `ENOSPC: no space left on device`: the Mac had 321 MB free. Unused Docker build cache was pruned (5.5 GB freed; no volumes touched) and the same run then passed 10/10. Not a product defect.
- Locally, the root `npm run test:integration` runs inside `node:22-alpine` without Chrome, so document-rendering integration tests fail there; on the host with a disposable database all 176 pass.
