# Code review — WP-0010

> Code reviewer (separate session from the developer).

- Reviewer session / tool: Claude Code code-reviewer sub-agent (Claude Opus 5.5), fresh session started by the orchestrator; it did not write any of this code.
- Diff reviewed: `git diff 235ee7c..HEAD` on `latticepolicy/wp-0010-businessowners` (commit 387eab7, 86 files), against 01, 02, 04, 05 and 06.

## Verdict

**Returned to the developer: 1 Major.** The stage is not complete. The BOP
server work is sound: package rules, the authorization service and its
ordering, tenancy, the demo guard and the loader changes. But the shared
coverage editor change breaks personal-auto rating, an existing product.
Fix it and add a regression test, then send it back for re-review.

## Findings

| Severity | File:line | Finding | Failure scenario | Outcome |
| --- | --- | --- | --- | --- |
| Major | `frontend/src/features/wizard/QuoteWizard.tsx:6169` | `GenericCoverageEditor` now stores every limit as `Number(e.target.value)`. It is the editor for every product except homeowners. Personal auto declares the BI limits as strings (`25000/50000`, `50000/100000`, `100000/300000` in `products/personal-auto/coverage.yaml:24`), and the contract allows string limits (`contracts/quote.request.schema.json:56`). | An agent picks BI 100000/300000 on a personal-auto quote. `Number('100000/300000')` is `NaN`, which serializes as `limit: null`. `findBaseLossCost` and `findLimitDedRelativity` (`rating.service.ts:679-731`) then fall back to the first table row. The quote is priced at the lowest BI limit, and the quote and policy store no BI limit. The error is silent. No test covers string limits. | Returned. Keep the option's typed value, e.g. `c.limits.find(l => String(l) === e.target.value)`, and add a component test that changes a personal-auto BI limit. |
| Minor | `server/src/services/lifecycle.service.ts:854,1174`; endorsement service | Documented deviation: direct renewal, rewrite and endorsement calls do not re-run `assertBusinessownersAuthorization` (appointments, producer link, company). Wizard servicing still rates through `POST /quotes` → `createOrRateQuote`, which does run the check with `req.user.id`. Authority grants and referral gates still apply. | Through the API, a producer whose Ohio appointment ended can renew or rewrite a BOP policy without a distribution refusal. A rewrite is effectively new business, so that is the larger gap. | Accepted for the synthetic demo scope. Before any non-demo use, add the check to rewrite and renewal, and record it as a follow-up in 13. |
| Minor | `server/src/lib/product-package.ts:98-110` | `packageTerms` sent with a changed limit are refused, not re-derived. The wizard strips them in `setField`, but an API client that patches only `limit` gets `PRODUCT_RULES_NOT_MET` ("Package terms must match"). | An integration endorses BOP_LIAB from 1M to 2M by editing the stored payload's limit. The endorsement is refused until it drops `packageTerms`. | Accepted. This matches the design ("client tampering refused") and fails safe. Mention it in `docs/API.md` with the BOP error codes. |
| Minor | `server/src/services/businessowners-authorization.service.ts:34,301-309` | State and product (`OH`, `businessowners`) are hard-coded instead of read from the pack's `availability` and `packageRules.states`. | If the pack adds a state, `productPackageViolations` accepts it, but authorization still refuses it with `STATE_NOT_ELIGIBLE`. The two sources disagree. | Accepted for the single-state demo. Note it in the task note for the next package. |
| Minor | `server/src/services/uw.service.ts:27` (and the duplicate `../products.js` import at :2/:4) | `evaluateUW` now calls `requireLoadedSnapshot` for every product when no carrier rules match. It can therefore throw `PRODUCT_VERSION_NOT_LOADED` where it used to fall back. | Today every caller rates or runs `ensureProductSnapshots` first, so I found no failing path. A future caller that evaluates UW on a pinned, unloaded payload would now fail. | Accepted. The failure is safe. Merge the duplicate import when convenient. |
| Minor | `server/src/services/submission-intake.service.ts:850` | The true/false select coercion applies to all products, so cyber `mfaEnabled` from intake becomes a boolean instead of `'true'`. | None found: `parseBooleanLike` in rating and `coerceBoolean`/`normalizeComparable` in UW rules handle both forms. | Accepted. No change needed. |
| Minor | `server/src/__tests__/businessowners-demo.integration.test.ts:58` | The test assumes a fresh database. On a reused `lattice_policy_integration`, a rerun finds the earlier issued-example quote and fails (`quotes: '3'` instead of `'2'`). | A developer reruns the integration suite against the same disposable container and gets a spurious failure. | Accepted. The suite passes on a fresh database (06). Scope the count to the keys this test creates, or document the fresh-database requirement. |
| Minor | `server/src/services/businessowners-demo.service.ts:290` | The `as Parameters<typeof createOrRateQuote>[5]` cast is unnecessary now that `actorId` is in the options type. | None. | Accepted (cosmetic). |

## Specific checks requested by the orchestrator

- **product-package.ts.** `applyProductPackage` runs in `rate()` before pricing, for snapshot and current definitions alike. `productRuleViolations` and `assertCoveragesDefined` add package violations at quote, bind, issue and servicing. Other products have no `packageRules`, so they return `[]`. Terms are flat scalars, so the strict `!==` comparison is correct. The UW fallback is refused when `requiredUnderwritingRules` is set. OK.
- **Authorization ordering and actor.**
  - Bind: `assertBindableRating` (WP-0008, `QUOTE_RERATE_REQUIRED`) runs first, then the BOP check. The BOP check runs again inside the persisting transaction, after the `QUOTE_CHANGED` proposal check and before the referral check (`quote-bind.service.ts:378-381,705`).
  - Quote: the BOP check runs before rating and again inside the persisting transaction.
  - `actorId` comes from `req.user?.id` in both routes (`quotes.routes.ts:137,341`), never from the body. A missing actor fails closed, for example in data-import.
  - Every query is filtered by `tenant_id`; the `user_roles` join is scoped through `rbac_roles.tenant_id` plus the tenant user check.
  - The locks pass under the RLS role (integration run below). OK.
- **products.ts loader.** The `cfg.fields` paths trigger only when `coverage.yaml` declares `fields:`, and only `businessowners` does. The `loadFieldMeta` fallback still ends in `loadProductConfig`, so unknown codes behave as before. Object-typed fields are excluded from generic risk fields. No change for other products.
- **QuoteWizard preselection.** Gated to non-core packs that declare `required` or `defaultSelected`. Only BOP qualifies today: the condo carrier-pack example and identity-protection declare neither. Core products are unchanged. `createCoverageSelection` changes the defaults only for coverages that declare `defaultLimit`/`defaultDeductible` with a list, which today means only BOP. The limit coercion is the Major above.
- **businessowners-demo.service.ts.**
  - It requires explicit opt-in, the `sample-carrier` tenant and `DEPLOYMENT_ENV` local or test, and it is never called at boot.
  - A session advisory lock serializes runs.
  - Existing rows are compared, never updated. A mismatch raises `BOP_DEMO_CONFLICT`, and carrier-owned forms are skipped.
  - Table and column identifiers are module constants.
  - A rerun skips the already-issued example.
  - OK.
- **customers.routes.ts `toNullableNumber`.** The fix is correct: `null` or blank now gives `null`, not 0. It is covered by `customer-normalize.test.ts`.
- **Deviation in 05.** Reviewed above as a Minor, accepted for demo scope with a follow-up.

## Checks run by the reviewer

- `cd server && npx vitest run`: 107 files, 1,155 passed. The first of three runs had 8 failures in one file; the two reruns were clean. The cause was not identified; a timing flake is likely.
- `cd frontend && npx vitest run`: 95 files, 624 passed.
- `npm run typecheck`: clean. `git diff --check`: clean.
- Integration, BOP files, on the reused `lattice-wp0010-pg` database with RLS enforced: 50 of 51 passed. The one failure is the fresh-database assumption above. The lifecycle and authorization integration tests all passed.
