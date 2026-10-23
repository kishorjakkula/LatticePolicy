# Final Scoped UI Review - WP-0005

Date: 2026-10-23. Independent reviewer session; working checkout at c55b6bd
with pending WP-0005 changes. No new actionable findings in this scope.

## Scope And Evidence

- Reviewed `address-fields.css`, `AddressFields.tsx`, the table markup in
  `ContactAddresses.tsx`, applicable global styles/mobile-table rules, and
  `e2e/contact-addresses.spec.ts`. R1-R6 were not reopened. R7 is already
  independently closed by Mill in `07-code-review.md`; this note supplements,
  rather than replaces, that review.
- Row text/surface and hover use scoped `--ps-text`, `--ps-surface` and
  `--ps-bg` tokens. Action links use the theme's primary token. These rules
  outrank the global table hover styles without changing unrelated tables.
  The mobile min-width reset applies below 600px; action groups retain wrapping.
- Independently ran ContactAddresses component tests: 1 file, 7 tests passed.
- Headless Chromium fixture using the actual global/component stylesheets
  verified row-hover colors, wrapping and page/table bounds at 1440/390 in
  light/dark themes. Hover backgrounds were rgb(247,248,252) light and
  rgb(9,18,36) dark; row text and action-link contrast assertions passed
  (at least 4.5:1). At 390px the table container measured 358/358 scroll/client
  pixels; document width was 390/390. This first fixture did not apply the
  runtime mobile-card class to the table itself.
- A corrected fixture with the mobile-card class and cell labels verified
  both light-theme widths, including block-row mode at 390px and the same
  non-overflowing bounds. Its subsequent dark-theme check timed out under
  concurrent load; this is not represented as a completed four-case run.
  An earlier fixture attempt also failed due to a reviewer selector error.
- Source-reviewed the browser helper's page AND table-container bounds checks,
  row hover before scoped axe, and visible mocked suggestion-panel coverage.
  Parent reports all three browser cases repeated three times passed in 44s;
  this reviewer did not rerun that suite or inspect its screenshots.

## Narrow Lockfile Review

Structured comparison against HEAD confirmed exactly one changed package:
`node_modules/ip-address`, 10.7.3 -> 10.7.4. Only `version`, registry tarball
`resolved`, and `integrity` changed (three added/removed lines). Root/frontend
manifests have no diff. The patch satisfies existing consumers' ranges
(`express-rate-limit`: ^10.2.0; `socks`: ^10.1.1), and its Node >=12 engine
requirement is unchanged. No actionable lockfile issue found.

This verifies patch scope/compatibility metadata, not advisory remediation:
no independent registry-integrity lookup, dependency audit, clean install or
full regression run was performed. Security disposition remains separate.

## Limits And Outcome

Clear for the additional scoped review, subject to the stated probe limits.
Fixtures are isolated CSS checks, not complete application journeys or an
accessibility certification. No live provider/customer calls, source changes,
gate changes, commits, merge or deployment were performed by this reviewer.
Only this new review document was written; `07-code-review.md` is untouched.

## Test-Only Parser Follow-Up

Source-reviewed `server/src/__tests__/address-parser.test.ts` against the
existing scoped parser and error handler in `server/src/app.ts`. No actionable
finding. Two parameterized tests produce six real createApp/Supertest cases:
canonical, trailing-slash and uppercase paths each receive malformed JSON
(400 INVALID_ADDRESS_INPUT) and syntactically valid JSON exceeding 4 KB
(413 PAYLOAD_TOO_LARGE). No authentication is supplied, so these assertions
exercise parsing before authentication rather than an authorized route mock.
Every case checks that the response text excludes the synthetic private marker
and the JSON body has no top-level stack property. These are useful regression
assertions, not proof against every possible nested diagnostic disclosure.

Runtime code is unchanged by this addition. Focused execution is pending in
the parent's session 29145; this reviewer did not poll that session or start a
competing run. Parent also reports fresh PostgreSQL 302 passed in 75s, while
the serial browser run remains in progress; neither is independently verified
here. No additional source or gate edits were made.

## Coverage-Time Test Setup Follow-Up

Independently reviewed the pending `companyChange.test.tsx` diff against
a58291d and traced the real quote-loading/contact-popup paths. No actionable
finding. `ratedQuote()` preserves the former default fixture; only the stale
popup test supplies progressStep 3. The application loads that saved quote
through its normal API mock and selects step 3 (Rated redirects only steps
4 and above), so this does not mock away the behavior under test.

The test still clicks the real Pat button, waits for the customer request,
closes the real dialog, edits the primary contact's unit, resolves the deferred
customer response, and checks both the closed dialog and retained unit in the
UI and saved primary-insured payload. Scoped Close/unit queries preserve those
assertions. Removing the unrelated Documents/rating navigation from this test
does not remove the existing company-change tests' rated-output checks; their
`openRatedQuote()` helper remains unchanged. No timeout increase or runtime
change is present in this diff.

This is source verification, not an independently reproduced coverage fix.
The parent reports a focused run was performed; full coverage is next. No
competing test run was started, and no claim is made that the hosted coverage
failure is resolved until that run completes. Local Docker results do not
establish coverage-test success. Only this review note was appended; no source
or gate changes, rebuild, merge or deployment was performed by this reviewer.
