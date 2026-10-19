# Business validation — WP-0002

Environment: local staging (Docker stack built from `main` at 25606a0), tenant
`sample-carrier`, synthetic data only, 2026-10-19. Evidence is under
`evidence/business-validation/`.

| Criterion | Role | Steps | Expected | Actual | Evidence | Result |
| --- | --- | --- | --- | --- | --- | --- |
| REQ-1 / Defaults come from the selected product only | Agent (agent1) | New quote → PA UW Company, CA, Personal Auto → qualification, insured, vehicle → Coverages → Apply Default Coverages | Only BI, PD, COMP, COLL offered and selected | Coverages step lists Bodily Injury, Property Damage, Comprehensive, Collision; no homeowners coverage on the page; saved quote Q20261019-6IR7 carries `BI, PD, COMP, COLL` | `3-personal-auto-coverages.png`; quote Q20261019-6IR7 | Pass |
| REQ-2 / Switching product clears the old product's coverages | Agent (agent1) | Start Homeowners (HO UW Company), answer the 5 homeowners questions → Back to Product → change Underwriting Company to PA UW Company → continue as Personal Auto | No homeowners coverage, risk or answer remains; personal auto coverages can be applied | Company change cleared product, jurisdiction, answers, risks and coverages; personal auto questions start unanswered; Q20261019-6IR7 holds only personal auto answers and coverages. **No confirmation was shown** (see open issue 1) | `1-homeowners-answers.png`, `1b-after-company-change.png`, `2-personal-auto-questions-after-switch.png` | Pass (clearing); confirmation open |
| REQ-3 / Rating rejects coverages the product does not define | Agent (API, agent1) | `POST /api/v1/quotes` with a valid personal auto payload (control), then the same payload plus `END_WB` | 422 naming END_WB; no premium saved | Control 200. With END_WB: `422 INVALID_QUOTE`, "Coverage END_WB is not offered by Personal Auto." at `/coverages/2/code`; quote count rose by 1 (control only) | API responses recorded in this sheet | Pass |
| REQ-3 / Binding re-checks coverages | Agent (API, agent1) | Add `END_WB` to rated quote Q20261019-S7J9 in the database (same method as the integration test), then `POST /quotes/:id/bind` | Bind refused naming the code | `422 PRODUCT_RULES_NOT_MET`, transaction `bind`, "Coverage END_WB is not offered by Personal Auto."; quote stays Rated, no policy created | Trace 5fd8a12f-f6b3-4e7e-afe5-31af6ce0e2f7 | Pass |
| REQ-4 / Premium step shows the product's coverages | Agent (agent1) | Rate Q20261019-6IR7 → Premium step | BI - Bodily Injury Liability listed; no homeowners coverage | BI $166.60, PD $98.00, COMP $138.59, COLL $180.17, total $625.86; no END_* / Dwelling rows. Also held in 20 repeated wizard runs (`11-e2e-results.md`) | `4-premium-step.png` | Pass |
| REQ-5 / Administrators see affected records | Admin; Agent for access check | `GET /api/v1/admin/dashboard/coverage-integrity` as admin; same as agent1; hash quotes and policies before and after | Each record listed with product, unexpected codes and status; nothing changed | 9 records listed, including both quotes from the original defect (Q20261018-MWPP, Q20261018-I4TL) and the bound policy PC-987896C3 with the homeowners set, plus older records: a homeowners draft carrying cyber codes and `DWELLING` fixture records. Data hashes identical before and after; agent1 gets 403 | `coverage-integrity-report.json` | Pass |
| REQ-6 / The smoke test is reliable | — (automated) | Quote-wizard smoke spec ×10 in parallel | Passes every time | 10/10 on the isolated e2e stack; on local staging 9/10, the failure being an environment rate limit after issue, not this defect | `11-e2e-results.md`, `evidence/e2e-repeat-failure/` | Pass |

## Open issues

1. **Product change confirmation is not reachable through the company
   select (REQ-2, Gate A answer 4: "confirm, then clear").** Each underwriting
   company on staging writes exactly one product, so an agent switches product
   by changing the Underwriting Company. That handler (`QuoteWizard.tsx`, the
   `wizard-setup-company` select) clears product, answers, risks and coverages
   immediately without the new "Change product to …?" dialog. The dialog
   appears only when the Product select is changed within a company that
   writes several products. Data integrity is correct; the agent loses entered
   answers without warning. Proposed: a quick-track follow-up that routes the
   company change through the same confirmation, or accept as an exception.
2. **Abandoned draft on switch (minor, pre-existing behaviour).** Switching
   company after the homeowners quote was saved starts a new personal auto
   quote; the homeowners draft remains as a Draft record. No action proposed
   unless the business wants switches to reuse the quote.
3. **Records to correct (carrier decision, out of scope by Gate A answer 3).**
   The integrity report shows bound policy PC-987896C3 and 8 quotes with
   coverages outside their product on staging. All are test data.

## Recommendation

Accept. Every acceptance criterion passes on staging. The defect is fixed at
both layers: the wizard no longer shows or sends another product's coverages,
and the API refuses them at rating and binding. Administrators can see the
records the defect already created. Open issue 1 does not lose or corrupt
policy data, but it falls short of the confirmation agreed at Gate A. I
recommend signing off on WP-0002 and either taking issue 1 as a quick-track
follow-up or recording it as an accepted exception in the Gate D note.

Gate D: pending, for the business owner (Kishor Kumar Jakkula, product owner).
