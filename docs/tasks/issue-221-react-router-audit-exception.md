# Task Note: Track And Remove React Router Audit Exception

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/221
- Pull request: https://github.com/kishorjakkula/LatticePolicy/pull/236

## Summary

Issue #221 asked us to revisit the temporary React Router npm audit exception and
remove it once a safe patched release existed. Investigation showed the exception
had already been partly retired, and that the advisory itself no longer applied.

`GHSA-qwww-vcr4-c8h2` ("React Router: RSC Mode CSRF Bypass Allows Action Execution
Before 400 Response", high) affects `react-router` `>= 7.12.0, < 7.18.2` and was
**first patched in `7.18.2`**. The repository was already pinned to `7.18.2`, so
the advisory had stopped applying before this issue was filed. That is why
`npm audit` already reported zero vulnerabilities.

This change bumps `react-router-dom` to `7.18.3` (a further patch release on the
same already-patched line), and removes the last stale exception surface.

## Important Files

- `frontend/package.json`: declares `react-router-dom`; bumped `^7.18.2` -> `^7.18.3`.
  This is the only workspace that depends on React Router.
- `package-lock.json`: root workspace lockfile is the source of truth for audits;
  updated `react-router` and `react-router-dom` to `7.18.3`.
- `.github/workflows/security.yml`: the dependency-review step still carried
  `allow-ghsas: GHSA-qwww-vcr4-c8h2` and has been removed. Code review on this
  PR also caught that the same step had `continue-on-error: true`, which meant
  removing the allowlist alone would not have changed anything: a genuinely
  high-severity dependency introduced by a future PR would still fail this
  step internally, but `continue-on-error: true` swallows that failure and the
  job reports overall success regardless. Removed `continue-on-error: true` so
  `fail-on-severity: high` is an enforcing setting again, not a cosmetic one.
- `scripts/check-npm-audit.mjs`: `allowedAdvisories` was **already** an empty set
  (emptied in `ac2d23a`, #139). No change was needed here.
- `docs/OPEN_SOURCE_READINESS.md`: "Remaining Security Work" now records the
  retired exception with current package and advisory context.

## Behavior Rules

- React Router is used as a Vite client-side SPA router. The project does not
  enable React Router RSC / framework server actions, which is why the RSC-mode
  advisory was low-impact here even while it applied.
- Both exception surfaces must stay empty unless a new exception is deliberately
  documented in `docs/OPEN_SOURCE_READINESS.md`:
  1. `allowedAdvisories` in `scripts/check-npm-audit.mjs`
  2. `allow-ghsas` on the dependency-review step in `.github/workflows/security.yml`
  Emptying only one of the two leaves a silent, stale exception in CI, which is
  exactly the gap this issue surfaced.
- Dependency declarations belong in the workspace that imports them. React Router
  must not be declared in the root `package.json`; the root is a workspace root
  and a second range there would drift from `frontend/`.
- No downgrade was taken, so no older high-severity advisories were reintroduced.

## Automated Tests

- Tests added or updated: none.
- Test layer used: existing frontend component tests (23 files / 101 tests), which
  already cover routed pages and route guards, plus the existing server suite.
- Why this layer is enough: this is a patch-level dependency bump plus CI and
  documentation changes with no product behavior change. The existing routed-page
  and route-guard coverage is what would regress if the router upgrade broke
  anything, and it passes unchanged.

## Validation

```bash
npm run security:audit
npm run test
npm run typecheck
npm run build
```

Results on this branch:

- `npm run security:audit`: pass, exit 0, "npm audit completed with no unapproved
  vulnerabilities". `npm audit --audit-level=info` reports 0 vulnerabilities.
- `npm run build`: pass, exit 0 (frontend Vite build and server `tsc`).
- `npm run typecheck`: exit 0, but see Follow-Ups. It is currently a no-op.
- `npm run test`: could not run the sanctioned path locally. `scripts/test.sh`
  routes to Docker on Node != 20, and the local Docker socket denied the
  connection. Suites were run directly instead:
  - frontend: 23 files / 101 tests passed.
  - server: 249/249 passed under `TZ=UTC`. Under a non-UTC local timezone,
    `src/lib/__tests__/date.utils.test.ts` fails on `coerceDateOnly('July 4, 2026')`.
    This is a pre-existing timezone artifact unrelated to this change; CI runs UTC.

## Follow-Ups Or Risks

- **Branch protection does not require the "Dependency Review" job to pass.**
  `main`'s required status checks currently list only `Build, Test, Typecheck`.
  Even with `continue-on-error: true` removed, a failing dependency-review
  step does not by itself block a merge unless the job is also added to the
  branch protection required-checks list. That is a repository settings
  change, not a file in this diff, and is deliberately left as a follow-up
  for a maintainer to apply rather than changed here.
- `npm run typecheck` is currently a **no-op**. The root script is
  `npm run typecheck --workspaces --if-present`, and no workspace defines a
  `typecheck` script, so it exits 0 without checking anything. Server types are
  in practice only checked via `npm run build` (`tsc -p tsconfig.json`). Worth a
  separate issue; it is out of scope here.
- `server/src/lib/__tests__/date.utils.test.ts` is timezone-dependent and fails
  outside UTC. Pre-existing; worth a separate issue.
- Historical task notes (`docs/tasks/consolidated-dependency-fixes.md`,
  `docs/tasks/issue-102-v0.2.0-release-readiness.md`) and the `0.2.0` CHANGELOG
  entry still describe the exception as active. These were left unchanged on
  purpose: they are point-in-time records. `docs/OPEN_SOURCE_READINESS.md` and the
  `[Unreleased]` CHANGELOG section carry the current status.
- `docs/GITHUB_SECURITY_ISSUE_DRAFTS.md` lists a different, older React Router
  advisory set and is a drafts file, not live policy. Left unchanged.
