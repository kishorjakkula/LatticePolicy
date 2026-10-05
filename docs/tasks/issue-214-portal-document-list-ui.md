# Task Note: Portal Document List UI

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/214
- Pull request:

## Summary

Added a "Documents" panel to the customer portal policy view, listing and
opening generated policy documents. Issue #86 added a portal-scoped listing
endpoint, and issue #88 later added a more general listing/retrieval pair
(`GET /policies/:id/documents` and `.../documents/:documentId/content`) that
already supports portal callers via the `customer.portal.read` permission and
returns a customer-safe-filtered projection. This change uses #88's endpoints
rather than #86's dedicated route, since #88 is the only one with a working
content-retrieval counterpart, giving the frontend one consistent contract
for both listing and downloading instead of mixing two.

## Important Files

- `frontend/src/api/policies.api.ts`: added `getPolicyDocuments(id)` calling
  `GET /v1/policies/:id/documents`.
- `frontend/src/api/client.ts`: re-exports `getPolicyDocuments`.
- `frontend/src/api/queryKeys.ts`: added `policies.documents(id)`.
- `frontend/src/api/hooks/policies.hooks.ts`: added `usePolicyDocuments(id)`.
- `frontend/src/features/customerPortal/PortalDocumentsPanel.tsx` (new):
  loading/error/empty/list states; "Open" action reuses the existing
  `api.downloadPolicyDocument` blob-open pattern from
  `TransactionAuditPanel.tsx` (issue #53).
- `frontend/src/features/customerPortal/CustomerPortalPage.tsx`: renders the
  panel below the policy summary section once a policy is selected.
- `frontend/src/features/customerPortal/__tests__/CustomerPortalPage.test.tsx`:
  updated the existing mock of `../../../api/hooks` to include
  `usePolicyDocuments`, since `CustomerPortalPage` now transitively renders a
  component that calls it — without this, the existing tests would crash on
  an unmocked hook.

## Behavior Rules

- Customer-safe filtering happens entirely server-side (issue #88's route
  only returns `metadata.customerSafe === true` documents to
  `customer.portal.read` callers). The panel does not re-filter or trust any
  client-side field to decide visibility — it renders whatever the API
  returns, because that is the actual security boundary.
- The document-open action opens the retrieved blob in a new tab via an
  object URL, matching the existing pattern used by the internal audit panel,
  rather than introducing a second download mechanism.

## Automated Tests

- Tests added or updated:
  - `frontend/src/features/customerPortal/__tests__/PortalDocumentsPanel.test.tsx`
    (new): loading, error, empty, successful list + open action, and a
    regression guard asserting internal-only fields (tenant id, storage URI)
    are never rendered even if a future backend regression sent them.
  - `frontend/src/features/customerPortal/__tests__/CustomerPortalPage.test.tsx`:
    added a default `usePolicyDocuments` mock so existing tests keep passing.
- Test layer used: frontend component tests (mocked hooks/API), consistent
  with how the rest of the customer portal is tested.
- Why this layer is enough: this is a UI aggregation of an already-tested
  backend endpoint (issue #88 has its own DB-backed integration coverage for
  the actual authorization/filtering logic); the frontend only needs to prove
  it renders the response correctly and never adds its own visibility logic.

## Validation

```bash
npm run build
npm run test --workspace=frontend
npm run typecheck
```

All three passed: 24 frontend test files / 106 tests, clean build, clean
typecheck.

## Follow-Ups Or Risks

- The dedicated `/customer-portal/policies/:policyId/documents` route from
  issue #86 is now unused by the frontend but still exists and is still
  tested; a future cleanup could consolidate or remove it if no other caller
  ever adopts it, but that is out of scope here per this repo's "keep changes
  focused" guidance.
