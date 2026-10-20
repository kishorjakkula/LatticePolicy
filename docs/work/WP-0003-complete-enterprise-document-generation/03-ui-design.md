# UI Design - WP-0003

Status: revised transaction and simplified administration design approved at
Gate B by Kishor Jakkula; exact approval is recorded in `status.json`.
Application implementation and verification are in progress; see
`05-implementation.md` for delivered scope and remaining capabilities. Read with
approved requirements and `02-design.md`. UX knowledge reviewed 2026-10-18
(180-day interval) is current; reuse UI_CONTROL_STANDARDS and shared tokens.

## Interactive Mockup

Source: [document-generation.html](mockups/document-generation.html).
This self-contained preview uses synthetic data and local state only; it does
not generate real documents, deliver notices, approve production templates or
implement backend authorization. The preview follows the existing transaction
wizard and forms administration rather than a separate document-module screen.
The role selector demonstrates authority states, not a real
role-switching capability available to users.

The mockup covers policy documents and request details, generation confirmation,
template preview/evidence and independent approval/validation activation,
operations retry/cancel/restore, partitioned Excel export and customer-safe
documents. The optional table-density design control compares comfortable and
compact rows without changing the approved workflow.

Browser verification: headless Chrome / Playwright passed generation acceptance,
reviewer/publisher separation, author self-approval denial, linked retry,
XLSX preview and customer-safe display checks. All five screens were checked
at 320px and 390px for page overflow; desktop, mobile and dark appearance were
visually inspected. No JavaScript runtime errors were observed. These are mockup
checks, not evidence that the production feature is implemented or enterprise
qualification is complete. Implementation must use the shared React components
and automated application tests described in this work package.

Repeat the local prototype smoke checks from the repository root with
`node docs/work/WP-0003-complete-enterprise-document-generation/mockups/check-mockup.cjs`.
This uses installed Chrome by default; set `MOCKUP_BROWSER_CHANNEL=chromium`
to use a locally installed Playwright Chromium instead.

### Navigation Clarification From Product Owner

- Documents belong to each transaction, not a new policy-level Documents tab.
  The prior mockup's invented Overview/Coverages/Transactions/Documents policy
  tabs are removed. Open the existing Transactions row's transaction number,
  then the transaction wizard's existing step 8, Forms & Documents > Documents.
  Forms remains the adjacent tab at that same step, showing attachment rules,
  stage, form number, title, edition and placement.
- Transaction number, transaction ID, policy version and effective date remain
  pinned through document list, detail, generation and archive actions. There is
  no All transactions selector inside the transaction. Two transactions of the
  same type must never share documents just because both are endorsements or
  issues. Only an explicit read-only policy index may aggregate references.
- Historical/issued transaction views remain read-only. Open existing archives;
  do not regenerate them using the current policy/template. Eligible active
  transaction requests retain that transaction's snapshot and create pending
  generation, not an issue, bind or delivery. Corrective editions require a
  separately authorized linked request.
- Form editions are reached through Administration > Forms > selected form >
  Editions. The form catalog shows current and next editions; the edition table
  separates the business edition (for example 2026-02) from the implementation
  revision (1.4). Selecting an edition opens its details; previous editions are
  read-only. All forms and All editions provide explicit return paths.
- Document operations remain under Administration. Exports remain under
  Reporting. Customer documents remain in the customer portal. Moving between
  these sample contexts is prototype navigation, not a permission switch.
- No backend, policy lifecycle, approval authority or actual application routes
  changed during this design refinement.

The revised smoke test covers transaction-number-to-wizard navigation,
step 8 Forms/Documents tabs, separate issue/endorsement/historical outputs,
read-only original protection, transaction context retention, the administration form catalog, edition
selection/read-only history, existing prototype actions and keyboard navigation.

### Current Implementation Reviewed

- `frontend/src/features/policies/PolicyViewPage.tsx`: the Transactions table's
  transaction-number button calls `handleOpenVersion`, navigating to `/wizard`
  with `policyId`, `versionId`, `transactionNumber`, mode/effective date and
  `readonly=1`. Preserve this entry path; do not invent policy navigation tabs.
- `frontend/src/features/wizard/QuoteWizard.tsx`: step 8 already contains
  Forms and Documents. `documentRows` supplies transaction-view outputs; current
  document handlers include client-generated PDF paths. Embed asynchronous
  status, rendition selection and archive-backed actions here when implementing
  the module, rather than adding another document screen.
- `frontend/src/features/policies/PolicyDocumentsPanel.tsx`: the existing policy
  aggregate already displays Transaction #. Preserve its index/reference role;
  it does not replace the selected transaction's Forms & Documents workspace.
- `server/src/services/document-generation.service.ts`: generation context
  already carries transaction ID/number and version ID. Match these immutable
  identifiers, policy and tenant server-side; display numbers are not keys.
- `frontend/src/App.tsx` routes `/admin/forms` to `FormsManagementPage.tsx`, not
  `FormsAdmin.tsx`. The latter is a different generic field-template editor and
  is not the document-master administration integration target. The active
  management page already has form metadata, jurisdictions, applicability,
  output/template upload, variable reference, delivery/security and preview.
  Consolidate these existing sections rather than building a parallel catalog.
- `server/src/services/forms.service.ts` currently previews explicit product,
  jurisdiction and transaction applicability. Policy-data conditions are now
  implemented in the shared engine; independent package publication gates remain
  separate future work. See the implementation handoff for verification.

The mockup itself does not change application files. Gate B is approved;
application implementation and release evidence are tracked separately.

### Simplified Forms Master Data

The administration catalog is carrier-owned master data. A configuration
combines a form number/edition, product, applicable states and effective window,
file/printing definition, attachment rules, packet placement and visibility.
Do not ask transaction users to upload or choose master templates manually.

The default administration view is one searchable catalog with Product and
State filters. Rows show Form/title, Product/states, Edition, Printing,
Attachment and Status. Add form opens a draft; opening a row shows four tabs:

1. **Details & scope**: form number/title/edition, product, states, effective
   from/through, Static file versus Policy data and customer/internal visibility.
   Use configured product/jurisdiction catalogs in production, not free-text
   codes. An empty state/product scope is incomplete, not implicitly worldwide.
2. **Template**: native file picker, current filename, supported format and
   Check template. Static PDF prints the approved content without merging.
   Policy-data Word/Excel templates resolve approved policy-field bindings;
   fillable PDF is available only for the qualified supported subset. Show
   required fields and sample values beside mappings. Missing/unknown bindings,
   unsupported/unsafe files or mismatched formats block validation/publication.
   Required PDF and optional internal native copies are explicit. No template
   URI entry, SQL, unrestricted scripting or external converter is needed.
3. **Attachment**: transaction-type checkboxes; lifecycle stage; Always or a
   policy-data condition; packet placement/order; copy per policy/risk item;
   required-output flag. Show one plain-language summary. Simple mode uses a
   condition picker; complex carrier rules must use the approved structured
   rule framework/catalog, not hard-coded product checks or an LLM decision.
4. **Test & publish**: synthetic product/state/transaction/effective-date and
   policy-field scenario; Would attach/Would not attach with reasons; print
   preview; Save draft and Submit for review. Edition history, content-review
   evidence and independent technical activation are secondary details, not
   the first screen every form administrator must navigate.

Save & continue guides the first three tabs; it never activates a draft.
Published editions are immutable: Create new edition preserves the old source.
Content review and technical activation remain independent and exact-version
bound. Only approved, effective, explicitly activated carrier configurations
participate in production attachment. Editing invalidates prior test evidence.

At transaction evaluation, resolve product + state + transaction type + stage +
effective date + configured conditions against that transaction's immutable
snapshot. Pin matched form editions, template hashes, rule versions and ordered
placements. Static output retains approved wording; populated output reads that
snapshot, not the latest policy. The existing transaction Forms tab shows the
attached forms and reasons; Documents shows the resulting rendition jobs/files.
Later master-data changes must not alter already-issued transaction documents.
Ambiguous applicable editions/overrides require an explicit error or approved
precedence, never an arbitrary first-match selection.

The prototype demonstrates static PDF, populated Word, populated Excel and a
conditional endorsement. Uploads stay local: only filename/size/extension and
sample mappings are exercised. "Sample checked" and synthetic previews are not
real file parsing, malware scanning, rendering, regulatory approval or publishing.
The two sample conditions are illustrative, not the intended production catalog.
No master-data changes are pushed into live transactions from the mockup.

## User Journeys

1. Agent/underwriter: open the policy's Transactions row, enter that transaction's
   existing wizard and select Forms & Documents > Documents. Select a permitted
   document purpose and output formats only for eligible active work; confirm the pinned transaction/version,
   request generation, then see status and open the published rendition. This
   does not bind, issue or send a notice. Existing lifecycle flows queue their
   configured packages without adding another confirmation to ordinary policy
   processing.
2. Template author: Administration > Forms > selected form > Editions;
   create a draft version, upload allowed assets, select scope and fixtures,
   validate, inspect safe previews, submit for independent content review.
3. Content reviewer/technical publisher: inspect the exact immutable version,
   differences and validation evidence; review or approve within assigned
   authority. A distinct authorized activation action selects target environment
   and effective date. Rejection requires a reason; the author cannot approve
   their own regulated content.
4. Operations: Administration > Operations Dashboard > Document generation;
   filter queue/deadline/errors, open request detail, inspect lineage and safe
   attempts, retry eligible failed work or cancel pending work with confirmation.
   Restore and staging-cleanup controls show eligibility and dry-run evidence;
   there is no delete-original or force-success action.
5. Authorized reporting user: existing reporting/bordereaux context > Export;
   choose supported report type, as-of value, filters and XLSX/optional PDF,
   submit and view reconciliation/partition status. Downloads become available
   only on approved publication. No generic SQL or arbitrary dataset selector.
6. Customer: portal policy > Documents; view only currently authorized,
   published customer-safe renditions and explicitly available history.
   No internal jobs, variables, rating traces, template review or export controls.

## Screen Inventory And Layout

| Screen | Change / navigation | Requirements |
| --- | --- | --- |
| QuoteWizard step 8 Documents | Embed new rendition/status/detail controls in each transaction's existing Forms & Documents step | REQ-1,2,3,7,8 |
| PolicyDocumentsPanel | Preserve read-only transaction-referenced policy index; not a new document workspace | REQ-7,8 |
| Document request detail | Internal detail view from policy/operations row | REQ-3,4,7,10 |
| Form document versions | Extend existing forms administration, not another top-level studio | REQ-1,2,5,8,9 |
| Document operations | Extend existing Operations Dashboard | REQ-4,9,10,11 |
| Export request/results | Existing reporting context and scoped results view | REQ-1,6,8 |
| Customer documents | Extend existing portal section | REQ-3,7,8 |

Transaction Forms & Documents (existing wizard step 8):

```text
Transaction TX-NNN · Policy version N · Transaction effective date
Workflow 1..8 > Forms & Documents       [Forms | Documents]
Documents                          [Generate... if eligible active work]
Name | Stage | Edition | Status | Output / integrity
Dec  | Issue | 2026-01 | Ready  | PDF / DOCX*
Request details: required forms, rendition status, historical/corrected link
* Only if this actor is authorized for the native editable rendition.
```

Generation dialog: document purpose; read-only transaction number/ID, policy version/effective date;
allowed output checkboxes; required outputs shown selected and immutable;
inline/screen checks; Cancel and Generate. Request state remains visible after
closing/reopening. Do not collect domain fields here to bypass policy validations.

Template versions:

```text
Forms > Selected form > Document versions
Version | Owner | Scope/locale | Effective dates | Status | Evidence
Selected version: [Definition] [Preview] [Validation] [History]
Scope and outputs | approved bindings/assets | source/content hash
Validation cases and failures | review/activation history
Actions by authority: Save draft / Validate / Submit / Approve / Activate / Retire
```

Use labeled tabs, not radio controls, for views. Definition is read-only once
submitted/frozen; editing starts a new draft. Preview has a visible Draft label
and uses the approved rendition path, not arbitrary HTML injection. Never
promise inline native Office preview; download is an explicit authorized action.

Operations and detail:

```text
Operations Dashboard > Document generation
Pending | Oldest urgent | Deadlines at risk | Failed | Archive errors
[Search] Status [v] Priority [v] Format [v] Date range [...] [Refresh]
Request | Business reference | Age/deadline | Stage | Attempts | Status
Detail: outputs/dependencies -> attempts -> template/engine versions -> audit
Eligible actions: Retry failed / Cancel pending / Request archive restore
```

Metrics are text/counts, not decorative charts. Distinguish missing telemetry
from zero failures. Refresh does not regenerate. Filters remain in URL/query
state; pagination is server-backed. No PII is shown in global queue summaries.

Export:

```text
Export schedule
Report [approved type v]   As of [date/time]   Scope [read-only + filters]
Formats [x] XLSX [ ] PDF   Checks for this screen
                                      [Cancel] [Export]
Results: Prepared -> Generating -> Validating -> Ready / Failed
Part | Rows | As of | Reconciliation | Status | Download
```

Customer documents: a compact list of title, issue/effective date and explicit
edition/history labels with Download only for published safe content. Where
authorized by the portal contract, pending requests show only "Preparing
documents"; failures show "Document unavailable. Contact your carrier."
Unknown or withdrawn states never enable download.

## Shared Components

Each working section uses CollapsibleSection. Use StatusBadge, SearchInput,
FilterSelect, TablePagination, Checkbox, FieldError, EmptyState, Toast and
ActionButton; existing accessible dialog patterns trap/restore focus. Radio
choices such as current/historical selection in a form use RadioGroup; actual
view switches use tabs. No new generic component library is proposed.

Use existing carrier logo/colors and `--ps-*` tokens in both themes. Tables in
horizontal scroll wrappers use `table-no-sticky-head`. Do not nest decorative
cards or create a standalone marketing/agent studio screen for document work.

## States And Wording

| Condition | Display / interaction |
| --- | --- |
| Empty list | Contextual EmptyState; Generate/Export only when permitted |
| Loading | Stable table layout, loading indicator, no layout jump or duplicate submissions |
| Pending/processing/retry/validation | Text badge and safe progress; disabled artifact action; bounded polling only while active |
| Review required | Explicit Review required badge; authority-specific action, no automatic approval |
| Ready | Download/Open per rendition authority and publication status |
| Failed | Actionable safe error and trace reference; retry only if eligible/authorized |
| Validation problem | FieldError beside input and checks panel; focus summary on submit |
| Permission denied | No data leak or management controls; clear denial on direct navigation |
| Historical/superseded | Edition and replacement link; never presented as the latest contract |
| Unknown capability/status | Unavailable, fail closed; no green-success fallback |
| Missing/long data | Em dash substitute is not required; use '-'; wrap names, bounded identifier column, full value accessible |

Command labels: Generate documents, Export, Validate version, Submit for review,
Approve content, Activate version, Retry failed request, Cancel request.
Activation confirmation identifies exact version/hash, environment, scope and
effective date. Retry states "Retry the failed request using its recorded
inputs?" Cancellation states that already-issued copies are not deleted.
Do not use success toasts for acceptance: "Generation requested" is different
from "Documents ready" and neither means "Delivered".

## Accessibility And Responsive Behavior

Meet WCAG 2.2 AA using the existing design system. Keep logical keyboard order,
visible focus and unique accessible names (including artifact title/format).
Icons have tooltips; status never relies only on color. Error summaries announce
through alerts; asynchronous status uses polite, deduplicated announcements,
not every polling tick. Dialogs trap focus, support Escape/cancel and restore
focus to the invoking control. Disabled-action reasons remain readable.

Desktop uses restrained full-width work sections and dense scan-friendly tables.
At 390px, fields stack, command rows wrap and tables scroll only inside their
container; no horizontal page overflow. Preserve minimum accessible touch targets,
text at zoom, long-word wrapping, reduced-motion preference and light/dark contrast.
Do not change font size based on viewport width to hide overflow.

Add every new route/view to `e2e/ui-section-standards.spec.ts`; retain shared
radio source audit and run browser layout/keyboard checks on these screens.

## Requirement Mapping

| Requirement | Screen/elements |
| --- | --- |
| REQ-1 | Policy output selectors/status; export results; template capability validation |
| REQ-2 | Packet detail required-form/page list and preview evidence |
| REQ-3 | Pending/failed/review badges, disabled downloads and readiness distinctions |
| REQ-4 | Operations age/priority/deadline view; nonblocking policy status |
| REQ-5 | Version/review/activation/history screens and independent authority actions |
| REQ-6 | Scoped export form, as-of value, partition results and reconciliation |
| REQ-7 | Current/history selection, edition labels and corrective lineage |
| REQ-8 | Portal-safe views, denied states, role-specific commands and backend checks |
| REQ-9 | Template compatibility/evidence detail; release controls remain operator-reviewed |
| REQ-10 | Operations attempts, safe errors, retry/cancel/restore eligibility |
| REQ-11 | Accessibility/viewport checks and visible qualification evidence, never fabricated green state |
