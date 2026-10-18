# Unit and integration tests — WP-0001

## Tests added

`scripts/delivery/delivery.test.mjs` (27 tests, Node test runner; regressions added for every review finding and for CodeQL alert 36), run in CI
by the "Delivery flow contracts, adapters and work packages" step.

## Results

`npm run test:delivery` — 27 passed, 0 failed.

## Requirement coverage

| Requirement | Tests |
| --- | --- |
| REQ-1–3 | contract headers and order; tracks and gates; standard package to release; folder names |
| REQ-4 | adapters generated and drift detected; committed adapters match |
| REQ-5 | knowledge report; real knowledge metadata |
| Human control | gate approvals and waivers; returns, reopened approvals, needs-human and resolve; CI package checks; pull request checks including the unedited template; open severe findings block review completion |
