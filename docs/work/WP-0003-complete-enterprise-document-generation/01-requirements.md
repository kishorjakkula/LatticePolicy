# Requirements - WP-0003

Status: proposed scope, awaiting human Gate A approval. This does not approve
the earlier unmerged implementation retrospectively.

## Business goal

Resume the enterprise document-generation work following the request
"continue, docker is up". Carrier operations users must reliably obtain complete
policy documents and data exports without bulk document workloads disrupting
interactive policy work. Policyholders and brokers must receive only the
approved, correctly scoped edition. Carrier administrators need safe template
changes, independent module releases and actionable operational evidence.

The existing asynchronous foundation is a starting point, not a completed
enterprise product. The outgoing renderer's final runtime smoke now passes;
see `verification-baseline.md`. No live stack was upgraded during that check.

## Knowledge And Existing Work

- `docs/knowledge/pc-insurance/README.md`: last_reviewed 2026-10-17, 90-day
  review interval; current against the client date of 2026-10-18.
- Its domain research primer and `requirements-checklist.md` inform lifecycle,
  forms, authority, history and recipient requirements. No generalized research
  statement is treated as an approved state-specific legal rule.
- `docs/DOMAIN.md`, `docs/GLOSSARY.md`, `docs/PROJECT_CONTEXT.md` and the existing
  personal-auto, homeowners, commercial-auto, cyber and professional-liability
  product packs define the current business scope.
- Prior conversation and the unmerged foundation's `docs/DOCUMENT_GENERATION.md`,
  `docs/DOCUMENT_GENERATION_DESIGN.md` and task note define the proposed intent
  and observed gaps. They are in the existing development worktree, not main.
- Preserve that worktree's unrelated Agent Studio changes. The architect must
  establish a reviewed integration boundary before implementation continues.

## Scope

- Lines: shared platform capability for existing personal/commercial products
  and supported carrier packs. Use personal auto and homeowners as initial
  representative acceptance fixtures; do not limit the contract to those lines.
- Jurisdictions: existing configured jurisdictions only. No new admitted/surplus
  authorization, filed wording, compliance clock or licensing determination.
- Transactions: quote/proposal, bind, issue, endorsement, cancellation,
  reinstatement, rewrite, renewal, non-renewal, historical reprint and correction.
- Channels: internal operations, authenticated integrations and customer portal;
  separate insured/broker/additional-interest variants where configured.
- Roles: existing permissions remain authoritative; propose separate author,
  content reviewer, technical publisher and operational retry entitlements.
  Exact role mapping is a Gate B decision, not a grant to every administrator.
- Formats: official PDF, editable DOCX where authorized, and XLSX schedules/
  exports. Derived PDF and native files must have explicit lineage.

## Requirements

| ID | Requirement | Source |
| --- | --- | --- |
| REQ-1 | Produce real, validated PDF, DOCX and XLSX artifacts; distinguish required renditions and unsupported features explicitly. | Maintainer's requested formats and prior design |
| REQ-2 | Produce complete ordered PDF policy packets from the actual approved forms, not only an index of form names; provide private Word/Excel-to-PDF conversion for the accepted feature profile. | Carrier document-completeness objective |
| REQ-3 | Never mark a packet ready or permit official delivery while any required form/rendition is missing or invalid. Show pending, failed and review-required outcomes clearly. | Maintainer's critical-document requirement |
| REQ-4 | Keep urgent operational documents responsive during renewal/export bursts. Bound work, recover failed jobs and avoid holding business transactions open during rendering. | High-volume/performance objective |
| REQ-5 | Permit approved base/carrier template versions to be reviewed, tested and activated independently, with effective-date selection and immutable historical references. | Carrier configuration and independent-release objective |
| REQ-6 | Integrate authorized XLSX schedule/report requests into the application with snapshot/as-of identity, literal input strings, reconciled counts/totals and explicit limits/partitioning. | Requested spreadsheet support and existing reporting scope |
| REQ-7 | Preserve each issued artifact and its provenance. A reprint returns original bytes; corrections create linked replacements, including out-of-sequence policy changes. | Existing policy-version model and prior design |
| REQ-8 | Keep all processing, artifacts, credentials and logs within the carrier boundary; enforce tenant, customer and recipient scope and deny unsafe templates or external resource access. | Maintainer's private per-carrier architecture |
| REQ-9 | Support safe independently versioned module deployment and rollback on AWS/Azure, preserving carrier customizations, queued work and historical downloads. | Maintainer's cloud and release requirements |
| REQ-10 | Provide actionable queue/deadline/failure visibility, controlled retries, staging cleanup and archive restore procedures without regenerating or double-sending published documents. | Reliability and operational-readiness objective |
| REQ-11 | Require automated functional, negative, isolation, mixed-load and restore evidence before declaring enterprise readiness; carrier-specific performance targets and UAT require human approval. | Repository testing process and explicit prior qualification gaps |

## Acceptance Criteria

### REQ-1 / REQ-2

Given approved templates and a pinned policy snapshot, when authorized outputs
are generated, then native Word and Excel files open with expected typed data,
and the PDF packet contains the actual required form pages in approved order.
When conversion loses required content, pagination or formatting, the result
fails acceptance rather than silently substituting an index or blank output.
Unsupported formats/features are rejected before official publication.

### REQ-3

Given a packet with multiple required outputs, when any render, conversion,
validation or archive operation fails, then the whole official packet remains
unavailable for delivery. Completed partial outputs remain private. Pending and
failed downloads are not reported as successful. Optional-output treatment must
be explicit and audited, not inferred from a caught exception.

### REQ-4

Given a representative mixed-format batch plus interactive policy traffic,
when the workload runs or a worker is lost, then urgent requests retain reserved
capacity, accepted jobs remain durable and retries cannot publish duplicates.
Policy latency, completion times and recovery must meet the workload-specific
targets approved before qualification. No daily throughput number is promised
without an agreed workload and measured evidence.

### REQ-5

Given a proposed template change, when an unauthorized author attempts to
activate it or approve their own regulated wording, then activation is denied.
When an approved edition is activated, new applicable requests use that edition
while existing requests and historical documents retain their recorded edition.
A platform upgrade must not overwrite a carrier-owned extension.

### REQ-6

Given an authorized schedule export with a fixed as-of dataset, when XLSX is
generated, then identifiers retain leading zeroes, untrusted formula-like text
stays inert and aggregate counts/totals reconcile to the source. When output
exceeds the accepted workbook profile, it is partitioned with reconciliation or
explicitly refused; rows are never silently truncated. Other policy/customer
data must not appear in the export.

### REQ-7

Given an issued document followed by a policy/template change, when a reprint
is requested, then original verified bytes are returned. When a correction or
out-of-sequence transaction requires a new document, then a linked version is
created without rewriting the old copy or marking a newer policy revision ready
from an older job's completion.

### REQ-8

Given carrier A's artifacts and jobs, when a carrier B identity, an unrelated
customer, or an unauthorized operator requests access, then access is denied.
When a template tries macros, external links/resources or excessive archive
expansion, then it is rejected without data egress or public partial output.
Internal underwriting/rating details must not leak through customer variants.

### REQ-9

Given a compatible document-module update, when it is tested and released,
then it can be adopted independently of an unrelated policy application change.
When rollback is required, accepted work and archived bytes remain recoverable;
the system does not silently reinterpret queued inputs using a different engine.
AWS and Azure adapters must pass their own environment-specific checks.

### REQ-10

Given a stuck job, expired deadline, storage outage or ambiguous delivery result,
when an operator inspects it, then safe actionable status and trace/audit evidence
are available. Authorized recovery/retry preserves history and cannot publish or
send twice. Cleanup removes only eligible unreferenced staging objects, never
published or held records. Restore reconciles catalog and archive before delivery.

### REQ-11

Given a release candidate, when enterprise-readiness evidence is reviewed,
then tests cover supported formats/features, lifecycle cases, tenant/recipient
isolation, crash recovery, bursts, sustained load and restoration. Missing cloud,
performance, compliance or carrier UAT evidence remains explicitly pending and
cannot be represented as a passed release gate.

## Business Rules

- Use existing carrier/product applicability and validation frameworks. Do not
  invent hard-coded policy eligibility, notice periods, rating or form selection.
- Rendering completion, policy lifecycle status and delivery confirmation are
  distinct. Recommended first release blocks delivery of incomplete packets;
  changing bind/issue finalization semantics needs an explicit carrier-approved
  gate matrix before implementation of those semantics.
- Official content comes from approved wording and validated domain snapshots,
  not generative AI. No external AI or conversion fallback is authorized.
- Financial/rating totals come from the owning domain. Billing and financial
  ledger remain a separate application; this work does not calculate accounting.
- Generation does not authorize dispatch. Preserve existing consent, recipient
  eligibility and publication checks, including withdrawal before sending.

## Regulatory And Compliance Notes

Carrier/state-specific form approval, permitted edits, cancellation/non-renewal
deadlines, retention, e-delivery consent, signature and accessibility requirements
need confirmation by the carrier's owners. This package does not prescribe legal
values or assert compliance across all insurance/reinsurance jurisdictions.
Licensed ISO/ACORD or other third-party templates must not be copied or shipped
without the appropriate rights. Use synthetic/nonproprietary fixtures in tests.

## Out Of Scope And Assumptions

No live production deployment, automatic merge, carrier credentials collection,
new filings, new rating logic, accounting ledger, external AI, or destructive
history migration. Private local verification is allowed; staging deployment
follows Gate C and business sign-off follows Gate D under the new workflow.

The pre-flow foundation remains uncommitted in the existing development worktree;
it is not treated as merged or gate-approved. Main's unrelated delivery packages
and research/output files must not be changed by this work.

## Questions And Recommended Defaults For Gate A

| # | Question | Recommended default | Answer / disposition |
| --- | --- | --- | --- |
| 1 | Which lines/jurisdictions should the shared capability cover? | All existing configured products/jurisdictions; initial representative fixtures are personal auto/homeowners; no changed filed wording or new territory approval. | Proposed; confirm with Gate A. |
| 2 | Should document readiness change bind/issue business status? | First block incomplete delivery and report readiness separately; carrier-specific finalization gates require an approved matrix. | Proposed; confirm with Gate A; exact matrix deferred to carrier business review. |
| 3 | Which outputs and roles are required? | PDF plus controlled native DOCX/XLSX; preserve existing permission checks and separate author/reviewer/publisher/operator duties. | Proposed; confirm with Gate A; detailed role/feature matrix goes to Gate B. |
| 4 | What throughput and retention/signature standards apply? | Do not invent numeric SLAs or regulatory values. Agree the workload and profiles before performance/release acceptance; record unresolved evidence as pending. | Explicitly deferred to qualification planning and carrier confirmation; not a production readiness waiver. |

Gate A asks the product owner to approve this proposed scope and the stated
deferrals, or specify changes. No approval or waiver has been recorded.
