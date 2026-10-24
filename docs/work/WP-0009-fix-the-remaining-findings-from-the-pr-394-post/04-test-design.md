# Test design — WP-0009

Layers: server unit, real-PostgreSQL integration (disposable database), frontend component,
Playwright in CI. Synthetic data only.

| Criterion | Case | Layer | Data | Expected |
| --- | --- | --- | --- | --- |
| REQ-1 / 1 | Rewrite referral on a cancelled policy | Integration | Cancelled policy, rewrite proposal $1,250 | List and detail premium 1250 |
| REQ-1 / 2 | Renewal after an endorsement | Integration | Endorsed +$15, renewal proposal $1,300 | 1300 |
| REQ-1 / 3 | New-business referral; legacy referral without a snapshot | Integration | NB quote premium; no snapshot | Quote premium; quote premium or null |
| REQ-2 / 1 | Approval survives another bind in the book | Integration | Aggregation limit configured, not exceeded | Retry binds with the approval; no new referral |
| REQ-2 / 2 | Aggregation newly exceeded | Integration | Limit exceeded after approval | Refused or referred on aggregation |
| REQ-3 / 1 | WP-0004 records | Docs check (`npm run flow -- status WP-0004`) | — | Gate C approved; Phase 2 review entry present |
| REQ-4 / 1 | PATCH status without a reason | Integration | Eligibility row | 400 REASON_REQUIRED; unchanged |
| REQ-4 / 2 | PATCH with a reason | Integration | Same | Updated; one ledger_events row with before and after |
| REQ-5 / 1 | Company not writing the product or state | Integration | HO-TX-only company on a PA-CA quote | Rate and bind 400 UNDERWRITING_COMPANY_NOT_ELIGIBLE |
| REQ-5 / 2 | Valid company; no company named | Integration + existing E2E | — | Rates and binds as today |
| REQ-6 / 1 | Self-approval | Integration + component | Referral created by U1 | U1 approve gives 403; U2 approve gives 200; U1 decline allowed |
| REQ-6 / 2 | Earlier decision | Integration + component | Declined referral, same proposal referred again | `priorDecisions` lists it; detail shows the section |
| REQ-7 / 1 | Legacy Open referral | Migration integration | Open referral with null `proposal_hash` | Withdrawn with comment and ledger row; re-running the migration changes nothing |
| REQ-8 / 1 | Phone sheet | Component (AppNav) | 390px | Focus to the first link on open; Escape closes; focus back to the toggle |
| REQ-9 / 1 | Date mapping on a server east of UTC | Unit (`TZ=Asia/Kolkata`) + integration | Concurrent first attempts | Calendar date preserved; one referral |
| REQ-10 / 1 | Reason 42 | Unit + integration | — | 400 INVALID_REASON |
| REQ-11 / 1 | Expired status; past `expiry_date` | Integration | Quote Expired; quote with `expiry_date` yesterday | 409 QUOTE_EXPIRED; nothing written |
| REQ-12 / 1 | Endorsement through the route marks its quote Issued | Integration + E2E (policy-lifecycle) | Issued policy, endorsement quote | Quote Issued with no client status; draft PATCH with Issued gives 400 |
| REQ-13 / 1 | Re-rate an Issued quote | Integration | Issued quote | 409 QUOTE_ALREADY_BOUND; unchanged |
| REQ-14 / 1 | Refusal log | Unit (logger spy) | Stale quote bind | One warn line with tenant, quote id and code; no payload keys |

## Negative, authorization and tenant-isolation cases

- **Prior decisions:** another tenant's referral with the same hash is never listed.
- **Company check:** another tenant's company of the same name does not count.
- **Eligibility PATCH:** another tenant's id gives 404, nothing changes, and there is no ledger row.
- **Self-approval:** an authority-override approval by the submitter is still refused; there is no admin override.

## Regression cases

- **Existing suites:** uw-referral, policy-referral-http and the referral E2E specs; rated-quote-guard and quote-to-bind; compliance bulk tests; AppNav tests.
- **Full CI:** Playwright, DB integration and the pilot.
- **Migration 071:** runs cleanly on a database that already has the AI branch's 067, 068 and 070 or lacks them (runner order tolerance).
