# Document Deployment Hardening

## Summary And Ownership

Local operator tooling verifies real on-disk model bytes before signed profile
activation and records a private synthetic inference smoke result. Receipt v1
signatures remain interoperable with the existing governance signer. No issue,
PR, commits, cloud provisioning, or signing-service changes are included.
The independent processor compose/env template now wires the local policy;
root/carrier compose files and the governance document remain separately owned.

## Important Files

- `services/document-processor/release-authorization.mjs`: lifetime and uncached
  local revocation enforcement at activation and every inference.
- `deploy/document-processing/operator.mjs`: preflight, activation, rollback,
  actual file hashing, private smoke, metadata-only deployment records.
- `deploy/document-processing/docker-compose.yml` and `processor.env.example`:
  required read-only revocation-directory mount and processor lifetime policy.
- `deploy/document-processing/compose.test.mjs`: offline synthetic compose-config
  assertions, including the missing-directory configuration failure.
- `services/document-processor/release-authorization.test.mjs` and
  `deployment-operator.test.mjs`: Node unit/local integration tests using only
  synthetic profiles, deterministic model bytes, and loopback HTTP.

## Receipt Policy

Existing signed `approvedAt` is used without modifying signed payload bytes.
`LLM_RELEASE_MAX_AGE_SECONDS` defaults to **604800 (seven days)**, inclusive
expiry at the boundary; the environment setting accepts integers 1..31536000.
Missing/invalid timestamps and approvals over 60 seconds in the future fail
closed. An optional signed `expiresAt` can shorten, never extend, local policy.
This applies to both validation and production. Old receipts can therefore
require fresh approval even though their signature remains valid. Keep host
clocks synchronized; disabling expiry is not supported.

Set `LLM_RELEASE_REVOCATION_FILE` to a carrier-owned JSON file:

```json
{"schemaVersion":1,"releaseIds":["release-id-to-disable"]}
```

Use an empty array initially. Every verification reads it afresh, with no cache;
missing, unreadable, or malformed configured files deny processing. Revocation
is by release ID and disables that release's validation/production receipts.
An already-started inference is not cancelled. Deployments must mount the same
carrier policy in the operator and processor. Publish updates with atomic file
replacement in a protected directory; mount the directory read-only into the
processor so replacements are visible (a single-file bind mount can pin the old
inode). Only a trusted carrier operator may write it. Role removal in the
application does not automatically populate this file.

The runtime keeps the revocation path optional for existing installations;
the new operator CLI **requires** it and refuses development/unsigned policy.
The processor compose stack requires `LLM_RELEASE_REVOCATION_DIR` on the host,
mounts it read-only at `/release-policy`, and disables automatic host-directory
creation. Initialize `revocations.json` before starting the stack. The template
sets `LLM_RELEASE_REVOCATION_FILE=/release-policy/revocations.json` inside the
container. A host-side operator must override that variable with the host file
path while retaining the same policy contents and maximum age. Neither a
successful compose-config check nor a running health endpoint proves the file
is valid; activation and inference read and enforce it.

## Operator Workflow

Run on the private host/network that can access the processor, with Node 22+.
Export the existing governed environment settings: `RELEASE_ENVIRONMENT`,
`CARRIER_TENANT_ID`, `MODEL_NAME`, `MODEL_ARTIFACT_SHA256`, and
`LLM_RELEASE_PUBLIC_KEY_FILE`, plus the local policy settings above. Never copy
the signing private key onto this host. Use the existing publisher to install
an already reviewed versioned profile; this CLI only activates published files.

Create a protected operator JSON config (file paths resolve relative to it):

```json
{
  "profilesDir": "/carrier/profiles",
  "modelArtifactFile": "/carrier/models/approved-weights.gguf",
  "recordsDir": "/carrier/deployment-records",
  "privateEndpoint": "http://document-processor:8080/v1/extract",
  "tokenFile": "/carrier/secrets/processor-token"
}
```

`modelArtifactFile` must be the actual approved local model artifact, **not a
manifest that merely declares a weight digest**. The configured digest and
signed receipt must match SHA256 of those actual file bytes. Files must be
nonempty regular files with no write permission bits; final-component symlinks
are refused. Hashing streams from an open descriptor and checks file metadata
for concurrent changes. Before provisioning, copy the approved artifact into a
carrier-owned versioned/content-addressed location and remove its write bits;
mount that exact artifact read-only into the model deployment. Protect parent
directories and aliases against replacement, including by the training identity.

```bash
node deploy/document-processing/operator.mjs preflight /secure/operator.json /approved/production.json
node deploy/document-processing/operator.mjs activate /secure/operator.json /approved/production.json
node deploy/document-processing/operator.mjs rollback /secure/operator-previous.json /approved/previous-production.json
```

Preflight checks policy, published profile, receipt, actual model digest, token
file, and private endpoint resolution. It performs no activation or smoke and
creates no record. Activation/rollback repeat actual file verification before
the existing signed atomic activation path. They POST a fixed synthetic text
request to the private `/v1/extract` endpoint and require matching release,
profile/version, model, and result shape. The existing HTTP client pins private
DNS answers, rejects public/metadata addresses and redirects, and bounds time
and response size. No shell commands, arbitrary smoke scripts, public HTTP
requests, model downloads, or carrier documents are used. Cross-host deployments
must use carrier-trusted HTTPS/mTLS rather than the single-host HTTP example.

The model bytes and receipt are checked again after the smoke. Each deployment
writes an exclusive-ID, mode-0600 record with carrier/environment, release,
profile/model/receipt digests, model byte count, operation, timestamps and status.
It stores no documents, results, endpoint, file paths, token, signature, or error
bodies. `started` indicates an interrupted/unconfirmed attempt;
`smoke-passed` is local transport/provenance success, not extraction-quality
certification. Preflight failures do not produce deployment records.

A failed smoke records `failed`, exits unsuccessfully, and **may leave the new
profile active**. Quiesce application traffic while changing releases and keep
it stopped on failure until an explicitly verified rollback succeeds. There is
no automatic unsigned rollback. Rollback repeats the exact same checks, including
expiry and revocation; obtain a renewed authorization if the old receipt has
expired. For a different model, operators must first arrange the matching model
mount/runtime and operator config. This CLI does not restart the model server.
Serialize all operator/profile writers; the CLI holds `.deployment.lock` across
activation/smoke and the existing activation helper also uses `.activation.lock`.
Investigate crashed attempts before removing stale locks.

## Key Rotation And Trust

The trusted Ed25519 public-key file is carrier-controlled, never taken from a
receipt. For planned rotation, generate a new carrier key pair securely, update
the API signer through its existing secret mechanism, obtain fresh technical-admin
authorizations, and distribute the new public key out of band to the operator
and processor. Quiesce processing, replace the trust file, restart processors
(the public key is loaded at startup), and reactivate/smoke with new receipts.
All old-key receipts fail under the new key, including rollback receipts; renew
those approvals in advance. No dual-key/key-ID protocol is introduced. During
an incident, update the revocation file immediately and isolate traffic before
rotating keys. Never allow the training identity to modify trust/policy files.

## Verification And Limits

```bash
npm run test:document-processor
node --test deploy/document-processing/compose.test.mjs
npm run test --workspace=server -- src/services/__tests__/llm-release.service.test.ts
```

Validated: processor suite 18 passed, one opt-in real OCR test skipped; signer
interoperability/service suite 10 passed in the initial implementation. Follow-up
validation reran the processor suite (18 passed, one opt-in OCR skip) and both
synthetic compose-config tests (two passed, no skips). Compose validation runs
offline without starting containers or provisioning resources and covers default
and custom policy, required-directory failures, read-only directory binding,
disabled host-directory creation, internal networking and absent published ports.
Tests cover actual artifact tampering,
read-only enforcement, symlinks, unsigned/wrong-carrier/wrong-environment/expired
receipts, live revocation and malformed/missing policy, public endpoint denial,
private synthetic inference, version rollback, and sanitized failure records.

Read-only mode bits/hash checks are not OS-enforced immutability against root
or a hostile host. The CLI cannot prove which weights a separate model server
loaded, defend against a dishonest private gateway, or certify extraction
accuracy. Carrier deployment controls must bind the inspected file to the
actual model runtime, enforce egress denial, preserve audit records externally,
and supply held-out quality evaluation. No AWS/Azure resources were provisioned,
no real model was deployed, and no real-model/cloud rollout success is claimed.
