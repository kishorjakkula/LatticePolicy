# Contributing

Thank you for contributing to LatticePolicy. This project is intended to be a practical open-source framework for property and casualty insurance policy underwriting systems and multi-tenant policy administration platforms.

Contributions should protect the framework qualities that matter most: tenant isolation, access-based user experiences, policy lifecycle correctness, auditability, and clear extension points for carriers, products, and integrations.

## Development Setup

For the complete local setup workflow, see [Developer Local Setup](docs/DEVELOPER_SETUP.md).

Prerequisites:

- Node.js 20+
- npm
- Docker Desktop
- Git

Install dependencies:

```bash
npm install
```

Run the local stack:

```bash
cp .env.example .env
docker compose up -d --build
```

Default local URLs:

- Policy UI: `http://localhost:5173`
- Policy API health: `http://localhost:3300/health`
- PostgreSQL: `localhost:65432`
- Redis: `localhost:6379`

Run checks before opening a pull request:

```bash
npm run build
npm run test
npm run typecheck
```

## Contribution Workflow

1. Start with an issue for non-trivial work.
   - Use a bug report for defects.
   - Use a feature request or proposal for new capabilities.
   - For large changes, wait for maintainer agreement before investing heavily.

2. Keep changes focused.
   - One pull request should represent one logical change.
   - Avoid mixing refactors, formatting sweeps, and feature work in the same PR.
   - Keep unrelated files out of the diff.

3. Prefer existing extension points.
   - Product-specific behavior should usually live under `products/`.
   - Tenant-specific behavior should usually live under `tenants/`.
   - Shared framework behavior belongs in `server/`, `frontend/`, `packages/`, or `contracts/` only when it is reusable.

4. Validate locally before requesting review.
   - Build, test, and typecheck should pass.
   - Docker changes should be tested with `docker compose up -d --build`.
   - API changes should include docs or contract updates when appropriate.

## Branching Process

The default branch is `main`. Contributors should not commit directly to `main`.

Create a branch from the latest `main`:

```bash
git checkout main
git pull origin main
git checkout -b <type>/<short-description>
```

Use one of these branch prefixes:

- `feature/` for new framework capabilities
- `fix/` for bug fixes
- `docs/` for documentation-only updates
- `test/` for test-only changes
- `refactor/` for behavior-preserving internal improvements
- `chore/` for tooling, dependency, or maintenance work

Examples:

```bash
git checkout -b feature/rating-workbench-import
git checkout -b fix/customer-portal-policy-scope
git checkout -b docs/contributor-branching-process
```

Branch rules:

- Keep branches short-lived when possible.
- Rebase or merge from `main` before opening a PR if the branch is stale.
- Do not include secrets, local `.env` files, `node_modules`, build output, logs, or local IDE settings.
- Do not rewrite shared public history after review has started unless a maintainer asks you to clean up the branch.

## Commit Guidance

Use clear commit messages that describe the intent, not only the files changed.

Preferred format:

```text
Short imperative summary

Optional body explaining why the change is needed, important design choices,
and any migration or compatibility notes.
```

Examples:

```text
Add customer portal policy scope checks

Ensure portal APIs only return policies linked to the authenticated customer's
tenant-scoped customer record.
```

```text
Document contributor branching process
```

## Pull Request Process

Open a pull request from your branch into `main`.

Every PR should include:

- A concise summary of the change.
- The problem or use case being addressed.
- The major files or areas touched.
- Testing performed, including commands run.
- Screenshots or screen recordings for visible UI changes.
- Migration notes for database, configuration, contract, or deployment changes.
- Documentation updates when public behavior changes.

Use the repository pull request template when available.

Before marking a PR ready for review:

```bash
npm run build
npm run test
npm run typecheck
```

For Docker or deployment changes, also run:

```bash
docker compose up -d --build
docker compose ps
```

## Review Process

Maintainers and reviewers should focus first on correctness and framework safety.

Review priorities:

- Tenant isolation is preserved.
- RBAC and permission checks are enforced server-side, not only in the UI.
- Customer portal APIs return portal-safe projections only.
- Policy lifecycle behavior is deterministic and auditable.
- Rating, underwriting, document, and transaction changes include appropriate tests.
- Public APIs, schemas, docs, and sample configuration stay in sync.
- Docker, CI, and deployment changes are reproducible.
- The implementation follows existing project patterns before adding new abstractions.

Reviewer expectations:

- Be specific and actionable.
- Prefer comments tied to concrete files, lines, behavior, or tests.
- Distinguish blocking issues from suggestions.
- Ask for tests when behavior changes and no coverage exists.
- Avoid broad rewrites unless the current approach creates real maintenance or correctness risk.

Author expectations:

- Respond to review comments directly.
- Push follow-up commits to the same branch.
- Explain tradeoffs when you choose not to apply a suggestion.
- Re-run relevant checks after making review changes.
- Request re-review when all blocking comments are addressed.

## Merge Expectations

A PR is ready to merge when:

- Required checks pass.
- At least one maintainer has approved it.
- Blocking review comments are resolved.
- Documentation and contracts are updated when needed.
- The branch is current enough with `main` to avoid integration risk.

Preferred merge style is squash merge for contributor branches unless maintainers decide the commit history should be preserved.

After merge:

- Delete the feature branch.
- Close linked issues when the work is complete.
- Open follow-up issues for deferred work rather than expanding the merged PR scope.

## Code Style

- TypeScript is the default implementation language.
- Keep domain logic explicit and testable.
- Use structured schema validation at service boundaries.
- Preserve tenant isolation in all APIs and data access paths.
- Keep customer-facing data projections intentionally minimal and safe.
- Avoid product- or carrier-specific assumptions in shared framework modules.
- Keep frontend routes and navigation permission-gated, but always enforce authorization in backend APIs too.

## Documentation Standards

Update documentation when changing:

- Public APIs or contracts
- Environment variables
- Docker or deployment steps
- Database migrations
- Product pack behavior
- Tenant configuration behavior
- Security, RBAC, MFA, or customer portal access rules
- User-visible workflows

Architecture changes should update `docs/ARCHITECTURE.md` and related diagrams when useful.

## Reporting Bugs

Use the bug report issue template and include:

- Reproduction steps
- Expected behavior
- Actual behavior
- Logs or screenshots when useful
- Environment details
- Tenant/product context if relevant

Security issues should follow the process in `SECURITY.md`.

## Feature Requests

For larger features, open a proposal issue first. Describe:

- The insurance use case
- The target user role or workflow
- Tenant or product impact
- API, schema, or migration needs
- Security and access-control considerations
- Backward compatibility concerns
