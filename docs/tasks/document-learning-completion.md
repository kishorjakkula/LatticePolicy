# Controlled Document Learning And Recovery

## Summary

User requested completion of private document-learning work with test email
disabled by default. Independent work remains in the private-document-engine
worktree and is not deployed or committed by this task.

## Implemented Code

- `services/document-learning/{datasets,evaluate,pipeline,cli}.mjs`: reviewed
  carrier datasets, split-leakage checks, synthetic fixtures, profile learning,
  independently calculated held-out metrics, regression checks, private model
  calls, resumable runs, training exports and optional automatic registration.
- Optional offline weight trainer under `services/document-learning/training/`.
- Default-disabled email and approval-preserving notification suppression:
  `docs/tasks/llm-email-opt-in.md`.
- Intake archive/recovery/quote transaction fixes:
  `docs/tasks/intake-office-archive-limits.md` and
  `docs/tasks/intake-recovery-hardening.md`.
- Actual artifact deployment preflight, signed activation, expiry/revocation,
  synthetic smoke and guarded rollback:
  `docs/tasks/document-deployment-hardening.md`.
- Root scripts, CI and `docs/DOCUMENT_LEARNING.md` describe execution/boundaries.

## Rules

No automatic training on raw uploads, model predictions, unreviewed corrections,
or unconsented carrier documents. Reviewed feedback is supplied as a separate
approved dataset; this is not a live submission-database export or ingestion
daemon. No public model calls, model downloads, business writes, automatic
production promotion, or policy API signing key access from learning jobs.

Local registration consumes calculated reports, but the server trusts the
authorized evaluator's assertions. Protect evaluation artifacts and identities;
hashes are integrity references, not independent proof of model quality.

## Validation

Validation used Node 22, synthetic inputs and a disposable PostgreSQL 15
database with `TENANT_RLS_ENFORCED=1`:

- `npm run test:local`: 632 server, 241 frontend, 26 shared-package tests;
  processor suite 18 passed plus one opt-in OCR skip.
- `npm run test:document-learning`: 20 passed (including fixed trainer wrapper).
- `npm run test:document-training`: 26 standard-library Python tests passed.
- `npm run test:document-deployment`: 2 Compose-policy tests passed.
- Full `npm run test:integration --workspace=server`: 154 passed, 33 files.
- `playwright.document-processing.config.ts`: desktop/mobile workflow 2 passed
  with email disabled, no SMTP and synthetic intercepted API responses.
- Processor and independent learning images built. Real offline PDF/image OCR
  and signature enforcement: 6 passed under Docker `--network none`.
- Build, typecheck, module boundaries, unchanged coverage gates and diff checks
  passed. Dependency audit found no unapproved advisories; existing approved
  Puppeteer/extract-zip advisories remain.

The Node learning suite covers
privacy declarations, source leakage, held-out exclusion, exact values/evidence,
unknown outputs, missing facts/conflicts, cancellation, drift, immutable exports,
real loopback HTTP pipeline execution, registration and tampering denial.

## Environment-Dependent Work

Carrier selection of base model/license, hardware, representative consented
corpus, live model/GPU training, real SMTP (only when enabled), private AWS/Azure
infrastructure, and carrier acceptance remain unverified. No claim of universal
document parsing or production readiness is made. Email setup is not a blocker
for the default test workflow. A future PR/deployment must run the migration
and include all tests/docs in the reviewed branch.
