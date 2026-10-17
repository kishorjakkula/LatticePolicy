# LLM Authorization Renewal

## Summary

Add explicit carrier-admin renewal for receipts subject to the operator and
processor's lifetime policy. No schema, dataset, pipeline, or deployment changes.

## Important Files

- `server/src/services/llm-release.service.ts`: `renew-authorization` action.
- Service unit tests and `server/src/__tests__/llm-releases.integration.test.ts`:
  guarded renewal, real persistence and API/audit verification.
- `frontend/src/features/admin/LlmReleasesPage.tsx` and its component tests:
  separate renewal attestation and current receipt download after refetch.
- `docs/LLM_RELEASE_GOVERNANCE.md`: expiry/revocation/renewal contract.

## Behavior Rules

- Accept only strict `{attestation:true}` and current active technical admins;
  keep the existing tenant and maker/checker checks and row lock.
- Only `IN_VALIDATION` renews validation; only `PRODUCTION_AUTHORIZED` renews
  production. Never change status, artifacts, validation evidence, validated-by,
  or original production approved-by. The new receipt identifies its renewing
  admin in approvedBy and preserves the validation report hash.
- Audit renewal environment, attestation, artifact digest, old/new approvedAt,
  actor and status. Fresh signatures do not deploy or override revocation.
- Runtime expiry defaults to seven days, configurable up to one year. This
  action does not add a competing server-side lifetime policy.
- Sign payload keys recursively in PostgreSQL JSONB storage order so initial
  and renewed v1 receipts remain verifiable after persistence and list/download.
  The signature protocol is unchanged: exact serialized payload bytes are signed.
  Integration verifies both initial and renewed persisted/listed signatures.

## Validation

- Focused server unit, frontend component, PostgreSQL integration suites.
- Root `npm run typecheck`; server `tsc -p tsconfig.json --noEmit`.
- `git diff --check`.

Focused results: 32 service unit tests, 13 component tests, 10 PostgreSQL
integration tests passed; workspace and explicit server typechecks passed.

## Limits

Renewal does not recall existing receipts, clear the carrier revocation file,
prove test execution, or activate a deployment. Operators must distribute and
reactivate the downloaded receipt. Existing SMTP opt-in behavior is unchanged.
