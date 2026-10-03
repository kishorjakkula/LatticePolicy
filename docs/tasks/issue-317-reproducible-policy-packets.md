# Issue 317: Reproducible Transaction-Complete Policy Packets

## Outcome

Every policy lifecycle operation now uses the same packet guarantee. Bind,
issue, endorsement, cancellation, reinstatement, renewal, rewrite, and
non-renewal retain the exact form editions, policy-version identifier, canonical
input snapshot and digest, selected form snapshot and digest, and rendered
content hash.

Packet rendering uses the transaction's persisted processing timestamp instead
of wall-clock time. Rebuilding from the retained metadata therefore produces
the same bytes and SHA-256 hash. Generation verifies bytes after storage, while
content retrieval verifies them again and marks a failed integrity state when
they differ.

## Completion and Evidence

- Missing form codes required by effective-dated servicing compliance rules
  block the transaction with `DOCUMENT_PACKET_INCOMPLETE`.
- `documents.integrity_status` exposes `VERIFIED`, `UNVERIFIED`, or `FAILED`.
- Required delivery methods are retained as evidence entries and may be marked
  `Pending`, `Delivered`, or `Failed` with an evidence reference and actor.
- `POST /v1/policies/{id}/documents/{documentId}/regenerate` reproduces and
  verifies a retained packet.
- `PATCH /v1/policies/{id}/documents/{documentId}/delivery` records delivery
  evidence.

## Verification

- Unit tests cover deterministic hashes, required-form blocking, storage hash
  verification, and deterministic regeneration.
- Database integration tests cover real artifact generation, listing, download,
  regeneration, version/hash visibility, and delivery evidence updates.
- Full build, local tests, database integration tests, and GitHub checks run
  before merge.
