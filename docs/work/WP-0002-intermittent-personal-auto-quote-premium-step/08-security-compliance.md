# Security and compliance — WP-0002

> Security and compliance agent. Diff reviewed: `git diff origin/main...HEAD -- server frontend e2e` on `latticepolicy/wizard-coverage-leak`.

| Check | Result | Notes |
| --- | --- | --- |
| Tenant isolation and RLS | pass | The coverage report runs both queries inside `withTenantTx` (RLS role under `TENANT_RLS_ENFORCED=1`), with `tenant_id = $1` filters and the snapshot lookup scoped to the same tenant. `POST /quotes` loads the policy through `loadPolicyContext(db, tenantId, policyId)` inside `req.tx`, so another tenant's policy id finds nothing. Integration test: report isolation with bad records in both tenants (neither sees the other's). |
| Server-side authorization | pass | `GET /admin/dashboard/coverage-integrity` is mounted under `requirePermission('admin.dashboard.read')` (admin.routes.ts:114); integration test: agent 403, admin 200. `POST /quotes` keeps its existing permission. The new `policyId` parameter grants nothing: it only lets carried codes through for a policy transaction on the same product, and bind/issue/lifecycle services still re-check on their own. |
| Customer-safe projections | not applicable | No customer portal route or projection changed. Coverage errors name the coverage code and product label only. |
| Input validation and injection | pass | `policyId` must pass `isUuidLike` and is bound as a parameter; `transaction` is normalised through the shared vocabulary. Report SQL: the interpolated pieces are fixed aliases chosen in code; the per-product code set (built from product definitions and snapshots) is a bound `jsonb` parameter; snapshot ids are compared as text, so malformed pins cannot raise cast errors. The expensive report has its own rate limit (30 per 15 minutes) and a 500-row result cap. No CSV or file output. |
| Secrets and sensitive logging | pass | No new logging, secrets or configuration. The report returns record ids, numbers, product, status and coverage codes, with no insured names or payload. |
| Audit (AI vs person actions) | pass | The change adds refusals and a read-only report; no data is written, so there is no new audit event. Refused rate/bind/issue attempts leave the record unchanged, as before. Audit tables untouched. No AI involvement. |
| AI data boundary | not applicable | No AI or LLM path changed. |
| Regulatory (filings, notices, disclosures, privacy) | pass | Enforces the filed product definition: a quote or policy can no longer be rated, bound or issued with coverages the product version does not offer. No rate or form changes. In-force policies already carrying undefined codes are not modified: the report lists them for the carrier, because correcting one may need an endorsement and notice to the insured (REQ-5). Cancellation and reinstatement keep the policy's existing coverages, so servicing is never blocked by legacy data. |
| Code scanning and dependency results | TODO(agent) | No dependency, Dockerfile or workflow changes in the diff. CodeQL, dependency review and container scan results to be recorded from the PR's CI run. |

## Findings

| Severity | Finding | Resolution | Outcome |
| --- | --- | --- | --- |
| low | Before the re-review fixes, any tenant policy id let a new-business rating carry that policy's codes (07-code-review.md row 25). Within one tenant only, and bind refused the result. | Fixed in 88b06a4: carried codes only for a policy transaction on the same product; integration test. | fixed |
| low | Malformed `policyId` could raise a database cast error (500) (07-code-review.md row 26). | Fixed in 88b06a4 with `isUuidLike`; integration test. | fixed |
