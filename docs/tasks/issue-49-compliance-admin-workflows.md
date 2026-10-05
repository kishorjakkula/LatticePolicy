# Task Note: Compliance Admin Workflows (OFAC And State Eligibility)

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/49
- Pull request:

## Summary

Added an administrative layer on top of the existing OFAC screening and
product/state eligibility backend logic (`server/src/lib/policy-compliance.ts`).
Admins can now maintain `product_state_eligibility` records through an API/UI,
import OFAC SDN entries for local/demo use, and review and disposition OFAC
potential hits with an audit trail. Eligibility and OFAC disposition decisions
now genuinely drive quote/bind-time enforcement instead of only being
readable in the database.

## Important Files

- `server/src/routes/compliance-admin.routes.ts`: eligibility CRUD, OFAC SDN
  list import, and OFAC screen review/disposition endpoints.
- `server/src/routes/admin.routes.ts`: mounts the compliance router at
  `/api/v1/admin/compliance`, gated by `admin.compliance.read`.
- `server/src/lib/policy-compliance.ts`: `screenOfac` now checks for a prior
  `CLEARED`/`BLOCKED` disposition on the same normalized party name before
  screening, so a reviewer's decision carries forward to future bind attempts
  instead of being re-evaluated (and re-blocked) from scratch every time.
  `normalizeOfacName` is now exported for reuse by the SDN import endpoint.
- `server/migrations/039_compliance_admin.sql`: adds `normalized_party_name`
  and `disposition_reason` to `ofac_screens` (no new tables — the existing
  `product_state_eligibility`, `ofac_sdn_list`, and `ofac_screens` tables from
  migration 031 already modeled everything else this issue needed).
- `server/src/lib/rbac.ts` / `frontend/src/auth/permissions.ts`: added
  `menu.admin.compliance.view`, `page.admin.compliance.view`,
  `admin.compliance.read`, `admin.compliance.manage`; granted to `admin` and
  extended the existing `compliance_admin` role (previously forms-filing-only).
- `frontend/src/features/admin/CompliancePage.tsx`: minimal admin UI —
  eligibility list/create/status-change, and an OFAC review queue with
  Clear/Escalate/Block actions (reason required, entered via prompt).

## Behavior Rules

- `product_state_eligibility` has no tenant/product/state record → blocked by
  default (existing "not configured" safety fallback, unchanged).
- Eligibility writes require `admin.compliance.manage`; reads require
  `admin.compliance.read`. Both are tenant-scoped through the existing
  `withTenantTx` + RLS pattern.
- The OFAC SDN list (`ofac_sdn_list`) is a global sanctions reference, not
  tenant-scoped — import is a local/demo-friendly bulk upsert of caller-supplied
  entries, intentionally not a live external sanctions feed integration.
- `screenOfac` disposition carry-forward:
  - Prior `BLOCKED` for the same normalized party name → next screen is
    reported as `CONFIRMED_HIT` (bind stays blocked) even if the fuzzy-match
    step alone would come back clear.
  - Prior `CLEARED` for the same normalized party name → a fresh
    `POTENTIAL_HIT` match is downgraded to `CLEAR` (bind proceeds), but the
    match details are still recorded for audit.
  - `CLEARED` and `BLOCKED` dispositions require a `reason`; `reviewed_by` and
    `reviewed_at` are set automatically from the acting admin user.
- Compliance hold reasons already surface to callers through the existing
  `OFAC_BLOCKED` / `OFAC_REVIEW_REQUIRED` / eligibility-block error responses
  in `quote-bind.service.ts` and `policy-compliance.ts` — this change did not
  need to add new surfacing, only make the underlying decision data
  maintainable and reviewable.

## Automated Tests

- Tests added or updated:
  - `server/src/__tests__/compliance-admin.integration.test.ts` (new, 4 tests):
    eligibility CRUD driving `checkStateEligibility`, RBAC denial for a
    non-manager role, OFAC review queue + CLEARED carry-forward, and BLOCKED
    carry-forward.
  - `frontend/src/features/admin/__tests__/CompliancePage.test.tsx` (new, 4
    tests): eligibility list rendering, create-form submission, OFAC queue tab
    + Clear disposition, and cancel-prompt no-op.
- Test layer used: DB-backed integration tests (server) and component tests
  (frontend).
- Why this layer is enough: eligibility/OFAC enforcement crosses persistence
  and tenant-RLS boundaries, so a real Postgres integration test is the
  cheapest layer that actually proves the carry-forward behavior; the admin UI
  is covered at the component layer with mocked hooks.

## Validation

```bash
npm run build
npm run test
npm run typecheck
DATABASE_URL=postgres://lattice_policy:test_password@127.0.0.1:<port>/lattice_policy_test \
  npx vitest run --config server/vitest.integration.config.ts
```

All of the above were run against a disposable local `postgres:15` Docker
container in this environment (no `DATABASE_URL` was pre-set) and passed:
61 frontend unit tests, 89 server unit tests, 16 server integration tests
(including this issue's 4 new tests), and a clean `tsc` typecheck.

## Follow-Ups Or Risks

- OFAC import is intentionally local/demo-scoped per the issue; a real
  scheduled feed integration (e.g. Treasury's published SDN file) is a
  separate future task.
- The admin UI uses `window.prompt` for disposition reasons to stay minimal;
  a dedicated reason/comment form would be a natural follow-up if this page
  sees real usage.
- `RouteGuards.tsx` default-landing-page redirect logic was not extended for
  the new compliance page (low-priority section ordering only, not an access
  control gap — `RequirePermission` on the route itself is what enforces
  access).
