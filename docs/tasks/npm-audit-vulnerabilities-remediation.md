# Task Note: npm Audit / Dependabot Vulnerability Remediation

## Links

- GitHub Dependabot alerts: https://github.com/kishorjakkula/LatticePolicy/security/dependabot
- Pull request:

## Summary

Resolved every open Dependabot alert on `server/package-lock.json` and
`frontend/package-lock.json` as of this change. Before writing any fix, each
alert's `vulnerable_version_range` was cross-checked against the actually
installed version in the relevant lockfile (via the GitHub API, not just the
alert summary text). This found several alerts already resolved by a
Dependabot security-update commit that landed on `main` mid-session
(`fast-uri`, `brace-expansion` in `server/`) and one stale alert
(`path-to-regexp`, whose flagged range `< 0.1.13` does not match the actually
installed `8.4.2`, a different major line entirely). Those were left alone.
The remaining genuinely-vulnerable packages were fixed below.

## Root cause: two extra lockfiles, not the workspace root

GitHub's dependency graph scans `server/package-lock.json` and
`frontend/package-lock.json` directly — not the root `package-lock.json`.
These two lockfiles are **not** kept in sync by a normal `npm install` run
from the repo root; that command treats the whole repo as one hoisted
workspace and writes only to the root lockfile. To reproduce what Dependabot
itself does (and what a real `npm ci` inside `server/` or `frontend/` alone —
e.g. a Docker build stage — would use), each subdirectory's lockfile has to be
regenerated with `npm install --prefix <dir> --no-workspaces`, which forces
npm to resolve that directory as if it had no parent workspace. The root
`package-lock.json` was then also regenerated with a normal root-level
`npm install` so the two stay consistent with the same `package.json` changes.

## Fixes Applied

### `server/` (server/package.json, server/package-lock.json)

| Package | Before | After | Type | Fix approach |
|---|---|---|---|---|
| `uuid` | 8.3.2 | 11.1.1 | transitive (via `exceljs`) | Added `overrides: { "exceljs": { "uuid": "11.1.1" } }`. Same override already existed at the workspace root, scoped as `"exceljs@4.4.0"` there — that version-pinned selector syntax is invalid when `exceljs` is also a *direct* dependency of the same `package.json` (npm's `EOVERRIDE` conflict), so the plain nested form was used here instead. `exceljs` only calls `uuid.v4()` internally; that API is stable across 8.x–11.x. |
| `form-data` | 4.0.5 | 4.0.6 | transitive (via `superagent`, dev/test only) | Added `overrides: { "form-data": "4.0.6" }`. Satisfies superagent's own `^4.0.5` range. |
| `yaml` | 2.8.2 | 2.9.0 | direct | Bumped via `npm install yaml@2.8.3` (fix version); npm resolved the latest matching release, 2.9.0, and updated `package.json`'s floor to `^2.8.3` accordingly. Used directly in `server/src/lib/products.ts` via a plain default import — no API surface used here changed between 2.8.x and 2.9.x. |

`fast-uri` and `brace-expansion` in `server/` were already fixed by
Dependabot's own security-update commits (`#188`, `#189`) before this branch
started; `path-to-regexp`, `postcss`, `body-parser`, and `qs` alerts on
`server/package-lock.json` were already stale (installed versions outside the
flagged vulnerable ranges) and needed no action.

### `frontend/` (frontend/package.json, frontend/package-lock.json)

| Package | Before | After | Type | Fix approach |
|---|---|---|---|---|
| `jspdf` | 4.2.0 | 4.2.1 | direct | **Critical** (HTML injection in "New Window" output) + High (PDF object injection via `FreeText` color). Bumped via `npm install jspdf@4.2.1 --legacy-peer-deps` (see note below on the peer-dep flag). Checked actual usage in `QuoteWizard.tsx` / `CustomerPortalPage.tsx`: only `doc.text(...)`/`doc.output('blob')` calls are used, not the vulnerable `.html()`/`newwindow` output path, so this codebase was not actually exploitable via the Critical GHSA — patched anyway since it's a same-minor patch release with no API risk. |
| `dompurify` | 3.3.1 | 3.4.14 | **was undeclared, now direct** | 18 Low/Medium alerts. `dompurify` was never listed in `frontend/package.json` at all — it only resolved because it's an *optional* dependency of `jspdf` (`^3.3.1`). But `frontend/src/lib/pdf.ts` imports it directly (`await import('dompurify')`) as a `loadDomPurify()` helper. Relying on an undeclared transitive/optional resolution for code that imports it directly is fragile, so it was added as an explicit `"dompurify": "^3.4.13"` dependency — this is a correctness fix bundled with the security fix, not scope creep, since the vulnerable package *is* the one the app code touches. Note: `loadDomPurify()` is currently exported but not called anywhere in the app (dead code) — flagged as a follow-up below, not fixed here. |
| `postcss` | 8.5.6 | 8.5.23 | transitive (via `vite`, dev) | Added override. |
| `ws` | 8.19.0 | 8.21.0 | transitive (via `jsdom`, dev) | Added override. |
| `picomatch` | 4.0.3 | 4.0.4 | transitive (via `fdir`/`tinyglobby`/`vite`/`vitest`, dev) | Added override. |
| `@babel/core` | 7.29.0 | 7.29.6 | transitive (via `@vitejs/plugin-react` + babel helper packages, dev) | Added override. |
| `fast-uri` | 3.1.0 | 3.1.5 | transitive (via `ajv`) | Added override. |

The `jspdf@4.2.1` install required `--legacy-peer-deps` because of a
**pre-existing, unrelated** peer-dependency mismatch: `@vitejs/plugin-react@5.1.4`
declares `peerDependencies.vite: "^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0"`, but
this project already runs `vite@^8.2.1`. That conflict exists on `main`
independent of this change (a bare `npm install` only warns about it; a
targeted single-package install errors on it by default) and was left alone —
fixing it is out of scope for a security patch and risks destabilizing the
build tooling.

### Root workspace (`package.json`, `package-lock.json`)

Regenerated via a normal `npm install` from the repo root after the above
`package.json` changes, so the documented standard workflow
(`npm install` from root, per `CONTRIBUTING.md`/`AGENTS.md`) produces the same
patched versions and doesn't drift back to the vulnerable ones.

## Verified, not assumed

Every one of the 51 originally-open alerts was re-checked programmatically
against the final lockfiles' installed versions and each alert's
`vulnerable_version_range` (via `gh api repos/kishorjakkula/LatticePolicy/dependabot/alerts`).
Result: **0 of 51** still match a vulnerable range, including the one alert
with no published `first_patched_version` (`dompurify` GHSA-x4vx-rjvf-j5p4,
range `<= 3.4.6`) — the installed version is now 3.4.14, outside that flagged
range, so it should auto-dismiss on GitHub's next scan.

## Behavior Rules

- `server/package-lock.json` and `frontend/package-lock.json` are
  independently meaningful artifacts (GitHub's dependency graph scans them
  directly) and must be kept in sync with their `package.json` files using
  `npm install --prefix <dir> --no-workspaces`, not just a root-level
  `npm install`, or they will silently drift and stop reflecting reality.
- The `overrides` field must use the plain nested form
  (`{ "parent": { "child": "version" } }`) when `parent` is also a direct
  dependency in the same `package.json` — the version-pinned selector form
  (`"parent@x.y.z"`) only works when `parent` is purely transitive there.

## Automated Tests

- No new tests added — this is a dependency-version-only change with no
  behavior change to application code.
- Validation performed instead: full build, full unit/component test suite,
  full DB-backed integration suite (via `scripts/test-integration.sh`, a real
  containerized `npm install` from repo root against a disposable Postgres
  15), and the repo's own `npm run security:audit` gate.

## Validation

```bash
npm install --prefix server --no-workspaces
npm install --prefix frontend --no-workspaces
npm install
npm run build      # passes
npm run test       # 90 frontend + 225 server, all passing
npm run typecheck  # passes
npm run security:audit  # "npm audit completed with no unapproved vulnerabilities."
sh scripts/test-integration.sh  # 59/59 passing across 17 files, real Postgres 15
```

## Follow-Ups Or Risks

- `loadDomPurify()` in `frontend/src/lib/pdf.ts` is exported but unused
  anywhere in the app today. Worth either wiring it into the jsPDF flows that
  handle user-supplied text (defense in depth, since none of the current call
  sites use jsPDF's vulnerable `.html()` API) or removing the dead export —
  neither was done here to keep this PR strictly a dependency-version fix.
- The pre-existing `@vitejs/plugin-react` vs `vite` peer-dependency mismatch
  in `frontend/package.json` is unrelated to this PR and still present;
  tracking it as a separate follow-up rather than fixing it here.
- `uuid`'s override is scoped to `exceljs` in `server/package.json` (matching
  the existing root-level precedent for the same package). If another
  server-side dependency starts pulling in a different `uuid` major version
  later, it will need its own override entry.
