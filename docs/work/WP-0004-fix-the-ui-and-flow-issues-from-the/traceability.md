# Traceability — WP-0004

Implementation/test map for the combined checkout. Phase 1 evidence is retained
in `05-implementation.md`/`07-code-review.md`; latest combined results are in
`06-unit-tests.md` and `09-automation-tests.md`. No release or business sign-off
has been granted for this combined change.

| Requirement | Design | Code | Tests | Release | Validation |
| --- | --- | --- | --- | --- | --- |
| REQ-1 | 02-design + 02a extension, 03 UI, 04 tests | UW detail/routes/gate; proposal helper; Migration 069; four transaction services | UwReferralDetail; referral-proposal; uw-referral-gate; policy-referral-http.integration; uw-referrals E2E | Gate C pending | Human sign-off pending |
| REQ-2 | 02/03/04 | Shared Dialog; user/customer/form/compliance/placement actions | Dialog; scoped dialog components; admin/placement E2E | Gate C pending | Human sign-off pending |
| REQ-3/4/7 | Phase 1 design | Policy header; shared display/date helpers; policy/customer/document views | PolicyViewPage.header; display/date helpers; policy-lifecycle/transaction-documents E2E | Phase 1 history; combined Gate C pending | Human sign-off pending |
| REQ-5 | 02/03/04 | AppNav/useWorkCounts; AdminHomePage/AdminShell | AppNav/useWorkCounts/AdminHomePage; role-access and admin E2E | Gate C pending | Human sign-off pending |
| REQ-6 | 02/03/04 | Shared pager/disclosure/buttons; token styles | TablePagination/Dialog; color-token guard; UI-section/accessibility E2E | Gate C pending | Human sign-off pending |
| REQ-8 | 02/03/04 | QuoteWizard; wizard-stepper | QuoteWizardStepOrder; quote-wizard/qualification-alignment E2E | Gate C pending | Human sign-off pending |
| REQ-9 | 02/03/04 | SubmissionReviewPage | SubmissionReviewPage; submission-intake E2E | Gate C pending | Human sign-off pending |
| REQ-10 | 02/03/04 | CompliancePage/SecurityPage; compliance-admin bulk API | Component suites; compliance-bulk.integration; admin E2E | Gate C pending | Human sign-off pending |
| REQ-11 | 02/03/04 | DashboardPage/WorkList/model | DashboardPage/model; timezone boundaries; dashboard E2E | Gate C pending | Human sign-off pending |
| REQ-12/13 | Phase 1 + 02/03/04 | Policy actions/transactions; SearchPage | Policy/search components; policy-lifecycle/dashboard-search E2E | Gate C pending | Human sign-off pending |
| REQ-14/15 | 02/03/04 | Responsive search/pager/wizard/submissions; accessible dialogs; theme tokens | UI-flow-accessibility/business-mobile; qualification; referral screenshots | Gate C pending | Human sign-off pending |
| REQ-16 | 02/03/04 | AST color token guard | color-tokens; native-dialogs | Gate C pending | Human sign-off pending |
| REQ-17 | 02/03/04 | UwQueue; server list/sort/assignment | UwQueue; referral-sort/routes/integration; uw-referrals E2E | Gate C pending | Human sign-off pending |
| REQ-18 | Phase 1 design | Forms management rows/actions | FormAttachmentEditor/FormsManagementPage; forms-management E2E | Gate C pending | Human sign-off pending |
| REQ-19 | 02/03/04 | AiAuditPage; ai-audit API/service | AiAuditPage.phase3; ai-audit-phase3 unit/integration; screen audit E2E | Gate C pending | Human sign-off pending |
