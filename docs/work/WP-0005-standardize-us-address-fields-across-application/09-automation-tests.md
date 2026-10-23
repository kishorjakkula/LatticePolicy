# Automation Tests - WP-0005

## Specs added or changed

`e2e/contact-addresses.spec.ts`: customer multiple-address save/reopen, primary,
units/ZIP+4, communication outside addresses, single vehicle garaging object,
full postal ZIP+4 versus five-digit rating projection. Embedded address widgets
are checked at 1440px/390px in light/dark mode with scoped WCAG 2 A/AA and 2.1 AA
axe checks, page/table bounds and screenshots. Existing wizard helpers accept
both legacy and structured address labels; no business assertion weakened.

## Runs

Fresh disposable browser database, isolated API 3302/UI 5175, PostgreSQL 15,
Redis 7, restricted tenant RLS enabled, cache enabled, inline intake extraction.
These are local host API/UI processes against isolated Docker dependencies,
not a rebuild of the existing demo Docker application.

- Full existing/new browser suite: 164 passed, 2 workers, 3.1 minutes.
- New scenarios initially passed 2/2 before the full run.
- Final three scenarios (including mocked matching/Keep/Apply): 9 passed over
  three repeats, 44 seconds, no retries. Includes row-hover contrast, table/page
  bounds and scoped axe/screenshots at 1440/390 in light/dark. No provider calls.
- Post-patch concurrent full browser/PostgreSQL attempt hit 60-second timeouts:
  301/302 integration cases passed; browser stopped at 66 passed/3 timed out/
  2 interrupted/94 not run. These are not green runs. Host had about 60 MB
  free memory and heavy compression/VM/browser activity. Heavy suites are being
  rerun sequentially on fresh databases, without increasing timeouts, adding
  retries or weakening assertions. Final results recorded separately below.
- Sequential fresh exact-name PostgreSQL rerun after the patch: 302 passed,
  43 files, 75 seconds. All tests retain their original timeout and assertions.
- Final sequential full browser rerun: 165 passed, one worker, 5.3 minutes,
  after all runtime/UI/lockfile changes. Fresh `lattice_policy_browser_verified`
  database and cleared dedicated test Redis; no competing integration suite,
  no retries or relaxed timeouts. This supersedes the earlier 164-case run and
  the incomplete concurrent attempt. Results: `test-results/results.json`;
  repeated focused screenshots: local-only `output/wp-0005-browser-final/`.
- Hosted CI on a58291d: security, delivery, DB integration, pilot and full Docker
  browser checks passed. The build job failed in frontend coverage because the
  new delayed-contact regression exceeded its 5-second test budget. Its setup
  unnecessarily navigated through unrelated rated-document screens. The test
  now loads the real saved quote directly at Insureds and scopes DOM queries;
  delayed response/close/edit/saved-draft assertions are unchanged. No timeout,
  retry, coverage threshold or runtime behavior changed. Independent review
  appended in 07a. Full local frontend coverage: 604 passed, all thresholds met
  (48.05% lines, 47.22% branches). Latest-head hosted CI must rerun before merge.
  Full local server coverage also passed all 977 tests and existing thresholds
  (40.37% lines, 32.28% branches); root typecheck passed after the test-only fix.
- Local Docker branch deployment explicitly requested later: 14/14 same-image
  browser checks passed (10/11). No formal stage deployment, carrier UAT or
  production/business sign-off claimed.

## Environment-only failures

Earlier runs were diagnostic, not final passing evidence:
- Reused integration fixtures produced a strict duplicate form selector;
  fresh browser-only database fixed isolation without weakening the selector.
- Cache off and API-only intake role caused health/extraction checks to fail;
  isolated Redis and inline extraction restored the intended E2E stack contract.
- Mid-run source reload disrupted a wizard state; stable-source full run passed.
- Customer address save exposed masked-DOB rewrite/validation behavior: fixed
  in product code, with encrypted-DOB and contact-only permission regressions.
- Scoped dark audit found Add Address contrast; scoped postal token styling
  fixed it. Visual review also caught mobile table minimum-width clipping;
  removed that minimum on mobile and added table-level bounds checks.
- Expanded matching-state coverage first attempted to check a visually clipped
  native checkbox directly; corrected the test to click its visible label,
  without force. Row hover revealed another real dark contrast issue; scoped
  hover tokens corrected it and the final repeat explicitly hovers before axe.

No retries or fixme/skips were added to hide these defects. The stage is not
marked complete until hosted CI/required security checks are available.
