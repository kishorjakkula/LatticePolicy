# Design - WP-0005

Status: Gate B approved by Kishor Jakkula with "ok, proceed with the changes,
and think about adding the mobile number and email address out side the address
object for the contact." Implementation and verification in progress.
Email/mobile stay in existing contactPoints or contact-level email/phone
compatibility fields; never in postal address objects or provider requests.

## Options Considered

1. Browser calls to public geocoders: rejected; weak configuration enforcement,
   address exposure in browser URLs, no centralized timeout/rate controls.
2. Server-mediated Census matching with local field checks: selected for the
   free demo; no API key needed by the documented endpoint. It matches address
   ranges, not deliverability/units. No USPS certification claim.
3. Licensed postal validation or carrier-hosted address dataset: future adapter
   when postal-deliverability guarantees or disconnected matching are required;
   no paid subscription, provider account or large dataset provisioned now.

## Components And Data

- Shared type-only postal address contract in `packages/types`: line1, line2,
  city, state, postalCode, country, optional county. Preserve optional existing
  line3 rather than silently dropping customer master data.
- Shared frontend `AddressFields` and `AddressCheck` controls; named adapters
  for legacy street/zip, customer line1/postalCode and additional-interest
  shapes. Do not create a new package for this feature.
- Embed these controls within existing contact, wizard, risk and servicing
  sections. Do not replace screen layout/navigation or introduce an address
  page. Contact editors reuse the existing address table with inline editing
  for its selected row and Add/Remove/Set primary controls. All primary,
  secondary and additional contacts have independent address collections.
- Store complete `addresses[]` on contact/insured JSON snapshots, preserving
  stable IDs, type, primary flag, effective dates and existing metadata. Keep
  legacy singular `address` as a compatibility projection of the primary
  address, not a replacement for the collection. Normalize legacy single-address
  contacts to a one-item collection at the edit boundary without historical
  bulk updates. Customer master already supports multiple address rows.
- At most one primary per contact; first added address defaults primary. User
  can change it explicitly. Removing the primary chooses a deterministic
  remaining address and makes the new primary visible before Save. Removing
  all addresses is allowed only as existing carrier validation permits.
- Additional interests that represent contacts may carry `addresses[]` too;
  retain existing singular street/zip fields as the selected-primary projection.
  A phone/email row is not a separate address-owning contact entity.
- Single-value address slots (transaction mailing, each risk/location/dwelling,
  each vehicle garaging address) use one editor with no Add/Remove address-list
  controls. Selecting/copying a contact address into such a slot copies only
  the explicitly selected address, never collapses or changes the contact list.
  Several vehicles/risks may each own their own single address.
- Server routes/service encapsulate Census transport and input/output parsing.
- Customer master already has line2/county/coordinates: no new table, column,
  migration, RLS policy or backfill planned. Existing JSON quote/policy payloads
  gain additive line2/country/county fields through existing save paths.
- Dwelling risks gain optional structured `locationAddress`; retain legacy
  `address` display string. Populate it from newly entered structured fields.
  Existing free-text risks remain intact and offer explicit structured entry;
  do not infer city/state/ZIP by splitting a string.
- Extend every explicit mapping/normalizer/schema/document projection involved:
  quote drafts, insured/customer selection, mailing-copy actions, additional
  interests, bind and servicing snapshots, summaries and generated documents.
  Identify strip/pick schemas and unknown-key rejection before implementation.
- Preserve garaging ZIP as its existing rating field; do not fabricate a full
  garaging address where only ZIP is known. A new risk address must not silently
  change quote underwriting state or rating territory. Existing invalidation
  rules still require rerating after material edits.
- Existing carrier-pack fields and intake definitions remain configuration-owned.
  Review and explicitly extend address mappings where supported; no automatic
  rewriting of carrier custom forms or incoming documents.

## API Contract

Under authenticated tenant-scoped `/api/v1/addresses`:

- `GET /capabilities`: `{ enabled: false, provider: null }` by default, or
  `{ enabled: true, provider: "census", kind: "address_range_match" }`.
- `POST /check`: strict `{ address: { line1, line2?, city, state, postalCode,
  country } }`, bounded text lengths and total body size. No arbitrary provider
  URL, customer/quote ID, name or freeform metadata accepted.
- Success envelope: `{ outcome, provider: "census", checkedAt, candidates }`.
  Outcomes: `matched`, `ambiguous`, `unmatched`, `unsupported`, `unavailable`,
  `disabled`. Each bounded candidate has structured suggested fields and
  `precision: "address_range"`; optional coordinates are not a roof-level claim.
  No boolean named `deliverable` or `uspsVerified`.
- Missing/invalid bounded input: 400 `INVALID_ADDRESS_INPUT`; authorization 401/
  403; limiter 429. Provider timeout/error returns `unavailable` without upstream
  content. Disabled capability does not contact Census. Unsupported countries,
  PO boxes/military formats are not submitted to an unsuitable search.
- Require authenticated non-portal identity and an existing editing capability:
  `page.wizard.view`, `admin.customers.manage` or
  `admin.customers.contact.manage`. Do not broaden customer-portal scope.
  Object changes still go through existing object-scoped authorization routes;
  this endpoint accepts a caller-entered address and never reads database objects.
- Document request/response and error envelopes in OpenAPI and cover with tests.

## Privacy And Security

Enable only when `ADDRESS_CHECK_PROVIDER=census` AND the resolved tenant is in
an explicit `ADDRESS_CHECK_ALLOWED_TENANTS` list (no wildcard). Empty/missing
configuration disables all external calls. For a pinned carrier stack the
request tenant must also match existing deployment pinning. No AI integration.
Before check, display recipient and obtain an explicit per-check action. No
per-keystroke calls, background submission or automatic check on save/import.

Use a fixed HTTPS Census host/path, structured URL parameters, no redirects,
5-second abort deadline covering headers/body, a 256KB response ceiling and at
most 5 candidates. No client-controlled endpoint or raw upstream error output.
Send street/city/state/base ZIP only; do not send line2, names or policy data.
Preserve original unit and ZIP+4 suffix in suggestions rather than claim they
were checked. Conflicting/poorly structured matches remain unverified.

Do not log bodies, outbound URLs/query strings or provider responses; error
logs use sanitized codes only. Set no-store on responses and do not persist
provider responses or build a cross-tenant address cache. Check result is
transient and cannot be submitted as trusted postal-validation evidence.
Existing audit paths record actual human-saved edits; no AI/user impersonation.
Rate limit this optional outbound operation by tenant/user (20/minute), plus
existing global limits. No business DB transaction held during remote requests.

## Interaction, Rollout And Rollback

Check is scoped to a stable contact/address ID or single-slot identity; switching
contacts/rows cancels or discards the previous row's pending result. It uses a
snapshot of all address fields. Any edit, reset, copy, country
change or navigation invalidates pending results. Drop late responses even if
the user edits back to identical text (request generation check); preserve unit
data and require explicit Apply. Read-only views never expose edit/check actions.
No external result blocks save/rate/bind by itself. Required fields and business
checks use the carrier validation framework; malformed API requests can still
be rejected. Offline operation supports entry/local checks, not matching.

Ship disabled. Enable only a synthetic-data demo tenant explicitly; public
test addresses only. Real-carrier enablement needs provider/privacy approval.
Rollback: disable flags first, then revert app if necessary. No destructive DB
rollback, historical policy rewrite or external-provider fallback. Older images
may omit new optional JSON fields when saving; avoid older-image edits until
round-trip compatibility is checked. No production deployment in this work.

## Requirement Mapping

| Requirement | Design element |
| --- | --- |
| REQ-1/2 | Shared labelled editor; country-aware state/ZIP controls |
| REQ-3 | Named lossless adapters; additive risk JSON; document propagation |
| REQ-4 | Bounded Census adapter and honest range-match outcomes |
| REQ-5 | Entered/suggested comparison and generation invalidation |
| REQ-6 | Disabled default, tenant allowlist, minimal explicit disclosure |
| REQ-7 | Nonblocking unavailable/unsupported states, local entry |
| REQ-8 | Existing RBAC/tenancy and carrier rules; no history rewrite |
| REQ-9 | Layered synthetic regressions in `04-test-design.md` |
| REQ-10 | Embedded contact address collections with primary projections; single-value risk/garaging/mailing slots |
| REQ-11 | ContactCommunication fields and existing contactPoints, outside address collection |

## ADR

`docs/knowledge/architecture/adr/0003-optional-address-matching.md` (proposed).
