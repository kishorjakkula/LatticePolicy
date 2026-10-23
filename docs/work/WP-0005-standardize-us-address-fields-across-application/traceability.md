# Traceability - WP-0005

Design: 02/03; test details: 06/09. Release/business validation require Gates C/D.

| Requirement | Design | Code | Tests | Release | Validation |
| --- | --- | --- | --- | --- | --- |
| REQ-1 | Embedded fields | AddressFields, existing editors | Labels/browser/axe/layout | Pending | Pending UAT |
| REQ-2 | Postal/rating separation | postalAddress.ts ratingZip; garaging editors | ZIP+4/non-US unit and browser draft | Pending | Pending UAT |
| REQ-3 | Lossless snapshots | Adapters, QuoteWizard, bind/document services | Customer/snapshot integration; document/interest tests | Pending | Pending UAT |
| REQ-4 | Honest range matching | address-check.service.ts, status UI | Outcome/malformed tests | Pending | Provider fitness pending |
| REQ-5 | Explicit review; invalidate stale results | AddressFields generation/identity guard | Stale check and unit preservation | Pending | Pending UAT |
| REQ-6 | Disabled/minimal/transient | Capabilities/routes/parser/idempotency | Tenant/pinned/minimal payload/replay tests | Pending | Carrier privacy pending |
| REQ-7 | Nonblocking failure/offline | Bounded transport, preserved drafts | Fetch/body deadline/failure/unsupported tests | Pending | Pending UAT |
| REQ-8 | Existing RBAC/RLS/rules | Routes; masked-identity preservation | Real RLS/contact-only API; full rules/browser regression | Pending | Pending UAT |
| REQ-9 | Automated/visual audit | New browser spec; existing screen audit | Final full 165; scoped axe/screenshots 1440/390 light/dark, nine repeated executions | Pending | Pending UAT |
| REQ-10 | Contact collection; single non-contact | ContactAddresses; existing call sites | Primary/remove/component/customer/snapshot/browser | Pending | Pending UAT |
| REQ-11 | Contact-level communication | ContactCommunication, existing contactPoints | Separate email/mobile; current/cleared recipient | Pending | Pending UAT |
