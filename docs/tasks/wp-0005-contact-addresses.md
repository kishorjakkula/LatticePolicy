# WP-0005: Embedded Contact Addresses

Approved work: `docs/work/WP-0005-standardize-us-address-fields-across-application/`.
Keep existing screens. Contact entities support multiple addresses; risk,
dwelling, transaction mailing and each vehicle's garaging address remain single.
Phone/mobile and email are contact-level, not inside address objects.

## Implementation Map

- `frontend/src/components/AddressFields.tsx`: common fields, optional explicit
  Census check, suggestions and request-generation invalidation.
- `ContactAddresses.tsx`: add/edit/remove/primary/dates and communication fields.
- `frontend/src/shared/postalAddress.ts`: adapters; legacy primary projections,
  explicit empty lists, units, ZIP+4 and metadata preservation.
- Existing customer/insured/quote/wizard screens embed the controls. Contact
  selections/saved quotes retain all addresses, not just primary.
- Backend optional unit intake mapping, interest binding and document tokens.
- `server/src/services/address-check.service.ts`, `routes/addresses.routes.ts`:
  protected transient range matching, no policy DB writes or postal certification.

## Configuration And Privacy

`ADDRESS_CHECK_PROVIDER=census` plus exact comma-separated
`ADDRESS_CHECK_ALLOWED_TENANTS` enables checking; empty defaults disable it.
Both are exposed in the local Compose environment without enabling it.
Synthetic/public demo addresses only until carrier privacy/terms approval.
No keystroke/background requests or automatic provider fallback. Only base
street/city/state/ZIP sent; no unit, email, phone, identity or policy data.
No-store and idempotency bypass prevent retaining provider responses. Matching
can fail/unavailable offline without blocking normal carrier-rule-controlled entry.

## Compatibility And Testing

Customer address storage already supports line2 and collections. No migration
or backfill. Quotes retain singular legacy primary projection plus full contact
addresses; risk structured data is additive. Old free text is never parsed by
guessing. Older app versions may discard additive fields when editing; disable
external matching first on rollback and review save compatibility.

Tests cover collection add/remove/primary, independent email/phone, ZIP+4/units,
read-only state, late suggestions, backend transport/auth/privacy, documents,
and PostgreSQL customer/quote-to-policy persistence under actual RLS role.
Final counts and browser evidence are in the work-package handoffs. No claim
of production USPS delivery validation, offline national matching or live
provider accuracy. No merge or production deployment authorized by these tests.

## Handoff And Local Preview

Branch: `latticepolicy/wp-0005-us-addresses`, base `c55b6bd`. Local shared/frontend/
server/PostgreSQL pass (221/604/977/302), final full Chromium 165 passes. New scenarios
include scoped axe/screenshots at 1440/390 light/dark; repeat results and earlier
diagnostic failures are in 09. Independent R1-R6 resolved; typecheck/build/module
boundaries pass.

Independent review R7 (suggestion button contrast) is also resolved. Final small
UI/lockfile review is in `07a-final-ui-review.md`, with no new actionable finding.
The three new browser scenarios pass nine executions over three repeats.

Preview: UI http://localhost:5175, API http://localhost:3302, synthetic
`lattice_policy_browser_verified` database in `lattice-wp5-integration` PostgreSQL
(host 53859), isolated `lattice-wp5-cache` Redis (host 53860). Original demo/pilot
containers, volumes and 5173/3300 application remain untouched. This is a local
host-process preview, not latest code deployed in the Docker application.
Optional external matching remains disabled.

Baseline moderate ip-address advisory GHSA-rxp7-6hxx-x8q5 fixed with the targeted
10.7.3 -> 10.7.4 lockfile-only update. Audit policy passes; no exception added.
Pending: hosted CI/CodeQL/container scan; PR/code-owner Gate C; staging
deployment and carrier business Gate D. Do not merge or mark release-ready from
local results only. Security/automation completion intentionally pending. Keep
unrelated untracked research/output files untouched.
