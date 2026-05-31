# GitHub + AWS CI/CD Setup

This repo now includes:

- `.github/workflows/ci.yml` - builds frontend and server on push/PR.
- `.github/workflows/deploy-aws-ecs.yml` - deploys to AWS ECS on push to `main` (or manual run).

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

## 3) Review task definition templates

Files:

- `.github/ecs/task-definition-api.json`
- `.github/ecs/task-definition-frontend.json`

Update these fields before first deploy:

- `executionRoleArn`
- `taskRoleArn`
- CloudWatch log groups/region
- Environment variables (`DATABASE_URL`, `JWT_SECRET`, `VITE_API_BASE_URL`)

## 4) Deployment behavior

- CI runs on PR and push to `main`.
- CD runs on push to `main` and `workflow_dispatch`.
- CD builds Docker images, pushes to ECR (tag = commit SHA), renders task definitions, and deploys both ECS services.

## 5) Recommended hardening

- Move `DATABASE_URL` and `JWT_SECRET` to AWS Secrets Manager and inject via ECS task secrets.
- Keep deploy job in a protected GitHub environment (`production`) with manual approvals.
- Restrict OIDC trust policy to exact repo and branch.
