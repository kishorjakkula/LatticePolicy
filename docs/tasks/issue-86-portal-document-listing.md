# Task Note: Portal Document Listing

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/86
- Pull request:

## Summary

Added a customer portal endpoint that lists customer-safe generated policy
documents for a policy the authenticated customer is linked to. This is the
follow-up noted in `docs/tasks/policy-document-generation.md`: "Add a customer
portal document listing endpoint that filters on `metadata.customerSafe =
true`."

## Important Files

- `server/src/routes/customer-portal.routes.ts`: adds
  `GET /api/v1/customer-portal/policies/:policyId/documents`, reusing the same
  tenant + `policy_customer_links` scoping check as the existing
  `/policies/:policyId` route.
- `server/src/__tests__/customer-portal-security.integration.test.ts`: DB
  integration coverage for allowed, cross-customer-denied, and
  internal-document-excluded cases.

## Behavior Rules

- Only `documents` rows where `metadata.customerSafe = true` are returned.
- The response never includes the internal `uri` column; a `contentId`
  (document hash) stands in as the client-safe content identifier.
- The policy must be portal-visible (`Issued`/`Expired`/`Cancelled`) and linked
  to the authenticated customer via `policy_customer_links`, or the route
  returns `404 POLICY_NOT_FOUND` (matches the existing policy detail route's
  behavior of not distinguishing "not found" from "not yours").
- Form entries inside a customer-safe packet are further filtered to
  `customerSafe !== false` so a mixed-visibility document doesn't leak
  internal-only form titles.

## Automated Tests

- Tests added or updated:
  - `server/src/__tests__/customer-portal-security.integration.test.ts`
    (new test: "lists only customer-safe policy documents scoped to the
    linked customer").
- Test layer used: DB-backed integration test (existing suite pattern).
- Why this layer is enough: the route's behavior is entirely about
  tenant/customer-link scoped SQL filtering and RBAC, which this suite already
  exercises end-to-end against a real Postgres instance.

## Validation

```bash
npm run build
npm run test
npm run test:integration
```

All three passed locally against the disposable Docker Postgres container
started by `scripts/test-integration.sh`.

## Follow-Ups Or Risks

- No portal UI list view was added in this change; only the API. A future
  frontend task can wire this into the customer portal UI using existing
  component patterns.
- Retrieval of actual document content/bytes is out of scope here and depends
  on issue #88 (real artifact rendering and storage adapters).
