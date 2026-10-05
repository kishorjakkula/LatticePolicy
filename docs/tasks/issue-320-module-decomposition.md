# Issue 320: Policy-Critical Module Decomposition

## Goal

Reduce coupling in policy-critical hotspots without changing API or workflow behavior. Route and component entry points remain stable while reusable business capabilities move behind explicit module contracts.

## Ownership Boundaries

- `server/src/services/lifecycle/lifecycle-support.ts` owns transaction numbering, policy row normalization, transition assertions, simple premiums, and risk summaries.
- `server/src/services/customers/customer-matching.ts` owns customer identity normalization, similarity, and search scoring.
- `server/src/services/onboarding/onboarding-normalization.ts` owns canonical onboarding payload coercion and validation primitives.
- `frontend/src/features/wizard/riskDefaults.ts` owns product risk defaults and personal-auto risk validation.

The existing lifecycle service, customer and onboarding routers, and `QuoteWizard` continue to own orchestration only and import these leaf capabilities. Extracted modules do not import their orchestrators, keeping dependency direction one-way.

## Characterization

Each boundary has focused tests that pin its public behavior. Existing server, integration, frontend, and browser suites protect the unchanged route and workflow contracts.
