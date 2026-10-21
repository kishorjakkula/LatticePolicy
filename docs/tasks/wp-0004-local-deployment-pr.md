# WP-0004: Local Docker Deployment And PR Preparation

## Request

On 2026-10-21 the maintainer requested deploying the latest code to local
Docker, running regression testing and opening a PR if checks pass. This is
an explicitly requested local development preview, not approval of Gate C,
formal merged-main staging or production deployment.

## Integration Decisions

- Preserve existing local PostgreSQL, Redis and document volumes. Do not run
  mutation tests against the demo or carrier pilot. Browser regression uses
  the isolated Docker stack; database integration uses a fresh disposable DB.
- The local database already recorded `067_agent_studio.sql` and
  `068_agent_runs_promotion.sql`. Move referral evidence to migration **069**
  instead of silently skipping it. No existing migration records or Agent
  Studio tables are changed. `/version` now reports applied/release 69 and
  `schemaAhead: false`; legacy referral evidence stays null.
- Integrate current `origin/main` (`e218c94`), preserving phase-one fixes and
  #387's intent: no silent loss of entered quote data. In the newer approved
  product-first flow, only compatible companies are offered and switching
  among them preserves product/state/answers/risks/limits/common fields while
  invalidating rated output. Actual product changes still require confirmation
  before clearing product-specific data. A defensive incompatible-company
  fallback also retains its confirmation.
- Preserve the main form-metadata document title regression and the newer
  responsive pager/dialog/theme behavior. Keep unrelated local research and
  generated files out of the commit/PR.

## Verification

In progress. Final checks, local preview image identities and PR link will be
recorded before handoff. Existing scoped independent review is in the WP; an
independent merge-resolution review is also requested. Never merge this PR or
record a human approval on the maintainer's behalf.
