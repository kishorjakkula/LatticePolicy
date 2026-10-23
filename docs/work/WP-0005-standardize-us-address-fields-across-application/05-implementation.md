# Implementation - WP-0005

Branch: `latticepolicy/wp-0005-us-addresses`, from merged PR #394 main.
Task note: `docs/tasks/wp-0005-contact-addresses.md`.

## Changes

Shared typed postal fields, lossless legacy adapters and contact address lists
are embedded in customer, insured, additional-interest, wizard mailing/risk/
garaging and legacy quote editors. Contact email/mobile remain separate.
New contact address IDs use UUIDs; type, primary, dates and metadata survive.
Insured normalization retains the complete collection and primary projection.
Single risk/garaging values remain objects, not collections. Old dwelling free
text stays visible until explicitly replaced. Existing carrier validation is
not replaced. Optional intake unit mapping and document tokens preserve line2.

Address routes/service enforce edit permissions, tenant allowlist, fixed HTTPS
Census transport, deadlines/body/candidate limits, no redirects, no external
fallback and no logs of addresses/provider errors. Default disabled. Results
are transient/no-store and excluded from idempotency response persistence.
Only street/city/state/base ZIP sent, not units, email, phone, names or IDs.
House number is preserved rather than replaced by a TIGER range endpoint.
Matching never claims USPS certification or automatically mutates records.

No new runtime dependency or migration. Shared types remain type-only.
Email/mobile clarification implements approved contact ownership, not a new
communications delivery service. Real carrier privacy enablement is separate.

## Review Corrections

All findings in independent review 07 are resolved: check URL aliases bypass
idempotency storage; notification recipient follows edited/cleared primary
email; full postal ZIP+4 survives while rating uses base ZIP; late read-only
contact reads never overwrite current edits; bound interests retain line3,
county and non-US regions. Address-only customer PATCH preserves encrypted DOB
without disclosure. Contact-only users cannot change identity or entity type;
actual restricted-role API and encrypted-DOB regressions cover this behavior.
Scoped postal styles fix theme contrast/mobile table clipping, with axe and
page/table bounds checks. No global style redesign.

## Verification

Initial full frontend: 600 passed; backend: 960 passed. Later optional intake
unit mapping and stricter response parsing: 48 focused server tests passed.
Typecheck and explicit server build passed. Final combined database/browser,
review and test counts are recorded in subsequent handoffs, not assumed here.

Final local evidence: shared 221, frontend 604, server 977, fresh PostgreSQL 302,
full browser 165 passed; typecheck/build/architecture passed. See 06/09 for
commands, final reruns and repeated browser/visual evidence. Baseline moderate
ip-address advisory fixed by the targeted lockfile 10.7.3 -> 10.7.4 patch;
audit policy now passes (08). Hosted CI and Gates C/D
remain pending. No merge or Docker application deployment performed.
