# WP-0004 workflow regression follow-up

Work package: `WP-0004`. Requirements and design Gates A/B were approved;
merge and business sign-off remain human gates. This note describes follow-up
changes in the current working tree, not a deployed release.

## Behavior and ownership

- Work badges use query keys containing tenant and user identity. A principal
  switch or logout must not show the previous principal's totals. Requests
  still require page permissions; backend authorization remains authoritative.
- Confirmation/reason dialogs ignore Escape while a request is pending, guard
  duplicate submission synchronously, retain focus when all controls are
  disabled, and retain keyboard trapping after failure. Reason validation
  returns focus to the field. The calling screen closes a successful dialog.
- Shared pagination keeps numbered desktop controls. On phones it uses one
  previous/current/next row with an expandable page-size picker. Search
  filters start collapsed on phones and preserve mounted form values.
- Feature/component colors use CSS custom properties. The source test parses
  TypeScript/JSX with Babel and CSS with PostCSS, ignores comments/test files,
  and permits color literals in token definitions only. Global theme palettes
  remain in `frontend/src/styles.css`; this guard is not a contrast evaluator.
- Muted, status, and dark primary tokens were adjusted for readability. Primary
  action and active-page text must use `--ps-on-primary` in both normal and
  hover states. Browser contrast validation is separately required.

## Automated coverage

- `components/__tests__/useWorkCounts.test.tsx`: tenant and user switching in
  the same query client, logout, permissions, errors and visibility polling.
- `components/__tests__/Dialog.test.tsx`: required/optional/secret inputs,
  focus restoration, pending Escape, duplicate submit, retry and focus trapping.
- `components/__tests__/AppNav.test.tsx`: authenticated role fixtures and
  authorized navigation/counts.
- `__tests__/color-tokens.test.ts`: parser boundaries and production source audit.
- `e2e/ui-flow-accessibility.spec.ts`: 390px overflow/screenshots, collapsed
  filters, page-size interaction and light/dark accessibility checks, plus
  desktop primary/active-page contrast.
- `e2e/ui-section-standards.spec.ts`: administration home added to the registry.

## Verification status

Focused parent-owned dialog/navigation/cache tests passed (37 tests). The
initial token/pagination run passed 14 tests after replacing the unavailable
TypeScript 7 compiler API with the installed Babel parser API. These counts
precede the final independent-review fixes and do not replace the final suite.

A broad concurrent frontend/server/Docker run hit widespread timeouts and
exposed a pagination test-environment compatibility issue (an undefined media
query mock), now fixed with optional media-query handling. Full suites are
being rerun with bounded workers. Do not report that failed run as passing.

Independent read-only review found focus escape after a failed confirmation
and forced-white text on dark primary/active-page buttons. Both were patched;
the regression tests and browser checks must be rerun against the final code.

## Remaining work

Current handoff (2026-10-21): integrated the separate slices and OpenAPI;
frontend 572 passed, backend 863 passed, PostgreSQL 296 passed, typechecks passed,
audit policy passed with existing allowlisted advisories. Final isolated browser
run: 158 passed, one authority fixture failed, two serial authority cases did
not run. See work-package `06-unit-tests.md` and `09-automation-tests.md`.

Independent review found a remaining high/major issue: changing exposure while
keeping the same reason/date can reuse an unconsumed approval. The narrow
reason/date/consumption fix is not an immutable proposal fingerprint. Gate B
was reopened; Kishor Jakkula approved the database, UI and test extension on
2026-10-21 with "approved." Proposal-bound evidence and the authority fixture
correction are now implemented; final regression passed (frontend 586, server
942, fresh PostgreSQL 298, isolated browser 161), and independent re-review
closed its findings. See `wp-0004-referral-proposal-binding.md`. Do not mark WP-0004
complete, merge, or overwrite demo/pilot stacks before the required gates.
