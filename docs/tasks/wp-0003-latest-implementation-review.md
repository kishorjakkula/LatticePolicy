# WP-0003 Latest Implementation Review

Reviewed local uncommitted forms-master/rules/transaction-archive changes over
HEAD `25606a0`. This is a review, not authorization to fix findings, merge or
declare the broader enterprise document module complete.

## Findings

1. **P1 - Required jurisdiction approval can be bypassed in generation.**
   `server/src/services/document-generation.service.ts:383-406` left-joins an
   effective state approval but skips regulatory checks when no state row joins.
   An approved active form requiring approval, with only NY approval, can attach
   to a CA transaction. Expired approval has the same problem. Preview excludes
   the form. Existing HEAD behavior retained by this implementation.

2. **P1 - Bind/Issue applicability is not stage-correct.**
   `server/src/services/document-generation.service.ts:122-137` maps Issue to NB
   but not Bind. Bind passes NB: Bind-only forms are omitted and Issue-only forms
   can attach at bind. Use separate business transaction and lifecycle-stage
   matching consistently in preview and generation. Existing HEAD behavior.

3. **P1 - Approved locked forms cannot be activated through the UI.**
   `frontend/src/features/admin/FormsManagementPage.tsx:262-264,843` ties all
   lifecycle actions to content editability. Approval with default editLock=true
   disables Activate and Deactivate even for an authorized compliance admin.
   Separate authoring, review and activation permissions/state guards. This
   existing defect remains in the redesigned Test & publish workflow.

4. **P2 - Endorsement preview ignores change criteria.**
   `server/src/services/forms.service.ts:291-294` does not load/evaluate
   endorsement_change_criteria, while generation checks them at
   `document-generation.service.ts:404-405`. A form requiring added COLL can be
   previewed for an email-only change but omitted from the generated packet.
   Existing behavior retained; the shared expression engine alone does not
   establish whole-selector parity.

5. **P2 - New catalog filters hide legacy/global scope.**
   `frontend/src/features/admin/FormsManagementPage.tsx:123-125` requires explicit
   product/state arrays. The new list projections include only child rows
   (`server/src/routes/forms-admin.routes.ts:150-152`), not the generator's
   line-of-business fallback or permitted unscoped/nationwide configurations.
   Such forms disappear when filtering even though they can apply.

6. **P2 - Quote preview fabricates Bound policy status.**
   `frontend/src/features/wizard/QuoteWizard.tsx:186` assigns Bound for NB at both
   Quote and Bind stages. A not-yet-bound quote can therefore match a condition
   requiring policy.status == 'Bound'. Keep quote facts distinct from bind facts.

7. **P2 - Default Docker integration runner lacks its PDF browser.**
   `scripts/test-integration.sh:42-54` runs in node:22-alpine without provisioning
   Chrome/Chromium or a persistent browser cache. Full run: 222 passed/30 failed;
   renderer-dependent failures report missing Chrome, with downstream import/
   concurrency assertion failures. Provision the browser/dependencies in the
   test image; do not relax application assertions. Existing runner defect.

## Verification

- Independent fresh read-only reviewer confirmed backend findings 1, 2 and 4;
  compared them against HEAD and performed direct selector reproductions.
- Parent reviewed UI action guards, scope projections and quote-status mapping.
- Full Playwright report: **144 passed, 0 failed, 0 flaky, 0 skipped**.
- Latest local unit suites: shared rules 209, frontend 354, server 723 passed.
- Document processor 19 passed/1 optional OCR smoke skipped; signer 3 passed;
  document learning 20 passed.
- Npm audit policy passed with four explicitly allowlisted transitive advisory
  packages; this is not a zero-advisory claim.
- Default Docker integration run: **222 passed, 30 failed**.
- Full local-browser integration rerun against a fresh disposable PostgreSQL
  database: **252 passed, 38 files, 0 failures**. No application change or relaxed
  assertion was required. The fixture database was removed afterward. This
  distinguishes the default Docker runner provisioning failure from application
  regression execution; it does not invalidate the code-review findings.

The latest source is deployed only to the local Docker stack at UI 5173/API
3300. Health confirms DB/cache connectivity. No application fixes were made in
this review. Test-install-only package-lock metadata churn was removed.

## Readiness

Do not treat green browser tests as carrier release acceptance. The P1 findings
need fixes and targeted negative/workflow regressions. The approved independent
coordinator, bounded workers, real-page packet assembly, Excel/fillable-PDF,
package governance, restore and load/soak qualification remain development scope.
