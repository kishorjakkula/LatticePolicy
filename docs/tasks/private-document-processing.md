# Private Document Processing And Independent Extraction Profiles

Historical first-slice note. For later learning/evaluation/training adapter,
default-disabled email, intake fixes and signed deployment hardening, see
`document-learning-completion.md` and `docs/DOCUMENT_LEARNING.md`.

## Summary

Separate inference from LatticePolicy using a carrier-owned document service
and self-hosted OpenAI-compatible model server. Keep schema mapping, review,
and business writes in the application. Add independent, immutable extraction
profile releases for new examples; do not automatically train on uploads.

## Files And Contracts

- `services/document-processor/`: standalone Node HTTP service, local OCR,
  private DNS-pinned model client, profile management CLI and Node tests.
- `server/src/lib/intake/extractors.ts`: private adapter, generic-to-submission
  mapping, OCR page evidence checks, private-by-default provider selection.
- `server/src/lib/intake/private-client.ts`: bounded authenticated private RPC.
- `server/src/services/submission-intake.service.ts`: model/profile provenance.
- `deploy/document-processing/`: isolated model/processor compose stack and
  overlays for local and published carrier stacks.
- `docs/PRIVATE_DOCUMENT_PROCESSING.md`: contract, deployment and release guide.

## Invariants

- No policy database access in the processor; extraction never creates business
  records. Existing tenant-scoped review/approval gates stay in place.
- No external fallback, redirected uploads, document-content logs, automatic
  dataset collection, or online model downloads in the isolated deployment.
- Profile id/version/model are recorded for each successful read.
- Each carrier gets a separate stack, token, network, and profile directory.
- Publishing examples is not fine-tuning. Actual weight training is a separate,
  explicitly authorized offline process, not implemented by this change.

## Tests

Node tests exercise real local HTTP transport with a fake model, auth, request
validation, concurrency, private IP and metadata rejection, redirect rejection,
body timeouts/size limits, profile immutability/activation/rollback, malformed
model output, OCR subprocess adapters and temporary file cleanup. Vitest covers
submission mapping, provenance, OCR evidence verification, private defaults,
configuration failure, and application RPC rejection/deadlines.

## Validation

- `npm run test:document-processor`: 10 passed; real OCR test intentionally
  skipped outside the OCR image. Profile activation was also verified on the
  same processor instance without a restart.
- Real OCR smoke test in the built image with `--network none`, read-only
  filesystem, bounded tmpfs/memory: passed for both PDF text and a raster scan.
- Full server suite with coverage: 566 passed; frontend: 224 passed;
  shared rules: 26 passed. Existing coverage thresholds passed unchanged.
- Full fresh-Postgres integration suite with `TENANT_RLS_ENFORCED=1`:
  137 passed, including private provenance and no business writes before review.
- `npm run build`, `npm run typecheck`, `npm run check:architecture`:
  passed. Server rebuilt after strict parser/integration-test changes.
- Carrier recovery/pilot tests: 12 passed. Standalone processor compose and
  both application overlays passed `docker compose config --quiet` with
  synthetic configuration values.
- Processor image build passed. A disposable `internal: true` Docker network
  denied public HTTPS egress. Disposable DB/network were removed; existing
  local demo and pilot containers were not changed.

No real carrier data was used. Live model inference/accuracy remains unverified:
tests use a fake local model, and no weights were downloaded or trained.

## Limitations

No actual fine-tuning executor, ingestion inbox connector, universal file-type
support, or certified model accuracy. Existing Word/Excel/email parsing remains
in the application; the generic service accepts their text and handles PDF/image
OCR itself. Existing intake review findings about ZIP expansion, manual failure
recovery, quote retry exhaustion, and scheduling durability are separate follow-ups.
The isolated compose stack is not a complete AWS/Azure infrastructure deployment.
