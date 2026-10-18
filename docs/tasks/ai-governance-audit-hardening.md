# AI governance hardening and AI/person audit segregation

## Why

The governance review of the private LLM release process found gaps that let a
single person or a single compromised component bypass the controls: the
signing key lived in the API, one technical admin could validate and approve,
admins could grant themselves the approval role, the processor disabled its
checks when `RELEASE_ENVIRONMENT` was unset, there was no revoke action, the
audit log could be edited, evaluation metrics were self-reported, and the
automation identity was a password session. The product owner also asked for
strong audit logs that separate what the AI did from what people did.

## What changed

- **Migration `064_ai_governance_audit.sql`**
  - `llm_release_audit` and `submission_events` are append-only (trigger) and
    hash-chained per carrier (`chain_seq`, `prev_hash`, `entry_hash`, existing
    rows backfilled). `audit_chain_first_break(table, tenant)` verifies a chain.
    Deletion only for carrier offboarding with `app.audit_purge`.
  - Actor typing and segregation CHECKs: release audit `actor_type`
    user/automation/system, roles at the time, subject account, request id;
    automation may only `CANDIDATE_READY`; approvals are `user` only. Intake AI
    may only `drafted`/`reading_failed`; confirmations, edits, customer choice,
    approval and decline are `user` only.
  - `llm_releases`: `REVOKED` status, stored evaluation/validation reports,
    gate policy snapshot, revocation fields, four-eyes CHECK (NOT VALID for old
    rows).
  - `llm_release_policies` (carrier gates above a platform floor) and
    `llm_automation_credentials` (hashed, expiring, CIDR-limited).
  - `ai.audit.read` permission and AI Audit menu/page permissions.
- **Server**: `llm-release.service.ts` (report verification and metric
  recomputation, carrier gates, four-eyes, cooldown, revoke, signed revocation
  list, expiring receipts, actor-typed audit), `llm-release-signer.ts` (remote
  signer required in managed deployments, signature checked against the public
  key), `llm-automation-credentials.service.ts`,
  `llm-governance-roles.service.ts` (admin user routes),
  `ai-audit.service.ts` + `ai-audit.routes.ts` (unified trail, integrity,
  audited CSV export). Intake `drafted` events record model/profile/release.
- **Processor**: `RELEASE_ENVIRONMENT` required; signed revocation lists
  verified (`revokedReleaseIds`).
- **Release signer**: `services/release-signer` and `deploy/release-signer`
  (internal network, read-only key, hash-chained signature log, own checks).
- **Learning**: registration sends the evaluation report and requires an
  `lpa_` credential.
- **UI**: LLM Releases page (report upload with browser hashing, four-eyes
  guidance, revoke, expiry, approver status, production correction rate, gates,
  credentials, revocation list) and new **Administration > AI Audit** page.

## Rollout notes

- Managed carrier stacks must deploy the release signer and apply
  `deploy/release-signer/application.signer.yml`; remove
  `LLM_RELEASE_SIGNING_KEY` from the API.
- Issue a service credential for the training pipeline and set it as
  `LEARNING_API_TOKEN` before the next registration.
- Processors must set `RELEASE_ENVIRONMENT` explicitly (compose already does).
- Releases already validated and approved by the same person stay readable;
  new approvals need two technical admins.

## Verification

- `npm run test:document-processor`, `test:release-signer`,
  `test:document-learning`, `test:document-deployment`
- Server unit (665) and full integration suite on a fresh PostgreSQL (162)
- Frontend unit (253); Playwright `playwright.document-processing.config.ts`
  at 1440px and 390px
