# Open Source Readiness

This checklist tracks work needed before publishing the repository publicly.

## Completed

- Added top-level project README with quick start and architecture links.
- Added Apache-2.0 license.
- Added contribution, security, governance, and code of conduct documents.
- Added GitHub issue templates and pull request template.
- Added package metadata and Node.js engine requirement.
- Added generated `tmpclaude-*-cwd` files to `.gitignore`.
- Removed local generated `tmpclaude-*-cwd` files from the workspace.
- Ran non-breaking `npm audit fix`.
- Split claims API/UI into a separate sibling project at `C:\JK\MVP\Claims`.
- Removed claims services from Policy workspaces, Docker Compose, production proxy routing, and public README.
- Updated root build/test scripts to run sequentially to avoid local workspace fan-out memory failures.

## Verification

Last local verification:

- `npm run build` passed.
- `npm run test` passed.
- `npm run typecheck` passed.

## Before Publishing

- Choose the final public repository owner/name and add repository, bugs, and homepage metadata to `package.json`.
- Replace "LatticePolicy contributors" in `LICENSE` with the final copyright holder if needed.
- Review all sample data for customer, carrier, pricing, or proprietary information.
- Decide whether sample credentials should remain in demo-only flows or move to seeded `.env` values.
- Review `.github/workflows/deploy-aws-ecs.yml` before publishing if deployment infrastructure should stay private.
- Decide whether to publish any workspace packages to npm. Keep `private: true` until intentionally publishing.

## Remaining Security Work

The root workspace audit is currently clean after security dependency updates.

Keep running `npm audit` from the repository root after dependency changes, because
the project uses the root npm workspace lockfile as the source of truth.
