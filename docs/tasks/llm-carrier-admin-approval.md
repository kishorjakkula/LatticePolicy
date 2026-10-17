# Carrier Technical-Admin LLM Release Approval

Historical implementation note. Later changes supersede the email/training/
receipt limitations below: see `document-learning-completion.md`,
`llm-email-opt-in.md`, `llm-authorization-renewal.md`, and
`document-deployment-hardening.md` for current behavior and validation.

## Summary

Add tenant-scoped candidate registration, automatic SMTP notices to configured
carrier technical administrators, lower-environment test evidence/attestation,
and separate production authorization. Signed receipts gate activation and
every inference in validation/production. Extend the private-document-engine
work without connecting to real SMTP, training on documents, or deploying models.

## Important Files

- `server/migrations/063_llm_release_governance.sql`: RLS tables, roles and permissions.
- `server/src/services/llm-release.service.ts`: registration, immutable artifacts,
  live-role checks, quality gates, transitions, signing, audit and transactional email outbox.
- `server/src/services/llm-release-email.service.ts`, `server/src/asyncMessageWorker.ts`:
  dedicated TLS SMTP delivery, retries/failure/suppression; no stdout/webhook fallback.
- `server/src/routes/llm-releases.routes.ts`: authenticated administration API.
- `frontend/src/features/admin/LlmReleasesPage.tsx`: technical-admin inbox,
  contact configuration, test results, separate production attestation, receipt downloads.
- `services/document-processor/release-authorization.mjs`: independent signature
  verification and carrier/environment/profile/model binding.
- `docs/LLM_RELEASE_GOVERNANCE.md`: configuration, API, rollout and trust boundaries.

## Behavior Rules

- Candidate registration requires a currently assigned automation role. Readiness
  mail is committed with the candidate; repeat registration cannot duplicate it.
- Only an active, currently assigned `carrier_technical_admin` may review;
  general admin, stale JWT grants, and candidate-maker approval are insufficient.
- Passed lower-environment testing against the exact candidate digest is required
  before production authorization. Failed/rejected candidates cannot progress.
- Approval grants are not deployment-success records. Deployment remains a
  separate carrier-controlled operation using verified, immutable model artifacts.
- No document content is emailed or logged. SMTP success means relay acceptance,
  not inbox/read confirmation; delivery is at least once.
- Unmanaged development mode is synthetic-only. Protect production configuration
  and the trusted public key so a pipeline cannot disable signature verification.

## Automated Tests

Node tests cover signed carrier/environment/artifact binding and runtime denial
for unsigned/edited profiles. Server unit/DB tests cover evaluation gates, live
roles/revocation, tenant isolation, transitions, signatures, email deduplication,
delivery/retry/suppression and TLS settings. Frontend and synthetic Playwright
tests cover lower-test and production attestations, shared radios, receipt
download and desktop/mobile layouts. The new screen is included in the UI audit.

## Validation

- Full server/frontend coverage runs passed: 572 server and 228 frontend tests;
  existing coverage thresholds passed unchanged. Shared rules: 26 passed.
- Independent processor: 13 passed, with its real OCR test opt-in outside the image.
- Full fresh-Postgres integration suite with RLS enforced: 143 passed in 33 files.
  The governance file was rerun after adding isolated fixture cleanup: 6 passed.
- Synthetic browser workflow: 2 passed at 1440px and 390px, including shared radio
  audit, separate production attestation and authorization download. Screenshots
  were inspected and the pass/fail group widened to avoid wrapping.
- Build, typecheck, module-boundary check, Docker image build, and standalone/local/
  carrier compose configuration checks passed. Security audit: no unapproved
  advisories; existing approved Puppeteer/extract-zip advisories remain.
- Offline Docker smoke: real PDF/raster OCR and signature/runtime-gate checks passed.
  CI now builds the processor image and runs these same offline smoke tests.

The initial full DB run found an upgrade-test assertion pinned to migration 062;
updated it to include governance and verify the governance table while allowing
future migrations. No real email delivery, live model inference, training, or
cloud rollout was performed. Existing demo/pilot containers were not modified.

## Follow-Ups And Risks

- Configure real carrier contacts, trusted CI authentication, SMTP/TLS, secret
  manager signing keys, environment isolation and deployment pipelines.
- Training/fine-tuning and independent report recomputation are not implemented.
  Evaluation metrics are trusted CI assertions; lower test evidence is an admin
  attestation, not proof that a remote test runner executed.
- Processor verifies the configured model digest, not a remote server's weight
  bytes. The deployment system must verify and mount immutable weights.
- Receipts do not expire or support online revocation. Role revocation stops new
  approvals/mail, not already-issued approvals; emergency invalidation is a
  carrier deployment/key-control operation.
- Existing unrelated intake hardening findings remain in the private processing task note.
