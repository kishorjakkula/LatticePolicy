# Test design — WP-0002

| Criterion | Case | Layer | Data | Expected |
| --- | --- | --- | --- | --- |
| REQ-3 / rate rejects | Personal auto payload with END_WB rated through `createOrRateQuote` | Server integration (PostgreSQL, RLS) | synthetic personal auto | `INVALID_QUOTE`, error path `/coverages/n/code`, message names END_WB; no quote saved |
| REQ-3 / valid codes pass | Personal auto with BI, PD, COMP, COLL; homeowners with A–F + endorsements; cyber, commercial auto, professional liability, carrier-pack condo | Server integration | each product's defaults | Rated as before (regression) |
| REQ-3 / pinned version | Payload pinned to a product snapshot whose coverages differ from current config | Server unit (`coverageViolations`) | synthetic snapshot | Checked against the pinned definition |
| REQ-3 / bind re-checks | Quote saved with an undefined code (inserted directly), then bound | Server integration | synthetic | `PRODUCT_RULES_NOT_MET` naming the code |
| REQ-3 / issue | Bound policy whose payload has an undefined code, then issued | Server integration | synthetic | Refused with the code named |
| REQ-3 / policy change introduces code | Endorsement adding END_WB to a personal auto policy | Server integration | synthetic | Refused |
| REQ-3 / carried legacy code | Endorsement of a policy that already carries an undefined code, changing something else | Server integration | synthetic | Allowed (code carried, not introduced) |
| REQ-3 / renewal and rewrite | Renewal and rewrite introducing an undefined code | Server integration | synthetic | Refused |
| REQ-1 / stale response | `loadConfig` for homeowners resolves after personal auto | Frontend component (wizard coverage loading, mocked API with controlled promise order) | synthetic configs | Personal auto coverages shown; homeowners response ignored |
| REQ-1 / no stale coverages | Product changes from homeowners to personal auto while config loads | Frontend component | synthetic | "Loading product config…" shown, never homeowners coverages |
| REQ-2 / confirmation | Change product with coverages entered | Frontend component | synthetic | Dialog shown; Keep leaves state; Change clears coverages, risks, qualification answers and keeps insureds |
| REQ-2 / no dialog when empty | Change product on a new quote | Frontend component | synthetic | No dialog |
| REQ-3 / rating error wording | Server returns coverage violation | Frontend component | mocked | Banner shows "Coverage END_WB is not offered by Personal Auto." |
| REQ-5 / report | Quotes and policies with and without undefined codes, in two tenants | Server integration | synthetic | Lists only the bad records of the caller's tenant with codes; nothing modified; requires `admin.dashboard.read` (403 for an agent) |
| REQ-5 / panel | Panel renders list, empty and error states | Frontend component | mocked | As designed |
| REQ-4 / REQ-6 / journey | Quote wizard smoke spec (`quote-wizard.spec.ts:20`) with `--repeat-each 10` in parallel with other smoke specs | Playwright | seeded | 10/10 pass; Premium shows BI and no homeowners coverage |
| REQ-6 / fixture | Multi-product e2e specs using `e2e/support/products.ts` homeowners fixture with code A | Playwright | seeded | Pass with the new server check |

## Negative, authorization and tenant-isolation cases

Report: agent gets 403; tenant B's bad records never appear for tenant A. Rate,
bind, issue and policy changes: undefined codes refused for every product;
unknown product codes keep their existing errors.

## Regression cases

Full server unit and integration suites, frontend suite, and the existing
Playwright suites (quote wizard, multi-product, policy lifecycle, pre-bind
checks, production policy scenarios) pass with the new check; any fixture that
used an undefined code is corrected and listed in `05-implementation.md`.
