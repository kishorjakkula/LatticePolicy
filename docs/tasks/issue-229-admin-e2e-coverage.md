# Issue 229: Admin E2E Coverage

## Summary

Playwright now covers the primary browser journey for reinsurance treaty creation, exposure filtering, bordereaux generation, customer data-import stage/validate/commit, and job-run visibility.

## Important Files

- `e2e/admin-workflows.spec.ts`: combined deterministic admin workflow coverage.
- `e2e/support/api.ts`: existing authentication and setup helpers reused without adding a new fixture pattern.

## Test Design

- Tests authenticate through the API and install the normal browser auth state.
- API calls are limited to prerequisite data setup when a workflow needs an issued policy or queued job.
- Each primary operation is performed through the UI and verified through user-visible results.
- Unique names, source systems, external IDs, and idempotency keys prevent collisions between parallel, local, and CI runs.

## Validation

- `npx playwright test e2e/admin-workflows.spec.ts`
- `npx playwright test`
- `npm test`
- `npm run build`
- `npm run typecheck`
- `npm run security:audit`

## Follow-Ups

- Add browser coverage for compliance and notification-template administration in separate focused issues.
