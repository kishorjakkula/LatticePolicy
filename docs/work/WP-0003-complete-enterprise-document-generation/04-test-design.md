# Test Design - WP-0003

Status: planned tests for Gate B, not executed evidence. Approved requirements,
`02-design.md`, `03-ui-design.md`, TEST_PLAN and existing document/portal tests
are the sources. Earlier foundation checks are separate in
`verification-baseline.md`; none automatically proves a new capability.

## Test Cases

| Criterion | Case | Layer | Synthetic data | Expected |
| --- | --- | --- | --- | --- |
| REQ-1 | DOC-01 native file validity | Renderer unit/integration | Approved plain/loop profiles; typed XLSX; self-contained HTML | Real PDF/DOCX/XLSX parse, expected text/cells/types, declared MIME/hash |
| REQ-1 | DOC-02 profile boundaries | Contract/renderer unit | Empty, unknown, oversized, unsupported features | Explicit rejection; no partial success or unsupported engine fallback |
| REQ-2 | DOC-03 actual packet content/order | Renderer integration + golden PDF | Declarations plus 3 distinguishable multipage forms, mixed orientation | Actual required pages in defined order, correct page count/text, no index-only substitute |
| REQ-2 | DOC-04 DOCX/XLSX conversion fidelity | Private converter integration + visual golden | Long tables, repeated headers, logos/fonts, print areas, long names, Unicode and permitted languages | Required content/layout preserved within approved fixture tolerance; clipping/blank pages fail |
| REQ-2 | DOC-05 fixed forms and protected sources | Renderer negative integration | Approved AcroForm mappings, missing field, XFA, encrypted/signed PDF | Supported fields fill correctly; unsupported cases rejected; no claim of retained signature after mutation |
| REQ-3 | DOC-06 required graph failure | Module/DB integration | One required conversion fails after other outputs succeed | No published manifest, no download/delivery, accurate failed node |
| REQ-3 | DOC-07 dependency/optional semantics | Contract + coordinator unit | Cycle, missing dependency, PDF required/native-only ready, approved optional omission | Invalid graph rejected; required PDF not satisfied by DOCX; optional failure visible under explicit policy |
| REQ-3 | DOC-08 readiness experience | Component + Playwright + API | Pending, processing, validation, retry, failed, review-required, unknown state | Correct wording; no Open/Download until authorized READY; direct API denies bypass |
| REQ-4 | DOC-09 atomic intent rollback | PostgreSQL integration with RLS | Domain mutation fails after intent insertion | No orphan accepted work or visible document |
| REQ-4 | DOC-10 duplicate identity | Module/DB integration | Same key/same hash, different hash, simultaneous submissions | One visible request; changed content conflicts; no cross-tenant deduplication |
| REQ-4 | DOC-11 leases/fencing | DB integration + process fault injection | Worker loss before/after upload, expired last attempt, stale finisher | Reclaimed or terminal state; stale worker cannot publish/fail a replacement |
| REQ-4 | DOC-12 mixed-load isolation/fairness | Isolated qualification load | Approved urgent/ordinary/bulk mix, large XLSX, concurrent policy actions/downloads | Workload-specific approved p95/p99/deadline thresholds met; no starvation or unbounded resource growth |
| REQ-4 | DOC-13 admission/deadline/resource bounds | Renderer/worker integration | Busy slots, slow body/download, oversized archive/output, hung child | Bounded memory/CPU/scratch/PIDs; safe retry/admission response; kill process tree and recover capacity |
| REQ-5 | DOC-14 author/reviewer/publisher authority | API/DB integration + Playwright | Separate assigned actors; revoked/stale roles; author tries self-approval | Current DB authority enforced; prohibited transitions denied/audited |
| REQ-5 | DOC-15 immutable activation/promotion | Module/DB integration | Base and carrier namespaces, new edition, overlapping selectors, changed approval digest | Exact tested package activated; ambiguous/tampered input denied; carrier override not overwritten |
| REQ-5 | DOC-16 queued version pin | Module/converter integration | Activate v2 while v1 job is pending | Pending job uses v1 assets/engine; new applicable request uses v2 |
| REQ-6 | DOC-17 typed export integrity | Export/renderer integration | Leading-zero IDs, high-precision strings, dates, currencies, '=...' and URL-like values | Types preserved; formula-like values inert; authoritative source totals unchanged |
| REQ-6 | DOC-18 as-of partition/reconciliation | Domain/module integration | Dataset changes during export; limit-1/limit/limit+1 rows; headers | Stable as-of dataset, no missing/duplicate/truncated rows, total/count agreement across parts |
| REQ-6 | DOC-19 failed-part resume | Module integration + Playwright | Multi-part export with one failed partition | Retry only eligible failed part; final manifest reconciles every required part |
| REQ-7 | DOC-20 exact reprint/correction | Archive/DB integration + Playwright | Issued copy, policy/template update, corrective request | Reprint byte hash unchanged; correction has new ID and linked history |
| REQ-7 | DOC-21 stale/OOS events | Domain inbox integration | Out-of-order endorsement, superseded/withdrawn revision, duplicate completion | Historical artifact retains correct version; newer readiness and delivery not updated by stale result |
| REQ-8 | DOC-22 tenant/carrier boundary | API/DB RLS + private service integration | Two tenants, forged header/body/object reference, same source IDs | Zero cross-tenant reads/writes; independent authenticated pin and namespace checks |
| REQ-8 | DOC-23 recipient/customer projection | API + portal Playwright | Owner, unrelated customer, revoked policy link, broker/internal-only variant | Correct safe edition only; no raw snapshots, rating traces or administrative payloads |
| REQ-8 | DOC-24 hostile assets | Isolated renderer security tests | Macro/OLE/DDE, external XML/links, ZIP bombs, traversal, script/metadata URL | Rejected or isolated within limits; no egress or secret/body logging |
| REQ-8 | DOC-25 sandbox/offline operation | Exact-image container smoke | Read-only root, dropped capabilities, denied network, private scratch | Real authenticated formats work with supported sandbox; unsupported host fails readiness rather than disabling sandbox |
| REQ-9 | DOC-26 schema/capability compatibility | Contract + release integration | Supported N/N-1 contracts, old pinned template, unknown engine | Supported combinations pass; incompatible requests fail before official publication |
| REQ-9 | DOC-27 migration/adoption/rollback | Disposable restore/release tests | Main/foundation migration inventory, duplicate ownership, legacy files | No migration collision, original downloads remain valid, one coordinator owns each job, additive rollback succeeds |
| REQ-9 | DOC-28 AWS/Azure private archive | Cloud post-deploy, separately per cloud | Private test bucket/container, least-privilege identities, revoked credentials | Conditional/hash-verified operations; no public access or fallback; safe outage behavior |
| REQ-10 | DOC-29 observability/alerts | Unit + integration + operator journey | Missing metric, aged urgent job, DLQ, archive error, deadline risk | Missing != zero; safe traceable alert; no PII labels; appropriate operator action |
| REQ-10 | DOC-30 retry/cancel races | PostgreSQL concurrency tests | Two simultaneous retries, cancel vs completion, authority revoked | One accepted replacement; cancellation fences result; no forced success or history rewrite |
| REQ-10 | DOC-31 staging cleanup safety | Archive/DB fault integration | Old orphan, live lease, published ref, hold, interrupted cleanup | Only eligible unreferenced objects removed after recheck; published/held/live content preserved |
| REQ-10 | DOC-32 coordinated restore | Disposable disaster-recovery drill | Catalog/archive/outbox recovered at differing checkpoints | Original hashes reconciled; missing entries flagged; dispatch stays blocked until safe |
| REQ-10 | DOC-33 delivery ambiguity | Delivery integration | Provider accepted then timeout, duplicate intent, withdrawn recipient eligibility | Reconcile rather than blind resend; generation retry never sends mail |
| REQ-11 | DOC-34 qualification evidence guard | CI/metadata tests + review | Missing targets, missing cloud/restore run, failing golden | Candidate cannot claim enterprise readiness with absent/failed evidence |
| REQ-11 | DOC-35 full lifecycle matrix | API/domain integration + selected E2E | Quote, bind, issue, endorse, cancel, reinstate, rewrite, renew, non-renew, correction | Correct purpose/version/edition; no rating or bind/issue semantics changed implicitly |
| REQ-11 | DOC-36 role/responsive/accessibility | Component + Playwright | Internal/portal roles; desktop/390px; keyboard, zoom, themes, long text | Shared controls, focus/announcements, no page overflow, no color-only states; direct denied routes tested |
| REQ-3,5,7,8 | DOC-37 existing transaction workflow/admin navigation | Component + Playwright + API | One policy with two issue transactions v3/v4 and endorsement v5; HO-DEC editions 2026-01/02; distinct reviewer/publisher | Transaction-number link opens existing wizard with pinned policy/transaction/version; step 8 Forms/Documents retained; exact transaction+version scoped outputs, not type-only filters; no new policy Documents tab; issued originals cannot regenerate; forms/editions only in Administration; historical template editions read-only; backend authority independent of visible controls |

## Test Data And Isolation

### Administration Master-Data Addendum

| Criterion | Case | Layer | Synthetic data | Expected |
| --- | --- | --- | --- | --- |
| REQ-1,5,8 | DOC-38 static versus populated template | Parser/renderer + UI | Static PDF, Word/Excel fields, supported fillable PDF, unknown required token, macro/oversized/mismatched file | Correct mode-dependent controls; server validates real bytes and approved field catalog; static original preserved; missing/unsafe bindings block publication |
| REQ-2,5,7 | DOC-39 effective scoped attachment | Rules/domain/API + UI | Multiple products/states, boundaries, transaction types/stages, false conditions, repeated risk units, conflicting editions/overrides | Only explicitly active matching forms attach; stable order/copy scope; missing scope does not become universal; ambiguity rejected or governed by explicit precedence; transaction snapshot retains exact edition/rule/asset IDs |
| REQ-5,8 | DOC-40 draft/review/activation integrity | API/DB + UI | Author, reviewer, publisher; edited candidate; uploaded replacement; active edition clone | Save draft never publishes; edits invalidate evidence; self-approval denied; exact reviewed version promoted; old published assets unchanged; client checks cannot bypass backend authority |
| REQ-3,5,11 | DOC-41 simple administration journey | Component + Playwright | Catalog filters, new draft, static/Word/Excel choices, missing mapping, attachment preview match/nonmatch/date boundary | Four clear tabs and Save & continue; unsupported upload rejected; reasons visible; failed checks disable review submission; no manual master upload needed in transaction wizard; desktop/mobile/light/dark accessible |

Local mockup smoke checks exercise filter, extension rejection, required mapping,
static mode, conditional false/true, effective-date mismatch and review gating.
They do not execute actual parser, cloud storage, malware or production activation
tests; DOC-38 through DOC-40 remain production implementation requirements.

Use synthetic, licensed-to-test wording and fixtures with unambiguous page/cell
markers. Keep semantic assertions independent of binary timestamps. Byte hashes
prove archived-copy identity, not cross-engine visual equivalence. Golden images
are reviewed against pinned fonts/engines; changed baselines require an explicit
review, never an automatic update to make CI green.

Parameterize lifecycle/product/state/locale/audience cases from supported
configuration, including mismatched product/state/transaction and effective-date
boundaries. Do not invent regulatory clock values. Actual carrier wording or
de-identified customer documents require explicit rights/consent before use.

Reuse `e2e/support/fixtures.ts`, API/wizard/product helpers and radio audit.
Each browser spec has unique IDs, independent fixtures and no shared mutable
tenant/state configuration. Integration tests run against disposable PostgreSQL
with TENANT_RLS_ENFORCED and restricted roles. No test points at pilot/demo or
production data. Use a separate approved staging stack only after Gate C.

## Negative And Security Coverage

Every new endpoint must test missing/invalid authentication, denied permission,
cross-tenant IDs, unrelated customer/recipient, current-role revocation, malformed
or oversized input, stale revision and key/content mismatch. Verify DB RLS on
all new module/domain tables. API denies are required even when UI hides actions.
Test invalid CSRF/origin handling where the chosen auth mode requires it; do not
substitute a UI mock for an actual authorization test.

## Regressions

- Existing issued downloads/legacy local files remain readable after adoption;
  corrupt objects never trigger a render storm or silent content replacement.
- Existing policy/rating/validation behavior and canonical statuses stay intact.
- Carrier-specific overrides and customer-safe projections survive upgrades.
- Existing Agent Studio and incoming OCR/LLM workflows remain separate.
- Existing forms/portal tests continue to pass; every new screen joins the UI
  section/radio audit. Baseline fixed renderer limits remain covered.
- Database connection and file/process counts return to bounded steady state
  after failures, shutdown and repeated runs.

## Planned Placement And Commands

Renderer tests stay beside private service adapters; coordinator state/queue
tests beside its module. Application unit/integration tests remain in server;
frontend tests beside views; user journeys in dedicated `e2e/document-*.spec.ts`.
Only contract schemas belong in a shared package. Runtime changes include tests
and the task/documentation context in the same delivery package.

Use the root lockfile and repository commands (`npm run build`, `npm run
typecheck`, `npm run test`, targeted server integration, `npm run test:e2e` and
module suites). CI adds exact-image offline PDF/DOCX/XLSX conversion/assembly
smokes, compatibility and migration/restore jobs. Cloud, load/soak and DR jobs
are separately authorized and record environment/image/workload digests.

## Release Evidence And Unresolved Targets

Record test IDs, requirement IDs, source commit, exact image/tool/font/template
versions, commands, timestamps, environment and actual result. Unit test counts
are not throughput evidence. Separate tests that passed from tests not run.

Carrier volume mix, numeric latency/backlog/cost limits, RPO/RTO, Office viewer
matrix and optional signature/PDF-A/accessibility profiles are explicitly
deferred by Gate A to qualification planning. Get those approvals before tests
can report the affected enterprise acceptance criteria as passed. No target is
fabricated in this plan. Any required fidelity failure blocks that adapter's
release until corrected or an alternative receives human design approval.

The independent code reviewer runs in a fresh session, then security and
automation stages run before Gate C. Gates C and D cannot be waived or approved
by an agent. This handoff requests Gate B approval only.
