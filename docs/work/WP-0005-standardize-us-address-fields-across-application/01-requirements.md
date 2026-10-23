# Requirements - WP-0005

## Business Goal

Consistent US address entry for the demo, preserving privacy, historical
policy data and existing workflows. Major track: customer data across screens
and an external data recipient. Application changes wait for Gates A and B.

## Inventory And Scope

Code inspection, not a completed visual/browser audit:
- Customer address editor: `frontend/src/features/admin/CustomersPage.tsx`;
  line 2 missing from editing despite richer backend data.
- Primary/secondary insureds: `frontend/src/features/insureds/InsuredsPage.tsx`.
- Mailing and mortgagee/loss-payee/additional-interest addresses:
  `frontend/src/features/wizard/CommonQuoteSections.tsx`.
- Customer/insured mappings, address copying and single-box dwelling risk:
  `frontend/src/features/wizard/QuoteWizard.tsx`.
- Legacy dwelling entry: `frontend/src/features/quotes/CreateQuotePage.tsx`.
- Verify configured forms, intake mappings, summaries, imports/exports and
  generated documents for compatibility. Contact email/mobile ownership is in
  scope per REQ-11; new communication delivery services are not in scope.

All existing products with postal addresses, existing roles/channels and
transaction editors. Support US state/DC/territory and military mailing
conventions without equating them with underwriting-state eligibility.
Preserve Canadian/other supported non-US addresses and historical versions.

## Requirements And Acceptance Criteria

| ID | Requirement | Given / When / Then |
| --- | --- | --- |
| REQ-1 | Consistent Address line 1, Apartment/suite/unit (line 2), City, State, ZIP Code and Country; optional County where relevant. | Given an editable US postal address, when opened, then these fields are labelled and accessible on desktop/mobile. |
| REQ-2 | US-specific state choices and ZIP formatting, not numeric ZIP storage. | Given 02108 or 02108-1234, when saved/reopened, then leading zeroes and ZIP+4 survive; non-US addresses are not forced into US rules. |
| REQ-3 | Complete round-trip data through customer, insured, mailing, interest, risk and document mappings. | Given an apartment address, when copied/saved/carried to a policy, then line 2 remains; legacy free text is not guessed or silently split. |
| REQ-4 | Optional free address matching, not postal-deliverability certification. | Given demo checking enabled, when requested, then matched, ambiguous, unmatched, unsupported and unavailable are distinct; a geocode match is not labelled USPS verified. |
| REQ-5 | User reviews suggested changes; edits invalidate prior results. | Given a suggestion, when shown, then the original remains until a person applies it; unit data is not discarded or invented. |
| REQ-6 | External service disabled by default, explicitly enabled/disclosed for demo. | Given private/disabled mode, when entering/saving, then no external request occurs; enabled checks send only necessary postal parts, not names/policy IDs/documents. |
| REQ-7 | Offline/provider failures do not break entry or falsely certify addresses. | Given timeout/no internet/unmatched input, when checking, then entry remains saveable under existing carrier rules and the outcome is honest. |
| REQ-8 | Preserve tenant isolation, backend permissions and configurable validation. | Given an unauthorized/read-only user, when attempting UI/API edits/checks, then access is enforced; no automatic rating/jurisdiction or historical policy change occurs. |
| REQ-9 | Automated and visual regressions cover affected flows. | Given the implementation, when tested with synthetic data, then persistence/copying, ZIPs, non-US, privacy/offline, authorization, stale responses and desktop/mobile cases pass. |
| REQ-10 | Embed within existing screens; each contact supports multiple addresses, while each risk/dwelling/garaging address is single-valued. | Given a contact in any editable workflow, when adding/editing/removing addresses, then the collection survives save/reopen and an explicit primary is retained; when editing a risk or vehicle garaging address, then only that object's one address changes, with no Add Address list action. |
| REQ-11 | Mobile number and email belong to the contact, outside postal addresses. | Given multiple postal addresses, when editing phone/email or switching the primary address, then communication values remain contact-level and are neither duplicated into addresses nor sent to the address matching provider. |

Maintainer clarification: "don't design entirely new this object should be
embed into the current screen, it should allow to add multiple address for a
contact where ever contact is there. but risk address or garag address like
that any other address is there it should be single". Keep existing screen
layout, navigation, tabs, actions and read-only behavior. Address collections
belong to contact entities, not each phone/email contact point. Transaction
mailing and other non-contact address slots remain single-valued. A policy can
still contain several risks/vehicles, each with its own single address.

## Business Rules And Sources

- Fields and demo behavior: maintainer request 2026-10-22; proposed defaults
  require Gate A approval.
- Preserve secondary units: USPS Publication 28 section 213:
  https://pe.usps.com/text/pub28/28c2_003.htm
- Census matches address ranges, not necessarily actual structures:
  https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/census-geocoder.html
- Structured inputs and service scope:
  https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
- Free service reference:
  https://help.bdc.fcc.gov/hc/en-us/articles/5341095744283-How-to-Use-the-Census-Geocoder
- Required fields and transaction stops: `docs/VALIDATION_RULES.md`.
- Insurance knowledge reviewed 2026-10-17, within review period. No new filed
  rate, notice, form or legal-compliance requirement is asserted.

## Privacy, Limitations And Exclusions

External matching sends addresses outside the carrier and requires internet.
Demo integration approval is not approval to send real customer/carrier data.
Provider terms, retention and carrier privacy approval need confirmation before
real-data rollout. Live verification uses public/synthetic addresses only.
No bulk submission, automatic customer-data rewrite, production SLA, USPS
DPV/CASS certification, guaranteed ZIP+4 enrichment or offline national database.
PO boxes, military delivery, apartment units and new construction may remain
unverified; inability to geocode alone must not mark them invalid. Additional
carrier required-field rules still apply independently.

## Gate A Decision Requested

Approve this scope and Census demo matching, external checks disabled by
default and initiated explicitly, with original/suggested comparison and no
automatic blocking on an unmatched or unavailable provider result.

Gate A approved by Kishor Jakkula: "Approve proceed with the change".
Detailed architecture, UI mockup and test plan are prepared for Gate B;
implementation/testing follows design approval. No runtime changes made yet.
