# Task Note: Document Artifact Storage And Retrieval

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/88
- Pull request:

## Summary

Generated policy packets now render a real HTML artifact and store it through
a pluggable storage adapter instead of only carrying a `generated://` metadata
URI. Added an internal/customer document listing endpoint and a
tenant/permission/customer-safe-gated retrieval endpoint that serves the
stored artifact bytes.

## Important Files

- `server/src/services/document-storage.service.ts`: HTML rendering, the
  `DocumentStorageAdapter` interface, and a local-filesystem adapter used for
  local development/testing.
- `server/src/services/document-generation.service.ts`: `buildPolicyDocumentPacket`
  now renders and stores each generated document's content and records
  `metadata.artifact` (storageUri, contentType, byteSize, storageAdapter,
  renderedAt); the top-level `hash` column now reflects the real content hash.
- `server/src/routes/policies.routes.ts`: adds `GET /policies/:id/documents`
  (list) and `GET /policies/:id/documents/:documentId/content` (retrieve),
  both permission-gated (`page.policy.view` or `customer.portal.read`) with an
  explicit customer-safe check for non-internal callers.
- `server/src/services/__tests__/document-storage.service.test.ts`: unit
  coverage for rendering, hashing, and the local storage adapter.
- `server/src/__tests__/document-artifact-storage.integration.test.ts`: DB
  integration coverage for retrieval authorization and hash correctness.

## Behavior Rules

- `DocumentStorageAdapter` is swappable via `setDocumentStorageAdapter`; a
  future production deployment can implement the same interface against
  object storage (S3/GCS/Azure Blob) without changing callers. The default
  local-filesystem adapter writes under `DOCUMENT_STORAGE_DIR` (defaults to a
  temp directory) and is not suitable for multi-node production use.
- `documents.hash` is the sha256 of the actual rendered content bytes, not a
  metadata fingerprint. Retrieval callers can verify content integrity against
  it.
- Internal callers (`page.policy.view`) may list/retrieve any document within
  tenant/policy scope. Customer-portal callers (`customer.portal.read`) may
  only list/retrieve documents where `metadata.customerSafe === true` on a
  policy linked to their own customer record via `policy_customer_links`.
- Forms are matched by tenant/product/transaction type only (existing
  behavior from issue #47); packets stay customer-safe only when every
  included form is customer-safe.

## Automated Tests

- Tests added or updated:
  - `server/src/services/__tests__/document-storage.service.test.ts`
  - `server/src/__tests__/document-artifact-storage.integration.test.ts`
- Test layer used: server unit tests plus a real DB-backed integration test
  (ran against a local disposable Postgres 15 container).
- Why this layer is enough: the storage adapter's hashing/content behavior is
  pure and DB-independent; the retrieval authorization rules (tenant scope,
  customer-policy link, customer-safe filtering) depend on real RLS/tenant
  behavior and are only meaningfully verified against a real database.

## Validation

```bash
npm run build
npm run test
npm run typecheck
npm run test:integration   # ran locally against a disposable Postgres 15 container
```

All four passed locally, including the full existing integration suite (6
files / 15 tests) with no regressions.

## Follow-Ups Or Risks

- The local-filesystem adapter is development/testing only; a production
  deployment needs a real object-storage adapter implementing
  `DocumentStorageAdapter`.
- Rendering is simple HTML, not PDF. A richer renderer can replace
  `renderPolicyPacketHtml` without changing the storage boundary.
- Servicing-transaction document hooks (issue #89) and the customer-portal-
  specific document listing surface (issue #86) are separate, related issues
  handled independently.
