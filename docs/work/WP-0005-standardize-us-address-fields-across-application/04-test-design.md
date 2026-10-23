# Test Design - WP-0005

Proposed for Gate B. All data synthetic or public, never customer/pilot data.

| Criterion | Case | Layer | Data / Expected |
| --- | --- | --- | --- |
| REQ-1 | Every address editor exposes labelled complete fields | Component + browser audit | Customer, insured, mailing, interest, dwelling; unique labels/IDs, keyboard usable |
| REQ-2 | ZIP boundaries and country switch | Unit + component | 02108, 02108-1234, malformed ZIP, empty/partial, Canada K1A 0B1; preserve leading zeroes/non-US |
| REQ-2 | Mailing states versus risk jurisdiction | Component/API | DC, territories, AA/AE/AP; do not broaden product underwriting eligibility |
| REQ-3 | Adapter round trip and explicit schema picks | Unit | line2/line3/county/country/ZIP+4 preserved across every mapped shape |
| REQ-3 | Save/reload, insured copy, bind and policy-change payload | PostgreSQL + Playwright | Unit survives customer -> insured -> mailing -> quote -> policy; original versions unchanged |
| REQ-3 | Existing free-text dwelling | Unit/component + API | Legacy text retained verbatim, no guessed split; new structured field additive |
| REQ-3 | Document and export address projections | Unit/integration | Full unit/address printed, no change to rating/premiums or filed template selection |
| REQ-4 | Census outcomes | Server unit + component | 0/1/multiple matches, malformed/truncated responses; no false USPS/deliverable labels |
| REQ-5 | Apply/Keep and unit preservation | Component + Playwright | Keep causes no mutation; Apply changes draft only, unit/ZIP+4 not claimed verified |
| REQ-5 | Stale response race | Component | Edit/copy/reset/switch country/unmount, including edit-away-and-back; late results discarded |
| REQ-6 | Disabled and tenant enablement | Server/API | Missing flags, wrong provider, absent/other tenant allowlist => zero outbound calls |
| REQ-6 | Data minimization and logs | Server unit/API | Names/IDs/unknown fields rejected; unit not transmitted; sanitized errors, no address query/body logs or shared cache |
| REQ-7 | Offline/timeouts/provider failures | Server unit + browser | Abort, DNS/503, oversized/invalid payload, body stall; entries retained and no automatic business stop |
| REQ-7 | Unsupported address types | Unit/component | PO box/military/non-US/new construction; honest unverified state, not automatic invalidity |
| REQ-8 | Authorization and tenant boundary | API + PostgreSQL with RLS | Anonymous 401; portal/read-only denied; allowed editing roles; pinned/other tenant denied; no customer object fetched |
| REQ-8 | Existing configured checks and rate invalidation | Integration/browser | Carrier screen/rate/bind/issue requirements still enforced; suggestions do not silently alter state or rating territory |
| REQ-9 | Complete visual journeys | Playwright | Desktop 1440px/mobile 390px, dark/light, long text, 200% zoom, axe, copy/save/reopen |
| REQ-10 | Multiple addresses per primary/secondary/additional/other contact | Component + PostgreSQL + browser | Add 3 distinct rows, edit one, save/reopen; all rows/IDs/units/types survive independently |
| REQ-10 | Primary/removal/empty-list behavior | Unit/component + API | First row primary, change primary, remove primary and see deterministic replacement, remove all under carrier rules; never two primaries |
| REQ-10 | Single-value risk/garaging/other slots | Component + browser | Each risk/vehicle has one address and no Add Address list; changing one vehicle never changes another |
| REQ-10 | Contact copy and legacy projection | Unit + PostgreSQL | Explicit chosen contact address populates one mailing/risk slot; full source collection survives; primary compatibility fields remain accurate |
| REQ-10 | Row-specific check races | Component/API | Switch/remove contact/address while check pending; late result cannot replace another row's address |
| REQ-10 | Existing screen preservation | Browser | Existing contact fields, tabs, navigation and Save/Cancel remain; read-only popup does not gain unauthorized editing |
| REQ-11 | Communication stays contact-level | Component + PostgreSQL + browser | Email/mobile survive address add/remove/switch/save; no communication fields in postal objects or provider request; updated/cleared primary email updates notification projection |
| REQ-8 | Contact-only permissions with masked identity | PostgreSQL/API | Address PATCH preserves encrypted DOB; customer_service cannot change any identity section or entity type, including BOTH -> INDIVIDUAL/COMPANY |

## Negative And Security Cases

Strict bounded body and field lengths, unknown URL/metadata keys, invalid
country/state/ZIP representations, Unicode/escaped inputs, control characters,
redirects, hostile/oversized candidate lists and malformed JSON. Fixed provider
host only; no fallback. Limiter emits 429 without outbound request, isolates
tenant/user buckets; duplicate check clicks send one request. Permission and
configuration checks run server-side even if the browser forges capabilities.
Assert actual restricted tenant role in scoped PostgreSQL checks, not only an
environment variable. No reuse of real demo/pilot databases.

## Regression And Verification Plan

Run focused shared-type/schema, address adapter/service, customer, insured,
quote/common section, intake mapping and document tests. Then root typecheck,
frontend/server suites, fresh disposable full PostgreSQL suite with tenant RLS,
isolated browser suite and UI audit. Test default-disabled and explicitly
enabled synthetic demo configuration. Provider traffic is mocked in automated
CI; optional single public-address live smoke only after explicit enablement,
with no stored raw response or customer data.

Record actual counts, skipped coverage and independent review in handoffs;
plans are not passing evidence. Local deployment/business validation and human
merge/release gates remain separate. No production service fitness claim.
