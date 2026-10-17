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
Carrier technical admin: test exact artifacts, record evidence and attestation
    -> VALIDATED (or REJECTED)
Carrier technical admin: separately authorize production publication
    -> PRODUCTION_AUTHORIZED + signed production authorization
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
  production. Protect its credentials and configure carrier-approved CI
  authentication; this change does not introduce a new machine-auth protocol.
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

The current minimum gate is 20 held-out samples, 95% field accuracy, 98%
evidence accuracy, and zero critical errors. These are initial software gates,
not a certification of carrier suitability. The carrier must approve metric
definitions and representative test coverage. Reports are assertions from the
trusted evaluation pipeline, not independently recomputed by this endpoint.
Archive the actual reports/datasets privately under their hashes; do not use
training examples as the held-out evaluation corpus.

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
artifactDigest, attestation:true, notes}`. Environment must be `test`, `qa`,
  or `staging`; the artifact digest must equal the candidate's digest.
- `authorize-production`: `{attestation:true}`, only after passed validation.
- `renew-authorization`: `{attestation:true}`, only in `IN_VALIDATION` or
  `PRODUCTION_AUTHORIZED`. Reissues the validation or production receipt for
  that exact current state with a fresh signature, `approvedAt`, and current
  technical-admin signer. It never promotes status, changes artifacts or
  validation evidence/report, or reruns validation. Current active role and
  maker/checker checks still apply. The audit records the renewal actor,
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

Inject the private PEM as `LLM_RELEASE_SIGNING_KEY` **only on the API** through
the carrier's secret manager. Literal `\n` escapes are supported. Never put
it in the processor, model, training job, browser, repo, or email.

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
The production compose stack defaults to signed `production` gating. Do not
set `RELEASE_ENVIRONMENT=development` in a carrier validation/production stack;
that explicit unmanaged mode exists only for isolated synthetic development.
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
approvals more than 60 seconds in the future fail closed. A signed `expiresAt`,
if present, may shorten but cannot extend the local maximum age. Disabling
expiry is unsupported. Keep clocks synchronized and apply the same policy to
the operator and processor.

Configure `LLM_RELEASE_REVOCATION_FILE` as a carrier-controlled JSON file with
`{"schemaVersion":1,"releaseIds":[]}`. Verification reads it uncached on
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

## Tests

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

No real carrier documents, SMTP credentials, actual mail recipients, or trained
model weights are used by these tests.
