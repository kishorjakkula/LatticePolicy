# Active Work Handoff

Snapshot: 2026-10-17. This is a repository-readable continuation guide, not global
agent memory. Read `AGENTS.md`, this file, and the linked guides before editing.
Recheck Git and runtime state; recorded checks are historical, not a guarantee
that later changes still pass. Do not assume previous chat history is available.

## Find The Work First

- Repository: `kishorjakkula/LatticePolicy`.
- Implementation branch: `latticepolicy/private-document-engine`.
- Base HEAD at handoff: `28a43e1a8a92979e921c911493efa89fe4ae6543`.
- Implementation checkout on this machine:
  `/Users/srividyajakkula/.codex/worktrees/private-document-engine/LatticePolicy`.
- Primary checkout: `/Users/srividyajakkula/Documents/LatticePolicy`, on a
  different branch, `codex/carrier-branding`. It does NOT contain the new code.
- All private processing/governance/learning changes are currently uncommitted,
  including untracked directories. Merely checking out the branch elsewhere
  will NOT recover these files. Reuse the implementation checkout; do not
  reset, clean, archive or delete it. Review `git status --short --branch` and
  `git diff` there. `git diff` alone excludes the new untracked files.
- No commit, push, PR, merge, release or deployment was performed for this work.
  For another machine/fork, the full change set must first be reviewed and
  transferred through an authorized commit/PR, including tests and Markdown.
- This handoff request only added documentation/discovery links. It did not
  authorize a new deployment, remote Git action, or issue closure.

The primary checkout has pre-existing untracked `.claude/`, `output/`,
`outputs/`, `reports/`, `research_notes/`, `tmp/`, and an invoice-extraction
script. Preserve them and do not include them in the LLM change set.

## User Requirements And Decisions

1. Separate document intelligence from the policy application. Carrier documents
   must stay within carrier-owned processing; no automatic external AI fallback.
2. Use a model-independent inference contract. The current adapter uses a private
   OpenAI-compatible protocol, not a requirement to use OpenAI's hosted service.
3. Map source documents to carrier/product-configured submission fields with
   evidence and confidence; human submission approval still controls all
   customer/quote writes.
4. New layouts/examples can be independently versioned and evaluated. Profiles
   are inference-time examples, not model fine-tuning. New binary formats need
   parser adapters; universal format/language/handwriting support is not claimed.
5. Controlled learning uses reviewed synthetic or explicitly consented data.
   Never silently train on raw uploads, predictions or reviewer corrections.
   An approved dataset is supplied separately; no live feedback-export daemon
   or automatic submission-database harvesting was implemented.
6. Passing candidates require carrier technical-admin lower-environment testing
   and a separate production attestation. Automation cannot approve its own
   candidates. Signing private keys never belong in inference/training jobs.
7. Email is FEATURE-FLAGGED AND DISABLED BY DEFAULT. Only exact
   `LLM_EMAIL_ENABLED=true` enables it. Test registration/review needs no SMTP,
   email contact, or HTTPS email review URL while disabled. Queued mail is
   suppressed, not falsely reported sent. Enabled mail retains TLS and retries.
8. Support private AWS/Azure deployments, but actual cloud provisioning,
   credentials, hardware and real model selection were not supplied or executed.
9. Billing/financial ledger is handled in a separate application.
10. Every behavior change needs automation tests and AI-readable docs. For any
    future authorized commit, verify the requested `kishorjakkula` identity and
    correct verified email; do not invent an email or rewrite unrelated history.
11. Use project-related names such as `latticepolicy/` for new branches and
    project artifacts, not AI-tool branding. The implementation branch was
    renamed locally without changing commits or files. App-managed filesystem
    paths retain their existing names; do not rename managed directories.

## Implemented Areas And Reading Order

1. [Current completion/test summary](tasks/document-learning-completion.md).
2. [Private processing contract/deployment](PRIVATE_DOCUMENT_PROCESSING.md):
   `services/document-processor/`, `server/src/lib/intake/private-client.ts`,
   private extraction adapter, local OCR, DNS-pinned private calls, independent
   profile publication/activation and model/profile provenance.
3. [Learning workflow](DOCUMENT_LEARNING.md): `services/document-learning/`.
   Reviewed datasets, train/evaluation source separation, synthetic corpus,
   candidate examples, real held-out metric calculation, regression gates,
   resumable jobs, immutable training exports and optional automatic registration.
   The fixed Python wrapper strips unrelated API/signing credentials and adds
   a deadline. Optional actual LoRA code is in `training/train.py`; see that
   directory's README and standard-library tests. No ML runtime is bundled or
   certified, and no real weights were trained or converted for serving.
4. [Release governance](LLM_RELEASE_GOVERNANCE.md): migration
   `063_llm_release_governance.sql`, server routes/services and
   `/admin/llm-releases` frontend. Current DB roles are rechecked; general admin
   is not automatically technical admin. Candidate registration is immutable
   and idempotent. States: `READY_FOR_VALIDATION`, `IN_VALIDATION`, `VALIDATED`
   or `REJECTED`, then `PRODUCTION_AUTHORIZED`. This last state authorizes
   publication, not successful deployment. Receipt renewal is a guarded action.
5. [Deployment hardening](tasks/document-deployment-hardening.md): independent
   operator preflight/activation/rollback, actual local model-file hashing,
   signed carrier/environment/artifact binding, synthetic private smoke and
   metadata-only deployment records. Receipt lifetime defaults to seven days,
   configurable up to one year; current revocation file is read per inference.
   Role removal does not automatically populate that file. Renewal/revocation
   operations are carrier-controlled. A failed smoke may leave a profile active:
   quiesce traffic and use a verified rollback, never bypass signed activation.
6. [Email opt-in](tasks/llm-email-opt-in.md) and
   [authorization renewal](tasks/llm-authorization-renewal.md).
7. [Intake recovery](tasks/intake-recovery-hardening.md): quote retry exhaustion
   now throws/rolls back, failed reads support manual entry, enqueue failures
   become recoverable and stale reads can be restarted. Compensation is not an
   atomic external-queue outbox; process crashes still need stale-read recovery.
8. [Office archive limits](tasks/intake-office-archive-limits.md): bounded ZIP
   entry counts, uncompressed sizes, expansion, CRC and suspicious-container
   checks before Word/Excel parsing, with malicious/valid fixture tests.

Older `private-document-processing.md` and `llm-carrier-admin-approval.md` task
notes are historical first slices. Their superseded limitations are explicitly
marked; use the current guides above for actual behavior.

## Verified Checks

Last implementation verification used Node 22 and synthetic inputs:

| Check | Recorded Result |
| --- | --- |
| Server unit/API suite | 632 passed |
| Frontend component suite | 241 passed |
| Shared rules | 26 passed |
| Processor Node suite | 18 passed, 1 opt-in OCR skip |
| Learning/runner Node suite | 20 passed |
| Python trainer contracts, no ML dependencies | 26 passed |
| Compose release-policy contracts | 2 passed |
| Full fresh PostgreSQL integration, RLS enforced | 154 passed, 33 files |
| Synthetic desktop/mobile approval workflow | 2 passed, email disabled |
| Real offline PDF/image OCR + receipt enforcement | 6 passed in Docker |
| Learning tests inside offline, read-only Docker | 20 passed |
| Build, typecheck, architecture, coverage gates, diff checks | Passed |
| Dependency audit | No unapproved advisories; existing allowed Puppeteer/extract-zip advisories remain |

The full repository browser suite was NOT rerun in this task. The two browser
tests use synthetic intercepted responses, not a live carrier API. No real SMTP
delivery, model accuracy benchmark, GPU training, model conversion or cloud
deployment was verified. Hash checks cannot prove which weights a separate
model server loaded. Registration trusts the authorized evaluator's assertions;
human validation evidence is an attestation, not cryptographic execution proof.

## Continue And Validate

Use a supported Node runtime. This machine had Node 22 at
`/Users/srividyajakkula/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`;
check it still exists rather than assuming the host default Node is supported.
Preserve the existing PATH when prepending it. Run from the implementation root:

```bash
npm run test:local
npm run test:document-learning
npm run test:document-training
npm run test:document-deployment
npm run typecheck
npm run build
npm run check:architecture
npm run test:coverage
npm run security:audit
git diff --check
```

Use a NEW disposable PostgreSQL database for the full integration command:
`DATABASE_URL=... TENANT_RLS_ENFORCED=1 npm run test:integration --workspace=server`.
Never use the running demo/pilot DB; some fixtures are not rerun-idempotent.

Browser config: `playwright.document-processing.config.ts`; spec:
`e2e/llm-release-workflow.spec.ts`. Start a temporary frontend on port 5189
(or set `E2E_BASE_URL`) before running
`npx playwright test --config=playwright.document-processing.config.ts`.
The spec intercepts runtime-config and API responses, so it does not need SMTP,
real credentials or a live carrier API. Stop your temporary server afterward.

Local review images were built as `lattice-document-processor:local-review`
and `lattice-document-learning:local-review`; rebuild after edits. CI builds the
images and runs dedicated processor/learning/trainer/deployment checks in
addition to the existing application checks. Root workspace lockfile is canonical.

## Remaining Work And Operational State

- Review all tracked AND untracked changes; then obtain/confirm the intended
  commit/PR/publication action. No PR number or issue completion is asserted.
- Select an approved base model/license and hardware; provision a reviewed,
  hash-pinned Python/ML runtime for actual fine-tuning. Supply representative
  privacy-reviewed training/held-out carrier datasets.
- Validate real inference accuracy, OCR edge cases, omissions/conflicts,
  performance/concurrency, and security against carrier acceptance criteria.
- Fine-tuned adapters need engine-specific conversion/serving and a new held-out
  evaluation before registration. No automatic cross-engine conversion exists.
- Provision private lower/production environments, model stores, carrier-scoped
  networks, IAM/secrets, TLS, encryption, backups, retention and monitoring on
  AWS/Azure. Current kit is Compose/operator tooling, not complete cloud IaC.
- Apply migration 063 only through a reviewed deployment; assign explicit
  technical-admin/automation roles, configure signing/public keys, revocations,
  expiry/renewal operations and verified model mounts. Keep email OFF for tests.
- Test real SMTP only when explicitly enabled, then conduct carrier-admin UAT
  before any production publication. Full autonomous learning is not claimed.
- Temporary DB `lattice-learning-validation-db` was removed; temporary QA Vite
  server on 5189 was stopped. No task-related tests/builds were left running.
  Existing demo/pilot containers were not migrated, rebuilt, reset or stopped.

## Minimal Continuation Prompt

```text
Read AGENTS.md and docs/ACTIVE_WORK_HANDOFF.md. Verify the correct worktree and
preserve its uncommitted changes. Continue the private document-learning work
from the documented state, keep email disabled by default, and report which
remaining steps need environment configuration rather than claiming them done.
```
