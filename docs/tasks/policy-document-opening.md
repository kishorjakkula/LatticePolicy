# Policy document labels and opening

## Problem

Bind and Issue each produce a packet for the same NB transaction. The document
list previously omitted the stage, making those different artifacts look like
duplicates. Rating worksheets held only JSON snapshots and had no downloadable
artifact. The local API stored artifacts in the container temporary directory,
so rebuilding a container broke old links. Opening a tab after an asynchronous
fetch could also trigger browser popup blocking.

## Fix

- Include transaction stage in document names; retain the separate legal packets.
- Persist worksheets as escaped HTML from their stored rating snapshots, with
  real content hashes, artifact metadata, and VERIFIED status. No current-rate
  recalculation is used. Transaction numbers are included in worksheet metadata.
- Lazily materialize legacy snapshot-only worksheets on authorized content reads.
- Recover missing packet/worksheet files only against the recorded content hash.
  Existing corrupt content still returns 409. Tenant/customer guards are retained.
- Local Compose mounts document storage on a named volume at
  `/var/lib/lattice-policy/documents`. Managed multi-node storage remains subject
  to the existing deployment storage contract.
- Reserve the document tab during the click, sever its opener, then navigate it
  to the downloaded blob. Close failed tabs and report blocked popups.

## Tests

`e2e/policy-documents.spec.ts` issues a policy, verifies distinct stage labels,
and clicks every Open button. It checks GET status, nonempty actual bytes,
PDF signatures or worksheet contents, and blob navigation or headless PDF downloads.
Document-storage unit coverage verifies worksheet escaping and retrieval.
PostgreSQL artifact integration coverage tests missing packet recovery,
corruption rejection, and legacy worksheet repair, plus customer access guards.
Frontend panel tests cover opening, download errors, and blocked tabs.

## Validation

- Isolated Playwright document regression: 1 passed.
- Server unit suite: 529 passed, including 9 document-storage tests.
- Frontend document panel tests: 7 passed.
- PostgreSQL document integration tests with tenant RLS enforced: 3 passed.
- Workspace typecheck and `git diff --check`: passed.
- The three documents reported in the local UI returned HTTP 200 with nonempty
  PDF/HTML content after recovery (42,434, 17,485, and 41,924 bytes).
