# WP-0004 Phase 3: Dashboard (REQ-11)

## Scope and approval

Continues the existing WP-0004 delivery flow, with Gates A/B already approved.
Read AGENTS, project context, test/process guidance and the approved requirements,
design, UI and test handoffs. `npm run flow -- next WP-0004` identifies the
developer stage. This contribution intentionally does not change shared delivery
status/handoffs; the coordinating parent owns those and the later review gates.
No commit, push, merge, deployment, server, endpoint, package, lockfile, shared
hook or global-style changes were made by this contribution.

## Files

- `frontend/src/features/dashboard/DashboardPage.tsx`: My work first; permissions,
  shared count-cache observations/refresh, explicit loading/error/stale states,
  refresh time, chart baseline and month labels, model-only future forecasts.
- `frontend/src/features/dashboard/dashboardModel.ts`: zero-based bar widths,
  expiration-window filter, keyed actual/forecast months, complete-page loading.
- `frontend/src/features/dashboard/DashboardWorkList.tsx`: filtered submission
  and renewal lists with links to existing detail pages.
- `frontend/src/features/dashboard/dashboard.css`: dashboard-scoped, token-only
  styles, responsive grids and bounded, keyboard-scrollable model tables.
- `frontend/src/features/dashboard/__tests__/DashboardPage.test.tsx`: component
  regressions, using an authenticated store identity matching the mocked context.
- `frontend/src/features/dashboard/__tests__/dashboardModel.test.ts`: pure-model
  boundary, year-rollover, missing/malformed and incomplete-pagination tests.
- `frontend/src/features/dashboard/__tests__/browser-smoke.mjs`: read-only
  Playwright/axe harness with intercepted synthetic API fixtures.

## Behavior and integration decisions

- Open quotes match the existing `/v1/quotes` listing (which excludes Converted
  and Issued); count and `/search?mode=quotes` use the same listing convention.
- Open referrals and READY_FOR_REVIEW submissions reuse `useWorkCounts` without
  editing it. Observers and explicit refresh use its current tenant/user-scoped
  keys: `[resource, tenant, user, 'count', status]`. Requests require both page
  access and read permission. Counts are authorized visible work, not invented
  assignee-specific totals; no new ownership filter is claimed.
- Renewals due means issued/in-force policy terms expiring today through day 30
  inclusive, in expiration order. Cancelled, draft, bound, expired and missing-date
  terms are excluded. This is a due-work indicator, not a new renewal eligibility
  rule or an authorization to execute renewal.
- The submission inbox does not consume URL status and search has no expiration
  filter. Therefore `/dashboard?work=submissions` and `?work=renewals` provide
  working, dashboard-owned filtered lists rather than unsupported destination
  parameters. No additional endpoint or out-of-scope edit was necessary.
- Policy/quote aggregates require complete paginated responses. Missing totals,
  changed totals, premature empty pages and the 25,000-row safety limit fail
  explicitly rather than displaying a partial total as complete. The existing
  customer search is capped at 500; at the cap it displays `500+`, with active
  customers explicitly described as belonging to the loaded set.
- Missing/failed work counts never become zero. Retained portfolio data after
  failure is explicitly stale; ages over one minute also prompt refresh.
  Last refreshed is the oldest successful fetch time among required datasets,
  formatted with tenant preferences and `includeTime: true`; incomplete loads
  and failed refreshes are labelled rather than claiming fresh data.
- Forecast rows come only from the enabled existing model, keyed by valid
  `YYYY-MM`, strictly after the current local month. Actuals stop at the current
  month. Missing values stay `-`, not fabricated zero; disabled/failed AI has no
  replacement prediction. Model generation time is shown when supplied.
- Portfolio starts collapsed at phone widths. Model tables use a local table
  class so the app's generic mobile-card transformation cannot obscure values.
  Chart grid ticks are unique; month labels are spaced and edge-aligned.

## Verification (2026-10-20, final shared checkout)

- `npm run typecheck --workspace=frontend`: passed.
- `npm run test --workspace=frontend -- src/features/dashboard
  src/components/__tests__/useWorkCounts.test.tsx
  src/features/search/__tests__/SearchPage.test.tsx
  src/__tests__/color-tokens.test.ts src/__tests__/native-dialogs.test.ts
  src/__tests__/radio-standard.test.ts`: an earlier four-file dashboard/hook/search
  run passed 36/36 before the final three component cases were added. The later
  seven-file run passed 51/52; SearchPage's existing dates-header case timed out
  while the full suites and Docker build were running concurrently. A serial
  retry (`--maxWorkers=1`) also suffered broad SearchPage timeouts and was
  interrupted to reduce load. The next dashboard-only serial run passed 15/16;
  its first component case hit the unchanged 5-second test timeout. No assertion
  or timeout was weakened for machine saturation.
- Final focused rerun, after completing authenticated fixtures, cache-key
  alignment and full media-query listener mocks:
  `/Users/srividyajakkula/.nvm/versions/node/v24.21.0/bin/node
  ../node_modules/vitest/vitest.mjs run src/features/dashboard --maxWorkers=1`
  from `frontend/`: **16/16 passed, 2 files**, 12.86 seconds.
- Separate color-token/native-dialog/radio standards run: 13/13 passed.
- `node frontend/src/features/dashboard/__tests__/browser-smoke.mjs`: passed
  against a temporary source Vite server at `http://127.0.0.1:5191` configured
  with `VITE_USE_MOCK=0 VITE_API_BASE_URL=http://localhost:3300`. The harness
  intercepts that API origin; it never reads/writes the running demo database.
  At 1440px and 390px, document width equals viewport width, chart labels and
  table rows do not overlap, zero Draft fill measures 0px, filtered lists link
  to actual detail routes, refresh includes time, no page exceptions, and axe
  WCAG A/AA scan of the dashboard reports zero violations. Expanded screenshots
  were inspected at `/tmp/wp-0004-dashboard-1440.png` and
  `/tmp/wp-0004-dashboard-390.png`.
  The harness passed again after the final scoped unframed-section style change.
  The preview server remains available on port 5191.
- Scoped `rg` scan for hex/rgb literals in dashboard TSX/CSS: no matches.
- `git diff --check -- frontend/src/features/dashboard
  docs/tasks/wp-0004-phase3-dashboard.md`: passed.

## Remaining parent work / limits

- Full-stack/isolated E2E, independent code review, security/business validation
  and Gates C/D are not claimed by this scoped contribution.
- Keep shared hook tenant/user key changes coordinated with its dashboard
  observers. The hook itself remains parent-owned and unmodified here.
- Large portfolios require all existing list pages; above the safety limit,
  counts are explicitly unavailable. A future server aggregate would improve
  scale but is not required or added here.
- Parent global semantic-token definitions remain parent-owned. This dashboard
  uses existing tokens plus the parent-provided `--ps-success` semantic token.
