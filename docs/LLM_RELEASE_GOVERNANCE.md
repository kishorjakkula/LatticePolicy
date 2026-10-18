# Carrier Technical-Admin LLM Release Workflow

## Scope

An evaluated candidate is automatically registered by a restricted pipeline
identity. Registration atomically creates the release and its audit event.
Only with explicit `LLM_EMAIL_ENABLED=true` does it also create email
intents/outbox entries for the carrier's configured technical admins.
It does **not** authorize production. This is a release workflow, not an
implementation of automatic model training or cloud deployment.

```text
Authorized pipeline: evaluated candidate
    -> READY_FOR_VALIDATION + optional email (explicit opt-in)
Carrier technical admin: authorize lower-environment deployment
    -> IN_VALIDATION + signed validation authorization
Carrier technical admin A: test exact artifacts, upload the test report, attest
    -> VALIDATED (or REJECTED)
Carrier technical admin B (never A, never the registering identity):
authorize production publication
    -> PRODUCTION_AUTHORIZED + signed, expiring production authorization
Any current technical admin: revoke at any time
    -> REVOKED + included in the signed revocation list
Deployment pipeline/operator: verify artifacts and authorization, then activate
    -> actual deployment (separate from authorization status)
```

The notification email contains the release label and authenticated review
link only, not uploaded documents, extracted values, training examples, model
output, or an approval token. Opening an email never approves anything.

## Roles And Setup

- Assign `carrier_technical_admin` to the carrier's actual technical
  administrators through the existing Users/Security administration.
  No user receives it automatically. A general `admin` can see releases but
  cannot approve without this explicit, current database role.
- Assign `llm_release_automation` to the authorized candidate-registration
  identity. It can register/read releases but cannot authorize validation or
  production. In managed deployments it must authenticate with a **scoped
  service credential** (see Governance Controls); password sessions are refused.
- One account never holds both governance roles, and nobody grants or removes a
  governance role on their own account. Every grant, removal and disabling of a
  governance account is audited with the administrator who did it.
- Technical admins register their notification address in
  **Administration > LLM Releases**. An address is an administrator-supplied
  contact, not an email-verification or identity-proofing mechanism. At least
  one active, enabled technical-admin contact is required before registration
  only when email is enabled.
- Migration `063_llm_release_governance.sql` creates tenant-isolated contacts,
  releases, and audit history. All write services recheck active DB roles and
  enabled-user status rather than trusting stale JWT claims. Candidate creators
  cannot approve their own releases even if they later gain the technical role.

## Automatic Email

Email is **disabled by default**. Only the exact value
`LLM_EMAIL_ENABLED=true` opts in; missing, false, or other values disable it.
Set the same flag on the API and dispatcher (`server` in the all-in-one local
stack). The carrier Compose shared environment supplies it to both.

A test deployment needs **no SMTP configuration**, contact email, or
`LLM_REVIEW_UI_URL` to register releases while disabled. Registration creates
no email intents or outbox retries. Its `CANDIDATE_READY` audit detail records
`emailEnabled:false` and `emailStatus:Disabled`, never `Sent`. Technical admins
still review at `/admin/llm-releases`, authorize lower-environment testing,
record validation, and separately approve production with the same current-role,
maker/checker, audit, and signature requirements. The release UI reports the
current email setting and keeps review controls available without a contact form.

When opting in, configure these on the dispatcher:

| Variable                             | Meaning                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| `LLM_EMAIL_ENABLED`                  | Exact `true` enables mail; default `false` (also on API) |
| `LLM_SMTP_HOST`                      | Carrier-approved SMTP relay                              |
| `LLM_SMTP_PORT`                      | 587 (STARTTLS) or 465 (TLS from connection start)        |
| `LLM_SMTP_FROM`                      | Plain sender email address                               |
| `LLM_SMTP_USER`, `LLM_SMTP_PASSWORD` | Relay credentials if required                            |

TLS and certificate validation are mandatory; use a trusted internal CA via
the Node runtime's trust configuration if needed. Attachment file/URL access
and SMTP protocol/content logging are disabled. Metadata email may leave the
application via the carrier's approved mail infrastructure; documents never
go through this path. This is unrelated to external AI inference.

When email is enabled, set `LLM_REVIEW_UI_URL` to the HTTPS carrier
administration origin on the API.
The existing async dispatcher automatically handles
`notification.llm_candidate_ready` via SMTP, independently of webhook/Kafka
event delivery. It does not fall back to stdout or a webhook. Missing SMTP or
delivery failures remain queued for outbox retries and eventually become
failed. These failures are not silently treated as sent. The release UI shows notification state. Revoked/disabled technical
admins are suppressed at delivery time; updated contacts use their current
address. Repeated candidate registration does not enqueue duplicate notices.

Delivery rechecks the flag before SMTP configuration or transport is accessed.
If disabled after registration, queued notices become terminal `Suppressed`
with a durable disabled reason, without SMTP calls or another delivery retry.
The dispatcher completes that outbox item, but the notification is **not Sent**.
Already sent notices remain Sent; suppression does not undo a completed send
or cancel SMTP already in flight. Re-enabling does not revive suppressed
notices or backfill notices for existing releases, including idempotent
registrations originally made with email disabled.

Delivery is at least once: an SMTP success followed by a database/network
failure can produce a duplicate retry. A deterministic Message-ID is supplied,
but recipient systems are not guaranteed to deduplicate it. `Sent` means the
relay accepted the message, not that a person read it or that inbox delivery
was guaranteed. Existing outbox failure/repair tooling applies.

## Candidate And Validation Contracts

`POST /api/v1/admin/llm/releases` requires the automation role and:

```json
{
  "versionLabel": "candidate-2026-01",
  "artifacts": {
    "profileId": "submission",
    "profileVersion": "1.1.0",
    "profileSha256": "<64 lowercase hex characters>",
    "model": "<immutable local model identifier>",
    "modelSha256": "<64 lowercase hex characters>"
  },
  "evaluation": {
    "sampleCount": 50,
    "fieldAccuracy": 0.98,
    "evidenceAccuracy": 0.99,
    "criticalErrors": 0,
    "datasetSha256": "<64 lowercase hex characters>",
    "reportSha256": "<64 lowercase hex characters>"
  }
}
```

The body also carries `evaluationReport`, the full held-out report written by
`services/document-learning` (no source values, only totals and per-sample
outcomes). The API refuses the candidate unless the report hashes to
`reportSha256`, belongs to this carrier and these exact artifacts, passed, has
no extraction or critical errors, and its totals **recompute** to the submitted
field and evidence accuracy and sample count. The report is stored with the
release, together with the gate policy in force.

The platform floor is 20 held-out samples, 95% field accuracy, 98% evidence
accuracy, and zero critical errors. A carrier technical admin can raise these
gates (**Release Gates** on the page, `PUT /api/v1/admin/llm/policy`); the
database refuses any value below the floor, and every change is audited. These
are software gates, not a certification of carrier suitability; the carrier
approves metric definitions and representative coverage. Do not use training
examples as the held-out evaluation corpus.

Compute the profile digest using `profileDigest` exported from
`services/document-processor/release-authorization.mjs` (canonical JSON SHA-256),
not a hash of pretty-printed file bytes. `modelSha256` identifies the approved
model artifact/manifest. The deployment pipeline must verify actual weights
against that digest before mounting them read-only. Runtime verification checks
the configured digest and model identifier; it cannot inspect a separate
inference server's weight bytes or prove that a mutable alias is unchanged.

The same version label is idempotent only for identical artifacts/evaluation.
Changed artifacts/reports need a new release. There is no artifact-edit API.

Technical-admin actions use
`POST /api/v1/admin/llm/releases/:id/:action`:

- `start-validation`: issues a signed lower-environment authorization.
- `record-validation`: `{passed, environment, runId, reportSha256,
artifactDigest, attestation:true, notes, report}`. Environment must be `test`,
  `qa`, or `staging`; the artifact digest must equal the candidate's digest.
  `report` is the lower-environment test report (JSON, at most 1 MB) with at
  least `{schemaVersion:1, runId, environment, artifactDigest, passed}`; it must
  hash (canonical JSON SHA-256) to `reportSha256` and agree with the recorded
  run, environment, artifacts and result. The page computes the hash from the
  uploaded file. The report is stored.
- `authorize-production`: `{attestation:true}`, only after passed validation,
  and only by a technical admin **other than the validator** (four eyes; also a
  database constraint).
- `revoke`: `{reason, attestation:true}` from `IN_VALIDATION`, `VALIDATED` or
  `PRODUCTION_AUTHORIZED`. Revocation is never blocked by the cooldown.
- `renew-authorization`: `{attestation:true}`, only in `IN_VALIDATION` or
  `PRODUCTION_AUTHORIZED`. Reissues the validation or production receipt for
  that exact current state with a fresh signature, `approvedAt`, and current
  technical-admin signer. It never promotes status, changes artifacts or
  validation evidence/report, or reruns validation. Current active role and
  maker/checker checks still apply; the validator cannot renew a production
  receipt. The audit records the renewal actor,
  environment, attestation, artifact digest, and old/new approval timestamps.
- `reject`: `{reason}`, before production authorization. Failed validation
  also rejects the candidate; subsequent attempts need a new release version.

Actual lower-environment testing is performed by the technical admin. The
attestation records their test evidence; it is not cryptographic proof that a
test runner executed. Production authorization is a distinct confirmation.

## Signed Activation And Separate Environments

Generate a carrier-owned Ed25519 key pair once in a secure operator environment:

```bash
openssl genpkey -algorithm ED25519 -out /secure/llm-release-private.pem
openssl pkey -in /secure/llm-release-private.pem -pubout -out /secure/llm-release-public.pem
```

In managed deployments (test, validation, staging, production) the private key
lives **only in the separate release signer** (`deploy/release-signer`,
`services/release-signer`). The API asks it to sign over an internal network
(`LLM_RELEASE_SIGNER_URL`, `LLM_RELEASE_SIGNER_TOKEN`) and checks every returned
signature against `LLM_RELEASE_PUBLIC_KEY` before storing it. The signer applies
its own rules (carrier, current approval time, expiry within 31 days, production
requires a validation report hash) and appends every signature to a
hash-chained log before returning it. The API **refuses** an inline
`LLM_RELEASE_SIGNING_KEY` in managed deployments; that variable is accepted only
for local development. A cloud KMS/HSM can replace the signer behind the same
`/sign` contract. Never put the key in the processor, model, training job,
browser, repo, or email.

```bash
docker compose -f deploy/release-signer/docker-compose.yml --env-file signer.env up -d
docker compose -f deploy/carrier-stack/docker-compose.yml \
  -f deploy/release-signer/application.signer.yml --env-file carrier.env up -d
```

Configure each processor/deployment operator:

```text
RELEASE_ENVIRONMENT=validation   # production on the production stack
CARRIER_TENANT_ID=<carrier>
MODEL_NAME=<immutable model identifier>
MODEL_ARTIFACT_SHA256=<verified model digest>
LLM_RELEASE_PUBLIC_KEY_FILE=/secure/llm-release-public.pem
```

Use **different** profile directories, model stores, networks, service tokens,
and application deployments for lower and production environments. Keep the
signing authority/public-key trust relationship controlled by the carrier.
The production compose stack defaults to signed `production` gating.
`RELEASE_ENVIRONMENT` has **no default** in the processor: unset fails at
startup. `development` must be set explicitly, is refused when
`NODE_ENV=production`, and exists only for isolated synthetic development.
Protect deployment configuration so a training identity cannot disable gating.

The technical admin downloads the appropriate signed JSON authorization from
the release page. The deployment operator/pipeline publishes the already
reviewed profile and activates it using that file:

```bash
node services/document-processor/manage-profile.mjs publish /carrier/profiles /reviewed/profile.json
node services/document-processor/manage-profile.mjs activate \
  /carrier/profiles submission 1.1.0 /approved/authorization.json
```

The CLI reads the above environment variables, checks the signature against
the trusted public key, and atomically stores the authorization before updating
the profile pointer. Every inference independently rechecks the authorization
against the actual profile content, carrier, environment, and configured model
identity/digest. An edited pointer, changed profile, other carrier's approval,
or validation-only approval cannot authorize production inference.

`PRODUCTION_AUTHORIZED` is **not** a deployment-success record. A deployment
pipeline still must provision/verify the model image and weights, apply the
signed activation, run smoke tests, and record deployment success externally.
There is no automatic AWS/Azure rollout or model-download/training executor.

Receipts expire at activation and every inference under the carrier's local
policy. `LLM_RELEASE_MAX_AGE_SECONDS` defaults to **604800 (seven days)** and
accepts integer values from 1 through **31536000 (one year)** on the operator
and processor. Expiry is inclusive at the boundary; invalid timestamps and
approvals more than 60 seconds in the future fail closed. Every receipt carries
a signed `expiresAt` (the carrier's authorization lifetime, default 7 days,
1–30); it may shorten but cannot extend the local maximum age. The release page
shows the expiry and warns two days before it. Disabling
expiry is unsupported. Keep clocks synchronized and apply the same policy to
the operator and processor.

Configure `LLM_RELEASE_REVOCATION_FILE` as a carrier-controlled JSON file.
Use **Download Revocation List** on the release page
(`GET /api/v1/admin/llm/revocations`): it is signed by the release signer and
lists every revoked release plus rejected releases that had a validation
receipt. The processor verifies its signature and carrier. A hand-written
unsigned `{"schemaVersion":1,"releaseIds":[]}` is still honored because it can
only stop releases. Verification reads it uncached on
activation and every inference; a configured missing, unreadable, or malformed
file fails closed. A revoked release ID invalidates both environments, including
renewed receipts. Renewal does not clear revocation. Role removal stops future
approvals, renewals, and notifications but does not itself revoke existing
receipts or update this file. An already-running inference is not cancelled.
The operator requires this file; maintain it with atomic replacements in a
protected directory mounted read-only into the processor.

Keep previous signed releases for rollback, but expired receipts need explicit
renewal by a currently assigned carrier technical admin. In the release page,
check the separate renewal attestation, select **Renew Authorization**, then
download the current validation or production authorization and reactivate it
through the operator. Renewal works before or after expiry and does not deploy
anything automatically. Validation receipts can only be renewed while the
release remains `IN_VALIDATION`; production receipts only while
`PRODUCTION_AUTHORIZED`. Rejected/unvalidated candidates cannot use renewal to
bypass review. For key rotation, renew with the new API signing key and distribute
the trusted public key out of band; old-key receipts fail under the new trust
file. See `docs/tasks/document-deployment-hardening.md` for operator rollout,
rollback, revocation, and key-rotation details.

The signer preserves PostgreSQL JSONB payload key order so persisted/downloaded
v1 signatures verify against the exact serialized payload. Receipts previously
invalidated by storage reordering must be renewed in an eligible state and
downloaded again; this does not change the verifier's v1 signature protocol.

## Governance Controls And Audit

| Control | Where it is enforced |
| --- | --- |
| Automation only registers; only people approve | Service role checks and `llm_release_audit_segregation` CHECK |
| Validator ≠ production approver ≠ registering identity | Service and `llm_releases_four_eyes` CHECK |
| No self-granted governance roles; never both roles | `PATCH/POST/DELETE /admin/users` guard |
| New technical admin cooldown (default 24 h, floor 24 h) before approving | Service, from the `ROLE_GRANTED` audit entry |
| Evaluation and test reports stored and re-checked | Registration and `record-validation` |
| Key outside the API in managed deployments | `llm-release-signer.ts`, release signer service |
| Revocation from the app, signed list for processors | `revoke`, `/admin/llm/revocations` |
| Scoped automation credential | `llm_automation_credentials`, `lpa_<id>_<secret>` |

**Service credentials.** An administrator (not the automation account itself)
issues a credential on **Release Automation Credentials**: bound to one account
that holds only `llm_release_automation`, expiring within 90 days, optionally
limited to network ranges, revocable, shown once and stored only as a SHA-256.
The learning pipeline sends it as `LEARNING_API_TOKEN`. It is accepted only on
`POST /admin/llm/releases`. Managed deployments require it; local development
may set `LLM_AUTOMATION_CREDENTIAL_REQUIRED=false`.

**Audit log.** `llm_release_audit` records every governance event with
`actor_type` (`user`, `automation`, `system`), the actor's roles at the time,
the subject account for role/credential events, and the request id. Like
`submission_events` it is **append-only** (UPDATE/DELETE raise
`AUDIT_APPEND_ONLY`; only explicit carrier offboarding with
`app.audit_purge='tenant-offboarding'` may delete) and **hash-chained** per
carrier (`prev_hash`, `entry_hash`, `chain_seq`). `audit_chain_first_break()`
re-computes a chain. **Administration > AI Audit** (`/admin/ai-audit`,
permission `ai.audit.read`) shows both logs in one trail, separated into AI,
automation, person and system, verifies the chains, and exports CSV (the export
itself is audited). Accounts named in audit records cannot be deleted; disable
them instead.

**Live quality.** For each release, the page shows the production correction
rate: the share of AI-drafted values reviewers changed in approved
submissions read by that release. Nothing from intake becomes training data.

**Remaining limits.** No proof of which weights an inference server actually
loaded; consent flags on profiles and datasets are declared by the operator;
role assignment still depends on the carrier's identity provider and
administrator accounts (use SSO and MFA).

## Tests

Audit/release endpoints also have per-IP route budgets before authorization and
credential lookup, in addition to the global API limiter. Per 15 minutes, audit
reads allow 120 requests; integrity checks and exports share 20; release and
credential reads share 120; release actions/credential writes share 60. Limits
are per API instance and return 429 with Retry-After when exhausted.

Migration 065 assigns audit sequence positions inside the predecessor/hash
lock rather than in column defaults. Concurrent inserts therefore remain in
chain order; rollback gaps are valid and supplied positions cannot reorder the
chain. The migration preserves historical audit rows. Any existing integrity
failure requires investigation, not re-hashing to conceal it.

- Node tests: receipt signatures, carrier/environment/artifact binding,
  unsigned activation and inference denial, changed-pointer denial.
- Server tests: evaluation thresholds, role separation, signature interoperability,
  tenant isolation, DB role revocation, approval ordering, exact-artifact test
  evidence, rejection, registration idempotence, default-disabled registration
  without email setup/retries, disabled audit state, opt-in contact/HTTPS checks,
  delivery-time flag suppression, email retry/suppression and TLS.
- Renewal tests: strict attestation, permitted states only, refreshed signatures
  and approval timestamps, preserved evidence, current roles, disabled users,
  maker/checker, tenant isolation, audit, and downloading the current receipt.
- Frontend/Playwright: staged controls, attestations, pass/fail radios, approval
  download, and desktop/mobile layout using synthetic responses.
- Governance hardening: report recomputation and tampering, carrier gates,
  four-eyes, cooldown, revocation and signed lists, remote signer verification,
  service credentials (issue, use, revoke, self-issue refused), governance role
  guards, append-only and hash-chain tamper detection, database segregation
  constraints, unified AI/person audit trail and audited export.

No real carrier documents, SMTP credentials, actual mail recipients, or trained
model weights are used by these tests.
