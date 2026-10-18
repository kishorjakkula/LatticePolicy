# Private Document Learning

## Ownership And Boundaries

`services/document-learning/` is an operator-run toolchain, separate from the
policy API and inference service. It adapts reviewed extraction profiles,
evaluates a candidate through a private model endpoint, and optionally registers
a passing candidate for carrier technical-admin review. It never activates a
production profile, changes business records, or reads the policy database.

Email is independent: `LLM_EMAIL_ENABLED` defaults to `false`. Test installations
need no SMTP account, notification contact, or email review URL. Candidates still
appear in Administration > LLM Releases. Only literal `true` enables mail.

Inference, profile examples, and weight training are different operations:

- Profile learning assembles reviewed examples and needs no weight changes.
- Optional offline LoRA training is under `services/document-learning/training/`.
  Its local ML dependencies, base weights, hardware, and inference-compatible
  conversion are operator-supplied. Read that directory's README before use.
- No upload or reviewer correction automatically becomes training data. A
  carrier-authorized curator must explicitly approve the source, labels, split,
  and consent first. There is no silent continuous training on live submissions.

## Reviewed Dataset Contract

A dataset contains `schemaVersion:1`, `tenantId`, `id`, `version`, and `samples`.
Each sample has:

- `id` and `sourceId`: opaque, non-sensitive identifiers. Revisions of the same
  document must use the same source group to prevent train/evaluation leakage.
- `split`: `train` or `evaluation`. At least 20 held-out samples are required.
- `dataPolicy`: `synthetic` or `consented`; consented samples also need an
  explicit `consentReference` to the carrier's private authorization record.
- `reviewed:true`, `reviewedBy`, and optional `correctedFields` for failure trends.
- `request`: the versioned processor request, including documents and the
  carrier's exact target schema. Do not invent a separate insurance field model.
- `expected`: human-reviewed `{variant,values,conflicts}`. Each value includes
  `key`, string `value`, `documentId`, `line`, `page`, and exact source `quote`.
- `criticalFields`: schema keys whose omission/mismatch must block publication.

Use JSON `null` for absent variant/line/page. Text uses one-based line and null
page; PDF/image evidence uses page and null line. Expected conflicts contain
their key and at least two source-evidenced options. New binary formats still
need parser adapters; examples cannot teach a parser to open an unknown format.

The curator checks source rights, PII minimization, corrections, representative
coverage, and consent scope. Labels are not trusted just because a model or user
clicked accept. Use test-only synthetic data initially. Never send datasets or
reports to public CI, GitHub attachments, telemetry, or external AI services.

Validation rejects unreviewed/unconsented samples, invalid schemas/evidence,
cross-carrier datasets, duplicate sample IDs, shared train/evaluation source
groups and identical source documents across splits. It cannot detect every
semantic near-duplicate or prove consent from a reference string; those remain
carrier review responsibilities. Limit: 1,000 samples and 32 MB per dataset.

Generate a **synthetic transport fixture**, not an insurance accuracy benchmark:

```bash
npm run document:learning -- synthetic /private/datasets/synthetic.json synthetic-carrier
```

The fixture has 6 training and 24 held-out text samples using distinct source
groups and label layouts. Replace/extend it with privacy-reviewed product,
layout, missing-value, conflicting-document, table, OCR, and adversarial cases
before claiming carrier readiness. Existing Node tests exercise omissions,
conflicts, injected instructions, fabricated evidence and provenance failures.

## Candidate Job

Create a protected local configuration; do not commit actual paths/credentials:

```json
{
  "tenantId": "synthetic-carrier",
  "datasetFile": "/private/datasets/synthetic.json",
  "baseProfileFile": "/private/profiles/submission/1.0.0.json",
  "profileVersion": "1.1.0",
  "model": "approved-immutable-local-model",
  "modelArtifactFile": "/private/models/approved-weights.gguf",
  "modelSha256": "<actual model file SHA256, 64 lowercase hex characters>",
  "modelUrl": "http://model:11434/v1",
  "outputDir": "/private/learning-runs",
  "registerOnSuccess": false
}
```

Paths resolve from the current working directory. Model URLs must resolve only
to private/loopback addresses; DNS is pinned, redirects/public addresses denied.
Set `LEARNING_MODEL_TOKEN` only if the private model requires authentication.
No signing key belongs on the learning host. Mount only approved data and
model artifacts and deny outbound traffic at the network layer.

An independent Node operator image is available from
`services/document-learning/Dockerfile`. It contains no model, training data,
ML runtime, policy database client, or API signing key. Mount the approved
dataset/model read-only, a carrier-private output directory writable, and
attach only the private evaluation network. Run with a read-only root, bounded
tmpfs/CPU/memory/PIDs, no published ports, dropped capabilities, and
`no-new-privileges`. The optional Python weight trainer is a separate operator
runtime, not silently installed inside this image.

```bash
npm run document:learning -- run /private/learning-config.json
```

The job verifies actual local model bytes, constructs a new immutable profile
from training samples only (up to 20 examples), activates it in an **evaluation-
only** directory, and evaluates held-out samples sequentially. It never touches
the application's active profile directory. Identical completed inputs reuse
the verified report; changed data/artifacts/baseline produce a new content-based
run ID. Exclusive locks prevent concurrent writers; investigate a crashed job
before removing a stale lock. Failed jobs can be rerun under the same inputs.

Gates are at least 95% exact field/conflict correctness, 98% source-evidence
accuracy, zero critical errors, and zero failed extractions. These are initial
software gates, not calibrated confidence or insurance certification. All
expected fields must match their source/line/page/quote, not just model values.
Variant mistakes fail critically and do not inflate the field-accuracy metric.
Unknown output keys fail critically. Reports contain counts and opaque sample
IDs/field keys, not document text, extracted values, or raw error bodies.
Directories/files are created private (0700/0600); operators own retention,
encrypted storage, deletion, access controls, and backup policy.

Each inference has the processor's four-minute bound; evaluation checks an
overall 30-minute abort budget between samples. A currently executing inference
can finish within its own deadline before the job observes cancellation.

Optionally set `baselineReportFile` to a prior report for the **same carrier and
held-out dataset**. A drop greater than 2 percentage points in field accuracy
or 1 point in evidence accuracy blocks registration even if absolute gates
pass. The baseline digest participates in run identity. Standalone comparison:

```bash
npm run document:learning -- compare /private/baseline.json /private/candidate.json /private/drift.json
```

`evaluation.json`, `state.json`, and `feedback-summary.json` record outcomes.
Only passing runs get `candidate.json`. Failure exits nonzero in the CLI and
never registers or deploys a release. State files are local operational records,
not a hostile-host security boundary; protect them from the training identity
after evaluation when independent evaluation assurance is required.

## Registration And Approval

```bash
npm run document:learning -- register /private/learning-runs/RUN_ID http://policy-api:3000 synthetic-carrier
```

Supply `LEARNING_API_TOKEN` as a scoped release automation service credential
(`lpa_...`), issued by an administrator on **LLM Releases > Release Automation
Credentials** for an account holding only `llm_release_automation`. Password
session tokens are refused. Registration sends the full held-out
`evaluation.json` so the API can re-check its hash and recompute the metrics. Alternatively set
`registerOnSuccess:true` and private `apiUrl` in the job config for automatic
registration after evaluation. Tokens stay in the process environment, never
configuration/output files. Candidate registration is server-idempotent.

The API still independently enforces RBAC, tenancy, thresholds, immutable
artifacts, maker/checker separation, lower-environment evidence, and production
attestation. The registration API trusts this authorized runner's report
assertions; digest checks detect accidental modification, not malicious forgery
by a compromised authorized runner. Use a separate evaluator identity/host and
archive reports under carrier-controlled immutable storage as needed.

With email disabled, the admin checks the release inbox. With email explicitly
enabled, readiness mail follows the outbox/SMTP flow. See
`docs/LLM_RELEASE_GOVERNANCE.md` for review and renewal. Deployment uses the
signed operator tool in `deploy/document-processing/operator.mjs`, including
actual artifact hashing, revocation/expiry checks, private smoke, and rollback.
See `docs/tasks/document-deployment-hardening.md`.

## Offline Weight Training

Export only approved training samples; held-out samples are excluded:

```bash
npm run document:learning -- export-training /private/dataset.json /private/train.jsonl synthetic-carrier
```

The export is immutable, records dataset/file hashes, and refuses binary-only
samples. Use the optional local trainer described in `training/README.md`.
The host-side Node wrapper selects a fixed Python adapter (never a dataset-
supplied executable), verifies the export manifest/tenant/hash, strips unrelated
API/signing credentials, and applies a subprocess deadline. A protected config:

```json
{
  "tenantId": "synthetic-carrier",
  "modelDir": "/private/models/approved-hf-snapshot",
  "trainingFile": "/private/train.jsonl",
  "outputDir": "/private/adapters/new-version",
  "dataApproved": true,
  "epochs": 1,
  "maxSteps": 100,
  "maxSequenceLength": 2048,
  "timeoutSeconds": 3600
}
```

```bash
npm run document:learning -- train /private/training-config.json
```

Run this on the dedicated approved Python/ML host, not the Node-only operator
image. The output parent must already exist and output must be a new directory.
Default deadline is one hour, configurable up to 24 hours; training failure is
not retried silently. It emits only `TRAINED_NOT_EVALUATED` metadata on success.
New adapters/merged weights must be converted and served by the chosen private
inference engine, assigned a new immutable identity, evaluated using a new
candidate job, then reviewed through the exact same admin workflow. A successful
training process is not authorization to deploy its output.

## Test And Release Status

`npm run test:document-learning` uses synthetic data and a local fake model.
`npm run test:document-training` tests trainer contracts without ML dependencies.
Both run in CI; the Node suite also runs in normal local/Docker tests.

Live model accuracy, GPU training, actual SMTP, carrier UAT and cloud rollout
must be verified in the carrier environment. This repository does not select
a model/license/GPU or provision AWS/Azure accounts. The same processor images
and JSON contracts are cloud-independent, but cloud network/storage/secret
provisioning remains an operator deployment task, not a completed local test.
