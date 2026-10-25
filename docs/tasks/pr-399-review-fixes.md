# PR 399 Review Fixes

Work package: WP-0010. User requested review, fixes and merge of PR #399.
This isolated checkout does not include the unrelated uncommitted AI work.

## Confirmed Issues

- The current Dependency Audit failed on body-parser, fast-uri, undici,
  nodemailer and Puppeteer dependencies. No allowlist expansion is used.
- Direct BOP endorsements, renewals and rewrites did not enforce the same
  carrier/company/agency/producer/appointment checks as quote and bind.

## Changes

Pinned Puppeteer 25.16.0 (Apache-2.0, Node >=22.12), Nodemailer 10.2.1 (MIT-0,
Node >=20) and root overrides for body-parser 2.4.0 (MIT), fast-uri 3.1.9
(BSD-3-Clause), undici 7.30.1 (MIT). The supported Node runtime meets these
requirements. The root workspace lockfile captures resolved dependencies;
server override metadata remains consistent. No external service is added.

Direct servicing now invokes the authoritative distribution guard inside the
existing tenant transaction, retaining locks through commit. Renewal/rewrite
check the new term date; endorsement checks its transaction effective date,
not the old policy inception. Existing non-BOP behavior is unchanged.
Three real-PostgreSQL regression cases expire the agency appointment after
inception and prove later direct operations are refused without a new version.
Missing authenticated identity now fails at distribution authorization before
the later underwriting-authority gate.

## Verification

Final local verification: zero vulnerabilities; frontend/server builds and
typecheck passed; 1,301 server tests / 108 files, 625 frontend tests / 96 files,
380 integration tests / 47 files on a fresh disposable PostgreSQL database
with tenant RLS, and 2 BOP browser tests (1440px/390px) passed. The updated
Puppeteer also passed 28 focused PDF/document tests with supported Chrome
156.0.8078.47. Screenshots were visually inspected; module/delivery checks pass.
Independent re-review cleared M1-M4, including actual database forgery and
cross-product bypass probes. Test-only containers created for this review were
removed. First concurrent runs timed out under resource pressure, and one
rerun caught a minimal test fixture missing the newly required configuration
flag; both were corrected/rechecked without relaxing timeouts or assertions.

Additional fixes reject unoffered deductibles, malformed or empty package
configuration, and cross-product servicing overrides. Trusted server-copied
new-term benefits refresh against the new edition while old history remains
immutable; client-forged terms are still rejected. CI on the pushed head is a
separate required check, not inferred from local results.

No primary/demo/pilot database was changed. No merge, production deployment,
code-owner approval or administrative override has been performed.
