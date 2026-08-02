# Task Note: Manual AWS ECS Deployment

## Links

- Issue:
- Pull request:

## Summary

The AWS ECS deployment workflow was failing on every merge to `main` because it
ran automatically before the repository's AWS deployment variables and secrets
were configured. The workflow now runs only through manual `workflow_dispatch`
until the production AWS account setup is complete.

## Important Files

- `.github/workflows/deploy-aws-ecs.yml`: manual-only ECS deployment workflow
  with early validation for required GitHub variables and the AWS OIDC role
  secret.
- `docs/GITHUB_ACTIONS_AWS.md`: documents manual deployment behavior and the
  conditions for safely re-enabling automatic deploys.

## Behavior Rules

- CI still runs on pull requests and pushes to `main`.
- AWS ECS deployment should be manually triggered until a manual production
  deploy succeeds.
- Re-enable deploy-on-push only after AWS repository variables, secrets, task
  definitions, and production environment approvals are configured.
- Missing AWS deployment configuration should fail at the validation step before
  any Docker build, ECR push, or ECS update starts.

## Automated Tests

- Tests added or updated: none.
- Test layer used: workflow and documentation review.
- Why this layer is enough: this change only adjusts GitHub Actions trigger
  behavior and deployment documentation.

## Validation

```bash
git diff --check
```

## Follow-Ups Or Risks

- Configure GitHub repository variables and the `AWS_ROLE_TO_ASSUME` secret
  before the first manual AWS deployment.
- After a successful manual deploy, decide whether automatic `main` deploys
  should be restored or kept manual with protected environment approvals.
