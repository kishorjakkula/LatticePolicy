# Release — WP-0002

- Revision / version: `main` at 25606a0 (PR #385); application version unchanged.
- Migrations: none. Forward-only note: the shared local staging database also
  carries 067 and 068 (`067_agent_studio.sql`, `068_agent_runs_promotion.sql`)
  applied 2026-10-18 04:12 UTC from uncommitted work in another worktree; `main`
  ends at 066. This change reads none of those tables.
- New configuration (names only): none. The Coverage Integrity report uses the
  existing `admin.dashboard.read` permission and its own route rate limit.
- Rollback: revert PR #385. No data, migration or configuration to undo;
  existing quotes and policies were not modified. After a revert, rating,
  binding and policy changes stop checking coverage codes against the product,
  and the wizard's stale-configuration guard is removed.

## Release notes

- Personal auto quotes no longer show homeowners coverages on the Premium step
  when the agent switches products while the product configuration is loading.
- Rating, binding, issuing and every policy change now refuse a coverage the
  product does not offer, with `422` naming the coverage to remove
  (for example "Coverage END_WB is not offered by Personal Auto"). Policy
  changes keep coverages already on the policy but cannot add undefined ones.
- Changing the product on a quote with entered data asks for confirmation first.
- New read-only **Coverage Integrity** panel on the Operations Dashboard lists
  quotes and policies that already carry coverages outside their product, so
  they can be corrected (`GET /api/v1/admin/dashboard/coverage-integrity`).

## Deployments

| Environment | When | Revision | Health | By |
| --- | --- | --- | --- | --- |
| staging (local Docker stack built from `main`) | 2026-10-19 00:19 UTC | 25606a0 | `/health` ok (db, cache), UI 200, all four containers up, no startup errors; coverage-integrity route and panel present in the built images | Deployment agent |
| production | after Gate D | — | — | — |

The previous staging build (2026-10-18 16:28 UTC) came from the PR branch in the
`submission-intake` worktree; it was rebuilt from the `main` checkout. The
separate `lattice-acme-pilot` stack was not touched.

Design drift noted for the knowledge curator: `02-design.md` names the report
`/api/v1/admin/coverage-integrity`; the shipped route is
`/api/v1/admin/dashboard/coverage-integrity`.
