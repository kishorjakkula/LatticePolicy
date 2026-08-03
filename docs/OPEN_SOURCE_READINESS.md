# Open Source Readiness

This checklist tracks work needed before publishing the repository publicly.

## Completed

- Added top-level project README with quick start and architecture links.
- Added Apache-2.0 license.
- Added contribution, security, governance, and code of conduct documents.
- Added GitHub issue templates and pull request template.
- Added package metadata, repository links, issue tracker link, homepage link, and Node.js engine requirement.
- Added generated `tmpclaude-*-cwd` files to `.gitignore`.
- Removed local generated `tmpclaude-*-cwd` files from the workspace.
- Ran non-breaking `npm audit fix`.
- Split claims API/UI into a separate sibling project at `C:\JK\MVP\Claims`.
- Removed claims services from Policy workspaces, Docker Compose, production proxy routing, and public README.
- Updated root build/test scripts to run sequentially to avoid local workspace fan-out memory failures.
- Reviewed sample product, tenant, and contract seed data as synthetic/demo data.
- Kept demo credentials in local/demo-only documentation and seed flows.
- Kept all workspace packages marked `private: true`; no npm publishing is planned yet.
- Reviewed the AWS ECS deployment workflow and task templates for public repository use.
- Moved API deployment secrets in the ECS task template to ECS task secrets instead of plain environment values.
- Updated fixable security dependencies, including Sentry, Vite, React Router, and TSX package lines.
- Added CI security automation for dependency audit policy, dependency review,
  CodeQL, and container scanning.
- Added DB integration and Playwright E2E smoke jobs to CI.
- Added Dependabot configuration for npm and GitHub Actions.
- Normalized the Apache-2.0 license appendix so GitHub can recognize the
  repository license.

## Publishing Decisions

- Public repository: `kishorjakkula/LatticePolicy`.
- Package registry: root, frontend, server, and shared type packages remain private until a maintainer intentionally prepares an npm release.
- License: keep the standard Apache-2.0 `LICENSE` text. There is no `LatticePolicy contributors` placeholder in the current license file to replace.
- Sample data: product YAML files, tenant config, and contract seed SQL files are intended to be synthetic examples. Re-review them before major public announcements or when adding new samples.
- Demo credentials: `admin`, `uw1`, and `agent1` with password `password` remain local/demo-only credentials documented in developer setup. Production credentials must come from external secrets.
- AWS deployment workflow: safe to keep in the public repository as an opt-in template. It depends on repository variables, a protected `production` environment, GitHub OIDC, and external AWS secrets before it can deploy.

## Verification

Last local verification:

- `npm audit fix` applied available non-force updates before v0.2.0.
- v0.2.0 release validation is tracked in `docs/tasks/issue-102-v0.2.0-release-readiness.md`.

## Before Publishing

- Re-run `npm run security:audit`, `npm run test`, `npm run typecheck`, and `npm run build` from the repository root.
- Re-run `npm run test:integration` and `npm run test:e2e:docker` before cutting a release.
- Verify a fresh clone can follow the quick-start path using `.env.example`.
- Re-review newly added sample data, task definitions, and workflow changes before publication.

## Remaining Security Work

`npm audit` currently reports the React Router RSC Mode CSRF advisory chain for
`react-router-dom` 7.18.2. LatticePolicy uses React Router as a Vite
client-side SPA router and does not enable React Router RSC/framework server
actions. The npm-suggested downgrade to 7.11.0 reintroduces older high-severity
React Router advisories, so the project keeps 7.18.2 and tracks
`GHSA-qwww-vcr4-c8h2` as a temporary explicit exception in
`scripts/check-npm-audit.mjs`.

Keep monitoring for the next patched non-regressing `react-router-dom` release
and remove the audit exception as soon as one is available.

Keep running `npm audit` from the repository root after dependency changes, because
the project uses the root npm workspace lockfile as the source of truth.
