# Test design — WP-0008

Layers: server unit (vitest with mocked queries), real-PostgreSQL integration, frontend
component, Playwright E2E (isolated stack). Synthetic data only.

| Criterion | Case | Layer | Data | Expected |
| --- | --- | --- | --- | --- |
| REQ-1 / 1 | Rate an Eligible personal-auto quote, PATCH draft with driver age 17 | Integration (real HTTP + DB) | Synthetic PA quote | Status Draft; underwriting and premium NULL; `ratingReset: true`; status history has the reset |
| REQ-1 / 2 | Rate, PATCH the same payload with keys reordered and server-owned keys missing (as the wizard sends) | Integration | Same | Stays Rated; underwriting and premium unchanged |
| REQ-2 / 1 | PATCH draft with status "Rated" on an unrated quote | Unit + integration | Draft quote | 400 INVALID_STATUS; row unchanged; bind of it → 409 |
| REQ-2 / 2 | PATCH status "Issued" on a converted quote (wizard audit) | Integration | Bound quote | 200, status Issued |
| REQ-2 / 3 | PATCH status "Issued" on a Rated (not bound) quote | Unit | Rated quote | 400 INVALID_STATUS |
| REQ-3 / 1 | Bind a quote whose stored payload was changed directly in the DB after rating | Integration | Rated quote, payload updated by SQL | 409 QUOTE_RERATE_REQUIRED; no policy, version, document or referral rows created |
| REQ-3 / 2 | Bind an unchanged rated quote | Integration + existing E2E quote-wizard bind | Rated quote | Policy created with the rated premium |
| REQ-3 / 3 | Rate Eligible, change to driver 17, re-rate, bind | Integration | PA quote | Bind is referred (referral created) |
| REQ-3 / 4 | Legacy rated quote without a fingerprint | Integration | Quote row with underwriting lacking `ratedFingerprint` | Bind succeeds once |
| REQ-4 / 1 | Rate, PATCH only paymentPlan and billingMethod, bind | Integration + E2E (quote-wizard Payment section) | PA quote | Stays Rated; the bound policy payload has the new payment plan |
| REQ-5 / 1 | Wizard: rate, change driver age, return to Premium | Component + E2E | PA quote | Notice "Your changes need a new rating", Rate again, no Bind; after Rate again the premium shows |
| REQ-5 / 2 | Wizard bind receives 409 | Component | Mocked 409 | Step-8 notice with "Go to Premium" |

## Negative, authorization and tenant-isolation cases

- **Another tenant's quote id:** PATCH draft and bind return 404 and change nothing.
- **Agent without the wizard permission:** 403 on draft.
- **Concurrent save and bind:** run both in parallel. The `FOR UPDATE` lock serializes them; bind either sees the reset and returns 409, or completes before the reset. It never binds the changed payload with the old rating.
- **Client tries to send underwriting or premium in the draft body:** ignored. Assert the stored values are unchanged unless reset.
- **Unknown status values** ("Bound", "Converted", "rated", "", 42): 400 INVALID_STATUS. A non-string value must not cause a 500.

## Regression cases

- **Existing E2E suites must pass:** quote-wizard, policy-lifecycle, multi-product, pre-bind-checks, uw-referrals, underwriting-rules, production-policy-scenarios and the pilot workflow.
  - They bind through the wizard after autosaves. A wrong fingerprint definition would show up here as unexpected 409s.
- **Existing integration suites must pass:** quote-to-bind, policy-referral-http and document-artifact-storage. Full `npm run test:integration` on a fresh database.
- **Fingerprint stability:** a unit test asserts that the rate step's stored payload and the wizard's `buildQuotePayload` output for the same quote give the same fingerprint, using a captured fixture.
