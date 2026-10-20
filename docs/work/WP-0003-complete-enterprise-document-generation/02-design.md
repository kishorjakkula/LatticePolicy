# Design - WP-0003

Status: design approved at Gate B by Kishor Jakkula; see `status.json` for his
recorded approval. Implementation is in progress. This design includes future
behavior, not a claim of completed features or release of the earlier foundation.

## Context And Source Of Truth

Main currently ends at migration 066. The existing development worktree contains
Agent Studio migrations 067/068 and the document foundation migration 069; none
may be treated as released or silently copied over newer main changes. First
implementation step is a scoped integration review separating document changes
from unrelated Agent Studio work. Allocate final migration numbers only against
the integration branch; the numbers below are explicitly provisional.

Architecture/tech-radar knowledge was last reviewed 2026-10-17 (90-day interval,
current on the client date 2026-10-18). Read with current MULTITENANCY, API,
DATA_MODEL_ERD, PRODUCT_PACK_CONTRACT and VALIDATION_RULES. Legacy ERD prose is
conceptual: migrations and current schemas determine actual names/constraints.

## Options Considered

| Option | Benefits | Cost/risk | Decision |
| --- | --- | --- | --- |
| Keep all rendering inside the Policy API | Few deployment units | Business transactions compete with rendering; coupled releases and failures | Reject for enterprise mode |
| Independent private document module with durable intents and replaceable engines | Carrier-private, reusable existing stack, independent scaling/releases | Queue/catalog ownership, compatibility and operational tooling required | Select |
| External document-generation SaaS | Managed authoring/conversion | Carrier data crosses the intended boundary and adds vendor dependency | Reject under current privacy decision |
| Purchase an on-premises commercial rendering SDK | Potentially better Office fidelity and support | Licensing/cost, still requires all reliability/governance layers | Conditional engine alternative if fixture acceptance fails |

Do not split every function into a separate microservice. Use a coordinator and
bounded format workers in one technical module, with converter dependencies in
a separate image. Do not build a custom PDF/Office parser or calculation engine.

## D1. Components And Ownership

```text
Policy/report domain -> atomic immutable intent + domain outbox
   -> publisher -> private document coordinator + owned catalog/outbox
   -> priority work queues -> PDF / DOCX / XLSX / conversion / assembly workers
   -> verified immutable archive -> atomic published manifest
   -> completion outbox -> application inbox/status projection
   -> authorized download or separately authorized delivery
```

- Policy API owns business applicability, permissions, recipients, validated
  domain values and intent insertion. No render/network/archive calls within
  its policy mutation transaction. Snapshot creation uses committed immutable
  versions, not a moving current-policy projection.
- Document module owns request/output/attempt state, templates, dependencies,
  engine routing, staging, artifact manifests and module audit. It has no joins
  into policy/customer tables. A logical independent PostgreSQL database and
  credentials are the target; it may share a managed PostgreSQL host initially
  with separate connection/IO budgets.
- Existing foundation's policy-owned queue is a compatibility adapter, not the
  final independent coordinator. Adopt it behind a feature flag, then transfer
  new work to the coordinator through a versioned contract. Drain old claims;
  never have two coordinators own one request.
- The monorepo remains. Proposed locations: `services/document-generator/`,
  `services/document-coordinator/`, converter image, `packages/document-contracts/`,
  API adapter, existing policy document/forms screens and deployment overlays.
  Shared contracts contain schemas only, not Policy API runtime imports.
- No changes to rating ownership, existing filed wording or AI extraction.

## D2. Native Formats, Conversion And Packet Graph

Retain existing Puppeteer/Chromium, Docxtemplater/PizZip and ExcelJS behind
capability adapters. Add `pdf-lib` exactly `1.17.1` (MIT in the tagged upstream
manifest) for bounded PDF page assembly and approved AcroForm filling. License,
security and untrusted-PDF handling require review before the dependency lands;
this is not a general PDF sanitizer or signatures/PDF-A engine.

Evaluate private LibreOffice conversion behind a separate constrained worker
image. Its runtime version, dependencies, fonts and image digest must be recorded
exactly in the release SBOM/lock manifest; floating image tags and unpinned
runtime packages are not release evidence. Upstream supports headless conversion
and isolated profiles, but Office fidelity is an acceptance test, not a promise.
If required fidelity fails, stop that capability and propose a private SDK adapter
for human approval; never degrade the official layout silently.

Build a validated acyclic output graph, for example:
`fill-docx -> native-docx -> convert-pdf -> packet-merge -> final-pdf`.
Independent XLSX and its requested PDF rendition are distinct nodes. Every node
pins its schema/template/assets/fonts/engine image and hashes; conditional and
repeating template features must be approved capabilities, not arbitrary code.
Required-node failure prevents publication; optional-node handling is explicit.

Packet assembly uses actual approved pages with deterministic form order,
orientation and page numbering. Preserve signed source documents unchanged;
reject unsupported encrypted/signed merging rather than claiming signature
preservation. XFA, legacy binary Office, macros, unapproved external relations,
signing/PDF-A/tagged-accessibility remain explicit profiles, not default support.

## D3. Reliable State And Publication

Use at-least-once work delivery with idempotent visible effects, not a claim of
exactly-once queue execution. A request key is scoped to tenant, source and
business revision; reusing it with different input returns a conflict. Persist
job registration and dispatch outbox atomically. Large data snapshots are
materialized after commit using a stable domain export watermark/manifest.

Each claim has a renewable lease, bounded deadline and increasing fence token.
Dependency cycles, missing required assets and invalid templates fail permanently;
transient worker/archive failures use capped retries and dead-letter status.
Expired final claims are reconciled. Cancellation invalidates pending delivery
and fences publication; a late completion cannot make a different revision ready.

Outputs first enter private attempt-scoped staging. Validate bytes, content,
format, required fields, count/totals and configured layout profile. One catalog
transaction publishes the complete manifest and result outbox. Application
consumers deduplicate completion events and update only the matching revision.
Missed-event reconciliation reads status without regenerating.

Reprints retrieve original bytes. A correction creates a linked request and new
artifact ID; no overwrite. Missing/corrupt archives fail closed and enter a
controlled restore workflow. Normal download GET never renders.

## D4. Data, Migrations And Rollback

| Owner | Additions |
| --- | --- |
| Policy DB | Immutable document intents, minimal readiness projection, completion inbox; index tenant/business revision/request identity |
| Module DB | Requests, DAG outputs, leased attempts, immutable artifacts/manifests, snapshot references, package versions/approvals/activations, append-only audit and completion outbox |
| Both | Tenant IDs and scoped uniqueness, RLS USING/WITH CHECK, restricted runtime roles and no owner-bypass qualification |

Provisional policy migrations follow the reviewed foundation: 070 document
intent/inbox boundary, 071 package/activation integration, 072 export/recovery
integration. Recheck numbering at implementation, including 067-069 conflicts;
never edit or renumber an applied migration. Module DB has its own migration
ledger/version starting at 001, not a dependency on every policy migration.

Use additive expand/backfill/validate/contract. Legacy documents receive an
explicit legacy-origin marker, not fabricated approvals or snapshot hashes.
Keep their files and references readable. Move objects only through an audited,
hash-verified migration with reconciliation; never copy live customer data into
test. Keep original archives and encrypted backups under carrier policy.

Rollback stops new admission, drains or pins accepted jobs to a supported engine,
restores routing to the previous compatible image and keeps additive schema.
No down migration, deletion of history or automatic reinterpretation of old
inputs. Test the DB/catalog/archive recovery point together before dispatch.

## D5. Template Governance And Business Gates

Immutable packages carry source/content hashes, supported input/output schema,
approved bindings, locale/jurisdiction/product/transaction selectors, required
outputs, ordering, fonts and synthetic golden fixtures. Base and carrier-owned
namespaces are separate; activation cannot overwrite base releases or carrier
extensions. Ambiguous effective-dated selections are rejected.

Workflow: draft -> validated -> reviewed -> approved -> active -> retired.
Author cannot approve their own regulated content. Technical publishing and
business wording approval are separate, with current DB-assigned permissions
rechecked on every mutation. Activation changes future selections only; queued
jobs retain immutable version pins. Promotion requires tested package hashes.

First release gates document publication and delivery, not policy bind/issue
status. Use carrier validation rules for required checks/warnings; never invent
a new policy status or notice period. Finalization gates remain disabled until
a carrier-approved business matrix and revalidation-on-finalize design exist.
Native editable copies are derivatives, not an avenue to overwrite originals.

## D6. APIs And Compatibility

The following are proposed contracts, not currently mounted routes. Preserve
existing document list/content paths and safe projections while extending them.

| Application route | Authorization / effect |
| --- | --- |
| POST /v1/policies/:id/document-requests | `documents.generate` plus policy scope; immutable selected template/output purpose, not arbitrary HTML |
| GET /v1/document-requests/:id | Internal read scope; safe stage/output status only |
| POST /v1/reports/document-exports | `documents.export` plus domain filter scope; permitted report types only |
| POST /v1/document-requests/:id/retry | `documents.jobs.manage`; linked retry preserving original failure |
| POST /v1/document-requests/:id/cancel | `documents.jobs.manage`; audited eligibility checks and fence |
| /v1/admin/document-templates/... | Distinct read/author/review/publish permissions; production activation requires independent reviewed content |
| GET /v1/admin/document-operations | `documents.jobs.read`; tenant-safe queue/age/deadline aggregates |

New permissions are explicitly assigned and tested; no blanket grant to all
roles. Existing `admin.jobs.manage` compatibility is mapped intentionally during
integration, not silently replaced. Customers cannot generate internal reports,
see operational payloads or call admin endpoints.

Example application request:

```json
{"purpose":"policy-packet","policyVersionId":"<uuid>","outputs":["pdf","docx"],"requestKey":"<uuid>"}
```

Server resolves authorized selections and snapshots. HTTP 202 returns
`{requestId,status:"PENDING",statusUrl}`; it is not document readiness.
Conflicting key is 409 `DOCUMENT_REQUEST_CONFLICT`; stale revision is 409
`DOCUMENT_SOURCE_STALE`; missing required artifact is 422
`DOCUMENT_REQUIRED_ARTIFACT_MISSING`; unsupported profile is 422
`DOCUMENT_CAPABILITY_UNSUPPORTED`; not-ready download is 409
`DOCUMENT_NOT_READY`; archive failure returns safe unavailable status.
All routes join the generated OpenAPI inventory with strict schemas.

Module contract `document-generation.requested.v1` includes authenticated tenant,
source/revision, immutable snapshot reference/hash, package/engine digests,
required output graph, recipient classification/locale and trace identity.
Response/completion events include unique event ID and matching business
revision. Private artifact references use an authenticated allowlisted object
namespace, never caller-provided URLs or public links. Incompatible graph/engine
changes use a new contract/capability revision. Publish an explicit N/N-1 support
matrix; never assume old schemas work with a new renderer.

## D7. Security, Privacy And Archive

Per-carrier coordinator, workers, queues, database credentials, archive and keys.
No external AI/converter fallback. Services use private networking and managed
identity or scoped secrets; require TLS outside explicit local/container links.
Do not expose public renderer ports. Verify caller, configured carrier pin and
object namespace independently. Keep carrier/customer data out of metrics,
errors, payload logs and training datasets.

Apply sandbox, non-root, read-only root, bounded scratch/CPU/memory/PIDs, denied
external/metadata egress, request/archive expansion limits and killable render
deadlines. XML/Office/PDF parsers remain untrusted-code boundaries. Reject unsafe
scripts/macros/relationships, sanitize or reject review/hidden content under
the approved feature profile. Request strings never become Excel formulas.

Archive exact published bytes in private S3/Azure Blob, immutable object identity,
hashes, encryption and carrier-approved retention/holds. Downloads recheck current
customer-policy links and variant visibility. Operational artifacts and native
editable derivatives are internal by default until explicitly classified.
Append-only audit records authority, input/package/engine digests and lineage;
protect any audit hash chain without making hash equality a digital signature.

Cleanup is two-phase: mark unreferenced eligible staging entries, recheck leases,
publication and legal holds after a grace period, then delete through a scoped
identity. Never apply a blanket lifecycle rule to prefixes that include originals.
Delivery stays separate; ambiguous send outcomes are reconciled rather than
blindly resent. Test email remains disabled by default.

## D8. Capacity, Operations And Release Evidence

Separate urgent, ordinary and bulk worker budgets per format, with aging/fairness.
Use bounded pages/converter processes, finite queue admission, whole-job deadlines,
heartbeats and recycling. A converter instance has its own private profile and
scratch; no desktop Office automation. Stream large XLSX rows and archive IO;
do not keep all workbook parts or base64 binaries in API/outbox memory.

Partition immutable export datasets deterministically with manifests and count/
total reconciliation. Resume failed partitions, not an entire renewal batch.
As-of reporting must not hold long OLTP transactions or read moving live pages.
Cache only immutable package/assets by digest; no cross-carrier filled-output cache.

Metrics: queue age/workload class, p95/p99 per stage and overall, deadline misses,
retry/DLQ counts, publication/inbox lag, CPU/RSS/scratch, pages/rows/bytes,
converter restarts, archive errors and restore gaps. No PII metric dimensions.
Dashboards, alerts, failure/runbook actions and structured trace IDs are release
requirements. Scale from estimated work and age, not job count alone.

Features: independent coordinator enablement, converter/assembly capability,
template publication, exports and controlled cleanup are opt-in per carrier.
Production activation fails closed if required engine/package/profile is missing.
AWS/Azure credentials, private endpoints, retention and target load remain
environment-specific acceptance evidence, not local unit-test claims.

Qualify against an approved versioned workload file: document/page/row distribution,
peak/burst arrivals, concurrent policy operations/downloads, deadline classes,
cost ceiling and RPO/RTO. No invented numeric SLA. Publication correctness and
tenant isolation require zero known failures. Performance cannot pass without
the approved thresholds; load/soak, worker loss and restore must be exercised.

## D9. Incremental Integration And Risks

1. Inventory/review pre-flow changes; preserve unrelated work and migrate safely.
2. Add module-owned coordination/contracts and a compatibility adapter; prove
   single ownership and idempotent projection before enabling new traffic.
3. Add certified conversion/fixed-form/assembly graph nodes and actual packets.
4. Add immutable package review/promotion, export workflows and operator screens.
5. Add cleanup, telemetry, replay/recovery drills and independent image CI.
6. Review/security/automation, human merge Gate C, isolated staging, E2E and
   carrier business validation Gate D. No automatic merge or production deploy.

Primary risks: Office fidelity, licensed forms/fonts, decoder vulnerabilities,
staging growth, cross-store consistency, migration overlap, stale policy events
and unapproved lifecycle/SLA assumptions. Mitigations are explicit feature
profiles, immutable pins, negative/golden tests, ownership/fencing, independent
review and blocking acceptance gates. A large-capability commercial engine is
an alternative if the supported open-source profile proves too restrictive.

## Requirement Mapping

| Requirement | Design elements |
| --- | --- |
| REQ-1 | D2 native profiles, D3 validation, D6 strict contracts |
| REQ-2 | D2 conversion/assembly graph and actual-page validation |
| REQ-3 | D3 atomic manifest and D5 publication/delivery gates |
| REQ-4 | D1 short domain transactions and D8 isolated capacity |
| REQ-5 | D5 immutable approval/activation and D6 compatibility |
| REQ-6 | D6 authorized exports and D8 snapshot partitioning |
| REQ-7 | D3 versioned lineage and exact archive retrieval |
| REQ-8 | D7 carrier boundary, current authorization and parser isolation |
| REQ-9 | D1 owned boundary, D4 migration/rollback and D8 independent releases |
| REQ-10 | D3 reconciliation and D7/D8 cleanup/operations |
| REQ-11 | D8 qualification evidence and D9 human gates |

## ADR And Sources

[ADR 0002](../../knowledge/architecture/adr/0002-private-document-generation.md)
records the selected design. Human design approval does not establish that its
production capabilities have been implemented or qualified.

- [pdf-lib capabilities](https://pdf-lib.js.org/) and
  [exact 1.17.1 manifest/license](https://raw.githubusercontent.com/Hopding/pdf-lib/v1.17.1/package.json).
- [LibreOffice headless conversion/profile options](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html).
- Repository module, tenancy, validation and product-pack documents cited above.
