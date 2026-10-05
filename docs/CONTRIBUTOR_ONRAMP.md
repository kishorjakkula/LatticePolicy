# Contributor On-Ramp

This guide is for new contributors who want to help LatticePolicy without first
learning the entire insurance policy administration domain.

## What The Project Needs

LatticePolicy benefits from several kinds of contributions:

- Documentation that makes setup, extension, and architecture easier to follow.
- Tests that lock down tenant isolation, policy lifecycle behavior, APIs, and UI flows.
- Product pack examples for additional lines of business, states, limits, deductibles, forms, and rating inputs.
- Frontend usability improvements for admin, underwriting, rating, search, policy, and portal workflows.
- Backend service improvements that preserve tenant scope, RBAC, auditability, and deterministic policy behavior.
- Deployment and operations examples for Docker, cloud hosting, CI, observability, and runbooks.

## Best First Path

1. Read [README.md](../README.md) for the product overview.
2. Read [Developer Local Setup](DEVELOPER_SETUP.md) and start the local stack.
3. Skim [Project Context](PROJECT_CONTEXT.md) for the architecture map.
4. Pick a task from [First Good Tasks](FIRST_GOOD_TASKS.md) or an issue labeled `good first issue`.
5. Comment on the issue with the files you expect to touch and the checks you plan to run.
6. Open a small PR and use the pull request template.

## Local Validation

For documentation-only changes, run the most relevant lightweight check and
explain why product tests are not needed.

For code changes, prefer targeted checks first:

```bash
npm run test --workspace=server -- <test-file>
npm run test --workspace=frontend -- <test-file>
npm run typecheck
```

Before requesting review on behavior changes, run:

```bash
npm run build
npm run test
npm run typecheck
```

## What Maintainers Look For

Maintainers review for:

- Tenant isolation and server-side authorization.
- Customer-safe portal projections.
- Clear, deterministic policy lifecycle behavior.
- Tests at the smallest useful layer.
- Documentation or task notes for non-trivial behavior.
- Focused diffs that do not mix unrelated work.

## Helpful Issue Comment Template

```md
I would like to work on this.

Planned scope:
- Files/areas:
- Tests/docs I plan to update:
- Expected validation command:

Questions before I start:
- 
```

## Helpful PR Summary Template

```md
Summary:
- 

Validation:
- 

Notes for reviewers:
- 
```
