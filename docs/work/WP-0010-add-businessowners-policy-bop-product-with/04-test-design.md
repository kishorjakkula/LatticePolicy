# Test Design - WP-0010

Proposed Gate B acceptance matrix. All data synthetic; PostgreSQL tests use an
isolated disposable database, never the user's demo/pilot records. Baseline
existing product behavior first; no weakened assertions or skipped failures.

| ID / requirement | Case | Layer | Expected |
| --- | --- | --- | --- |
| B01 / REQ-1 | Pack discovery/API labels and supported actions | Server unit/API | BOP discovered without hard-coded selector allowlist |
| B02 / REQ-1 | Shared runtime and JSON request contract agree | Shared/server contract | Complete BOP request accepted; invalid risk type rejected |
| B03 / REQ-4 | Business/risk metadata and address round trip | Unit/component/integration | Correct types/labels; structured address preserved |
| B04 / REQ-2 | Owner vs tenant and building insurable interest | Server/component | Building required/allowed appropriately; no forced tenant building |
| B05 / REQ-2,3 | Required BPP/income/liability/medical package | Server integration | Missing/deselected mandatory parts rejected through API |
| B06 / REQ-3 | Every offered limit/deductible and invalid boundaries | Parameterized unit/API | Valid options price; out-of-range/NaN/negative/foreign values fail |
| B07 / REQ-2,3 | Liability aggregates and included benefits | Unit/integration/UI | Derived/persisted terms correct; no double charge; client tampering refused |
| B08 / REQ-3 | Income basis/limit/wait/restoration and snapshot | Unit/integration/UI | Explicit approved demo terms survive approval/bind/servicing/documents |
| B09 / REQ-5 | Owner golden price: 1000+300+100+400+0=1800 | Server unit | Exact baseline total/trace, zero demo fee/tax |
| B10 / REQ-5 | Tenant golden price: 300+100+400+0=800 | Server unit | No building charge; exact baseline total |
| B11 / REQ-5 | Optional extensions, each factor, deductible and minimum | Parameterized unit | Correct components, rounding and minimum; deselection removes charge |
| B12 / REQ-5 | Missing factor/unknown coverage/unsupported term | Unit/API | No fallback safe rating; actionable failure |
| B13 / REQ-4,6 | Missing/invalid inputs and conditional fields | Shared/server/component | Consistent screen/rate/bind/issue checks |
| B14 / REQ-6 | Office/retail/service and Ohio eligibility | Integration | Valid demo risks accepted; unknown class/state rejected |
| B15 / REQ-6 | Prior losses >0, roof age >20, protection 9/10 | Boundary unit/integration | Referral at configured threshold; immediate boundary below is checked |
| B16 / REQ-6 | Vacancy >30 days / hazardous operations | Boundary unit/integration | Configured decline; no bind bypass or assumed missing-safe answer |
| B17 / REQ-6 | UW authority and immutable approval proposal | Integration | Unauthorized/stale approval cannot bind; legitimate review proceeds |
| B18 / REQ-7 | Company active/state/product/tenant matching | Integration | Correct company; wrong/inactive/cross-tenant rejected |
| B19 / REQ-7 | Agency/producer appointment and identity association | Integration | Authorized relationship works; missing/expired/inactive/wrong scope fails |
| B20 / REQ-7 | Direct API bypass and missing eligibility storage/config | Integration | BOP fails closed; frontend selection is not enforcement |
| B21 / REQ-8 | Opt-in demo setup twice, concurrent retry and conflict | Integration | Atomic/idempotent; no duplicate or overwritten existing records |
| B22 / REQ-8 | Owner/tenant sample customers, quotes and issued example | Integration | Coherent linked domain records, real persisted calculation/audit evidence |
| B23 / REQ-8 | BOP labeled TXT ingestion and approval | Unit/integration/Playwright | Expected fields/evidence; review required; atomic approved draft creation |
| B24 / REQ-8 | Conflicting/missing intake facts and unsupported uploads | Unit/integration | Conflicts not auto-confirmed; no invented eligibility facts |
| B25 / REQ-9 | Quote/binder/declarations attachment and rendering | Integration/artifact QA | Correct transaction/output/terms; visible demo non-contract warning |
| B26 / REQ-9 | Edition/rating update after issuance | Integration | Historical coverage terms, calculations and forms remain pinned |
| B27 / REQ-10 | Quote -> rate -> authorized bind -> issue | Integration/Playwright | Successful owner/tenant flow and correct policy details |
| B28 / REQ-10 | Endorse/renew/rewrite | Lifecycle integration | Correct versions, premium effects, pinned/current definitions per framework |
| B29 / REQ-10 | Cancel/reinstate/non-renew | Lifecycle integration | Existing compliance/reason/date gates, no BOP shortcuts |
| B30 / REQ-4,5 | Two premises/risks submitted directly | API | Explicitly rejected; never silently rate only first |
| B31 / REQ-10 | Roles/RLS/customer portal/audit | Integration | No cross-tenant access or internal-note exposure; authoritative actors |
| B32 / REQ-10 | Embedded existing wizard/submission/admin screens | Component/Playwright | Correct dependencies, controls, errors and navigation |
| B33 / REQ-10 | Desktop and 390px, keyboard/focus/long labels | Browser screenshots/a11y | No overlaps/page overflow; accessible controls |
| B34 / REQ-10 | Every existing product's discovery/rating/intake | Regression | Existing defaults, quote contracts and product fixtures still pass |
| B35 / REQ-10 | No external calls/auto-training; no normal-boot demo seed | Unit/config | No new data recipient, training path, public user or surprise DB mutation |

## Execution and evidence

1. Check current baseline; run focused shared/server/component tests while coding.
2. Validate pack/schema and every offered coverage pricing option; independently
   computed golden totals (not snapshots of the same implementation).
3. Run fresh-PostgreSQL integration with RLS/role and lifecycle/dependency cases.
4. Run full tests, typecheck, build and relevant browser regression; separate
   synthetic private-provider contract tests from real model readiness.
5. Independent code review in a separate session, security/compliance review and
   automation stage before requesting Gate C. Record commands, counts, failures,
   fixes and residual risk in the appropriate stage docs.
6. Deployment and post-deploy browser smoke only after appropriate approval;
   business validates owner, tenant, referral/decline and documents at Gate D.

## Important exclusions

No claimed production filing approval, real address/license verification, premium
ledger or LLM accuracy certification. If a lifecycle/dependency cannot be
implemented safely, report it as blocking or explicitly return to design;
do not advertise it as supported or remove the negative test.
