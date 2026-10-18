# Automation tests — WP-0001

## Specs added or changed

No browser journeys change (no application UI). Automation for this change is
the delivery tooling suite `scripts/delivery/delivery.test.mjs` (26 tests) and
the CI steps that enforce the flow on every pull request:

- `ci.yml` — "Delivery flow contracts, adapters and work packages": tests,
  adapter drift check, work-package consistency.
- `delivery-checks.yml` — "Work package and gates": the pull request names a
  work package with its pre-merge gates cleared, or a quick change with a reason.

## Runs

- Local: `npm run test:delivery` (26 passed), `npm run agents:sync -- --check`,
  `npm run delivery:check`, PR check against the PR description.
- CI on the first commit: all 10 checks passed, including "Work package and gates".
  The final revision runs the same checks on push.

## Environment-only failures

None.
