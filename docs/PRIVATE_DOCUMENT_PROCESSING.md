# Private Document Processing

## Boundary

LatticePolicy calls a separately deployable, stateless document processor.
The processor calls a carrier-owned model server using an OpenAI-compatible
`/v1/chat/completions` protocol. This protocol does not mean OpenAI receives
data. Neither processor nor model has a policy database connection or business
write permissions. Extraction remains a proposal; the existing submission
review, validation, tenant isolation, attestation, and atomic approval remain
in the application.

Code: `services/document-processor/`; application adapter:
`server/src/lib/intake/extractors.ts` (`PrivateDocumentExtractor`).

Carrier technical-admin review, automatic readiness emails, lower-environment
testing and signed production activation are described in
`docs/LLM_RELEASE_GOVERNANCE.md`. Configure that workflow before processing
carrier data; the production deployment refuses unsigned releases.

The default data boundary is private. `INTAKE_AI_PROVIDER=private` requires a
private processor URL and a bearer token of at least 32 characters. The
legacy Anthropic reader is refused unless an operator explicitly opts out via
`INTAKE_DATA_BOUNDARY=external`. There is no fallback to a cloud provider.
Do not set that opt-out for carrier-private deployments.

Both HTTP clients resolve DNS, reject any non-private answer (including
link-local metadata addresses), pin the validated answer to the connection,
refuse redirects, bound response sizes, and apply deadlines through response
body consumption. Private IP checks alone are not an egress firewall: a
private gateway could forward data elsewhere. Use the supplied isolated
network, trusted images/models, and carrier-controlled deployment policies.

## Processing Contract

Authenticated `POST /v1/extract`, `Authorization: Bearer TOKEN`:

```json
{
  "schemaVersion": 1,
  "profile": "submission",
  "documents": [{
    "id": "document-id",
    "fileName": "application.txt",
    "mediaType": "text/plain",
    "textLines": ["Applicant: Example Synthetic Company LLC"]
  }],
  "schema": {
    "fields": [{"key":"insuredName","label":"Insured","type":"text","options":[]}],
    "variants": [],
    "variantHint": null
  }
}
```

For PDFs/images without text, send `dataBase64` and empty `textLines`.
The response contains `schemaVersion`, `model`, profile id/version, OCR/text
pages, and `result`: schema variant, summary, extracted values, and conflicts.
Each value includes its field key, string value, score, exact source quote,
document id, and line/page. LatticePolicy validates known fields/documents,
normalizes values, and verifies evidence before displaying the draft. Model
self-reported confidence is not a calibrated probability of correctness.
The exact model and extraction profile version are recorded in `ai_run.processing`.

The service accepts only schemas and documents, not policy database identifiers
or write commands. It has no cache, upload archive, training queue, or document
content logs. Temporary OCR files are removed in `finally`; Docker places
them on bounded tmpfs, including when a container is killed. Request payloads
and upstream error bodies are never logged or returned in error responses.

## Supported Documents And Limits

- Existing application parsers handle text, CSV, email bodies, Word, and Excel.
  These pass text to the processor, not original files. Email attachments are
  still separate uploads. The private provider preserves complete source lines
  and rejects parsing/text-limit failures rather than silently truncating them.
- The processor uses local Poppler for PDF text and local Tesseract for scans
  and images. Blank/mixed PDF pages trigger OCR for the full document.
- OCR is English, PDFs are limited to 8 pages, files to 10 MB, the processing
  request to 20 MB, and the combined extracted text to 240 KB (JSON size).
  Text per document is limited to 120,000 characters. Larger inputs are rejected,
  not silently accepted as complete. Split them before resubmission.
- One active request per processor instance, bounded subprocesses, a 4-minute
  overall processing budget, and a 3-minute maximum model request. Long bodies,
  malformed JSON, truncated model output, and unsupported files fail closed.
- OCR accuracy, handwriting, complicated tables, encrypted/corrupt files, and
  new binary formats are not universally supported. New binary formats need
  parser adapters, not just examples. Models must be evaluated for the chosen
  schema/context size; an OpenAI-compatible API alone does not establish quality.

## Independent Deployment

Use one isolated processing stack and profiles directory per carrier. Shared
multi-carrier processing with different models/profiles is not supported by
this deployment kit. Never attach multiple carrier applications to the same
processing network. Use a unique `DOCUMENT_NETWORK` and token for each stack.

1. Pre-provision approved inference images and local model files **before**
   introducing carrier documents. Review the model license, hardware needs,
   and extraction evaluation. No automatic model downloads occur in this kit.
2. Prepare a carrier-owned profiles directory from
   `services/document-processor/profiles/`. The processor mounts this directory
   read-only; only a trusted operator can publish examples there.
3. Populate a private env file using
   `deploy/document-processing/processor.env.example`. Generate a token, for
   example `openssl rand -hex 32`; use the same token on the application.
   Supply a pinned, approved Ollama image/digest and a preloaded local model name.
   Configure `LLM_RELEASE_MAX_AGE_SECONDS` (default seven days) and an existing,
   carrier-controlled `LLM_RELEASE_REVOCATION_DIR` containing `revocations.json`:
   `{"schemaVersion":1,"releaseIds":[]}` initially. The directory is mounted
   read-only at `/release-policy`, with automatic host-directory creation disabled.
   Keep `LLM_RELEASE_REVOCATION_FILE=/release-policy/revocations.json` for the
   container. To revoke, download the signed list from **LLM Releases >
   Download Revocation List** and atomically replace the host file; the
   processor verifies its signature and carrier, and the directory mount makes
   replacements visible on each inference. Missing or malformed configured
   policy, a bad list signature, and expired receipts deny processing.
   `RELEASE_ENVIRONMENT` has no default: set `validation` or `production`
   (`development` only for isolated synthetic work, never with
   `NODE_ENV=production`).
4. Build/start the isolated services from the repository root:

```bash
docker compose --env-file /secure/processor.env \
  -f deploy/document-processing/docker-compose.yml up -d --build
```

5. Before admitting application traffic, use the signed local deployment
   operator described below to verify the actual artifact and smoke-test the
   private endpoint. Then attach the application with the appropriate overlay.
   The processor token and network name must be present in the application's
   private env file:

```bash
# Root local stack
docker compose --env-file /secure/application.env -f docker-compose.yml \
  -f deploy/document-processing/application.local.yml up -d --build

# Published per-carrier stack (use a release containing the adapter)
docker compose --env-file /secure/carrier.env \
  -f deploy/carrier-stack/docker-compose.yml \
  -f deploy/document-processing/application.carrier.yml up -d
```

The processor and model have no published ports and use an `internal: true`
Docker network. Only the application API/worker joins that private network.
The model has cloud features disabled and container logging disabled; see
[Ollama's cloud-disable setting](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features).
Avoid adding gateways/proxies or extra model networks. For AWS/Azure, use the
same images with private service discovery, no public IPs, default-deny egress,
managed secrets, encrypted storage, and equivalent CPU/memory/temp-storage
limits. The compose files are not Terraform or a complete cloud deployment.

Use HTTPS/mTLS when the service boundary crosses hosts or trust zones. This
local single-host example uses private-network HTTP and bearer authentication.
There is no public training or configuration endpoint.

### Governed Local Activation And Rollback

Use `deploy/document-processing/operator.mjs` on a trusted operator host/runner
that can reach the isolated processor network. Do not publish processor ports
to make the smoke test reachable. Configure its published profiles directory,
actual local model artifact file, metadata records directory, token file, and
private `/v1/extract` endpoint as documented in
[`document-deployment-hardening.md`](tasks/document-deployment-hardening.md).
Use the same carrier/environment/model/digest, trusted public key, maximum age,
and revocation policy as the processor. For host-side execution, override
`LLM_RELEASE_REVOCATION_FILE` with the host path under
`LLM_RELEASE_REVOCATION_DIR`, not the container's `/release-policy` path.

```bash
node deploy/document-processing/operator.mjs preflight /secure/operator.json /approved/authorization.json
node deploy/document-processing/operator.mjs activate /secure/operator.json /approved/authorization.json
node deploy/document-processing/operator.mjs rollback /secure/previous-operator.json /approved/previous-authorization.json
```

Preflight streams and hashes actual read-only model file bytes against the
configured and signed digest, not just a model name or manifest declaration.
Activation and rollback use the same signed verification path, then a private
synthetic inference smoke test. Records contain deployment metadata and status,
never document content or tokens. These checks cannot prove which weights a
separate model server loaded; carrier controls must mount the verified artifact
read-only into that runtime and prevent mutable aliases/replacement.

**Quiesce application processing before activation or rollback.** Resume only
after the smoke passes. A failed smoke exits unsuccessfully and records failure
but may leave the attempted profile active; keep traffic quiesced and perform
an explicitly verified rollback with an unexpired, unrevoked receipt. There is
no automatic rollback or automatic AWS/Azure rollout. Arrange a matching model
runtime separately when changing model versions.

## Push New Examples Independently

Profiles are **inference-time examples and mapping instructions**, not weight
training. Carrier uploads and reviewer corrections never become examples
automatically. Only synthetic or explicitly consented, reviewed data belongs
in these releases; the metadata declaration does not replace human privacy review.

The independent [Private Document Learning guide](DOCUMENT_LEARNING.md) describes
`services/document-learning/`: reviewed dataset validation, profile learning from
training samples, held-out private evaluation, and optional passing-candidate
registration. It does not activate production or automatically collect uploads
or reviewer corrections. Candidate registration still requires the separate
technical-admin review and signed deployment workflow.

Create a JSON profile following `profiles/submission/1.0.0.json`, give it a new
semantic version, and evaluate it against held-out synthetic/consented documents.
Publish, then activate separately. These bare activation commands are for
synthetic development only; governed validation/production activation requires
the technical-admin signed authorization and environment configuration in
`docs/LLM_RELEASE_GOVERNANCE.md`:

```bash
node services/document-processor/manage-profile.mjs publish \
  /carrier/extraction-profiles /reviewed/submission-1.1.0.json
node services/document-processor/manage-profile.mjs activate \
  /carrier/extraction-profiles submission 1.1.0
```

Publication refuses overwrites. Activation atomically updates `active.json`;
each new run reads that pointer, while an in-flight run keeps the profile it
loaded. No application rebuild/restart is needed. In synthetic development,
roll back by activating `1.0.0`; governed deployments must use the verified
operator rollback above. Back up the versioned directory; restrict operator
write access and record approval/change control in the carrier's deployment
system. A stale `.activation.lock` after an operator crash requires investigation
before removal.

For **actual fine-tuning**, follow the guide's
[optional offline LoRA training workflow](DOCUMENT_LEARNING.md#offline-weight-training),
separate from profile learning and inference. Export only reviewed, authorized
training samples; keep held-out evaluation samples excluded. The optional
trainer requires operator-supplied local ML dependencies, approved base weights,
and suitable hardware. Adapter/merged-weight conversion and serving in the
chosen private inference engine remain operator responsibilities. No live GPU
training, inference-compatible conversion, or cloud provisioning is verified by
these local tests or claimed complete here.

Assign converted model artifacts a new immutable identity, evaluate them through
the independent candidate pipeline, and obtain technical-admin validation and
production authorizations before using the verified deployment operator. Publish
approved weights into the carrier's model store, then update/restart only the
model/processor deployment. Training success is not deployment authorization.
Avoid mutable model aliases so audit provenance remains meaningful. Do not train
on carrier documents without explicit permission and a defined retention policy.

## Verification

```bash
npm run test:document-processor
npm run test --workspace=server -- src/lib/intake/__tests__/
npm run typecheck
npm run build
```

The image's real OCR smoke test is opt-in and can run entirely offline:

```bash
docker build -f services/document-processor/Dockerfile -t lattice-document-processor:local .
docker run --rm --network none --read-only --tmpfs /tmp:size=128m,mode=1777 \
  --memory 512m -e RUN_OCR_SMOKE=1 lattice-document-processor:local \
  node --test ocr.test.mjs
```

Tests use synthetic documents and a fake local HTTP model. A successful
transport test is not a real-model accuracy evaluation. Before enabling
carrier users, test actual OCR and a selected local model against a held-out
corpus, exercise private-network egress denial, confirm no document-bearing
logs/telemetry are collected by the hosting platform, and measure field-level
accuracy, omissions, conflicts, and evidence validity.
