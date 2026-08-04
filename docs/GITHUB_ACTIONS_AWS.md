# GitHub + AWS CI/CD Setup

This repo now includes:

- `.github/workflows/ci.yml` - builds frontend and server on push/PR.
- `.github/workflows/deploy-aws-ecs.yml` - deploys to an AWS ECS test/validation
  environment by manual `workflow_dispatch` after AWS repository variables and
  secrets are configured.

## 1) Create AWS IAM role for GitHub OIDC

Create an IAM role with trust policy for your repository and branch:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<ORG>/<REPO>:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

Attach permissions for:

- ECR push/pull
- ECS register task definition + update service
- CloudWatch logs (if needed for task definitions)
- IAM PassRole for task execution/task roles

## 2) Configure GitHub repository secrets and variables

### Secret

- `AWS_ROLE_TO_ASSUME` = IAM role ARN created above.

### Repository Variables

- `AWS_REGION` (example: `us-east-1`)
- `ECR_REPOSITORY_API` (example: `policy-api`)
- `ECR_REPOSITORY_FRONTEND` (example: `policy-frontend`)
- `ECS_CLUSTER` (example: `policy-cluster`)
- `ECS_SERVICE_API` (example: `policy-api-svc`)
- `ECS_SERVICE_FRONTEND` (example: `policy-frontend-svc`)
- `ECS_CONTAINER_NAME_API` (must match task definition container name, default `policy-api`)
- `ECS_CONTAINER_NAME_FRONTEND` (must match task definition container name, default `policy-frontend`)
- `VITE_API_BASE_URL` (public API base URL compiled into the frontend image)
- `TEST_API_HEALTH_URL` (optional smoke-test URL, for example `https://api.example.com/health`)
- `TEST_FRONTEND_URL` (optional smoke-test URL, for example `https://app.example.com`)

## 3) Review task definition templates

Files:

- `.github/ecs/task-definition-api.json`
- `.github/ecs/task-definition-frontend.json`

Update these fields before first deploy:

- `executionRoleArn`
- `taskRoleArn`
- CloudWatch log groups/region
- API task secrets (`DATABASE_URL`, `JWT_SECRET`, `CUSTOMER_DATA_KEY`, `MFA_TOKEN_SECRET`, `ALLOWED_ORIGINS`, `DEMO_ALLOWED_EMAILS`, optional `REDIS_URL`) with AWS Secrets Manager or SSM Parameter Store ARNs
- API test/demo-private environment variables (`NODE_ENV=production`, `DEPLOYMENT_ENV=test`, `REGISTRATION_ENABLED=false`, `DEMO_ACCESS_MODE=invite_only`, and optional `DEMO_ALLOWED_EMAIL_DOMAINS`)
- Frontend task port (`80`) and load balancer target group mapping

Do not configure `VITE_API_BASE_URL` as a frontend ECS runtime environment variable. Vite compiles this value during the Docker build, and the deploy workflow passes it through `--build-arg`.

## 4) Deployment behavior

- CI runs on PR and push to `main`.
- CD runs only through manual `workflow_dispatch`.
- CD builds Docker images, pushes to ECR (tag = commit SHA), renders task definitions, and deploys both ECS services.
- If `TEST_API_HEALTH_URL` or `TEST_FRONTEND_URL` are configured, CD runs simple post-deploy smoke checks.

Automatic deploys on push to `main` are intentionally disabled until the
test AWS account, repository variables, environment approvals, and task
definition templates are fully configured. Re-enable `push: branches: [main]`
only after a manual deployment succeeds and the `test` environment has the
desired approval rules.

## 5) Recommended hardening

- Keep `DATABASE_URL`, `JWT_SECRET`, `CUSTOMER_DATA_KEY`, `MFA_TOKEN_SECRET`, `ALLOWED_ORIGINS`, and demo allowlist values in AWS Secrets Manager or SSM Parameter Store and inject them through ECS task secrets.
- Keep deploy job in a protected GitHub environment (`test`) with manual approvals.
- Restrict OIDC trust policy to exact repo and branch.
- Use `DEMO_ACCESS_MODE=invite_only` for public demo URLs so only invited users can log in.
