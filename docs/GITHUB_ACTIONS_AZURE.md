# GitHub + Azure Container Apps CI/CD Setup

This repo includes `.github/workflows/deploy-azure-container-apps.yml` for manual Azure Container Apps deployments. The workflow keeps Azure-specific concerns in GitHub Actions and Azure resources; the application remains configured through container images, environment variables, and secret injection.

## 1) Create Azure federated credentials for GitHub OIDC

Create an app registration or managed identity that GitHub Actions can use through workload identity federation. Scope it to this repository and the `main` branch or to the protected `test` environment.

Required permissions usually include:

- Push/pull access to Azure Container Registry.
- Read/update access to the API and frontend Container Apps.
- Start access to the optional Container Apps migration job.
- Read access to deployment metadata in the target resource group.

## 2) Configure GitHub repository secrets and variables

### Secrets

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

### Repository Variables

- `AZURE_RESOURCE_GROUP` (example: `rg-lattice-policy-test`)
- `AZURE_CONTAINER_REGISTRY` (ACR name, not login server)
- `AZURE_CONTAINER_APP_API` (example: `lattice-policy-api`)
- `AZURE_CONTAINER_APP_FRONTEND` (example: `lattice-policy-ui`)
- `AZURE_CONTAINER_APP_MIGRATION_JOB` (optional one-off migration job)
- `VITE_API_BASE_URL` (public API URL compiled into the frontend image)
- `TEST_API_HEALTH_URL` (optional smoke-test URL, for example `https://api.example.com/health`)
- `TEST_FRONTEND_URL` (optional smoke-test URL, for example `https://app.example.com`)

## 3) Configure Container Apps runtime settings

API Container App:

- Image: ACR API image rendered by the workflow.
- Target port: `3000`.
- Environment: `NODE_ENV=production`, `DEPLOYMENT_ENV=test`, `PORT=3000`, `CACHE_ENABLED=1`, `LOG_LEVEL=info`, `REGISTRATION_ENABLED=false`, `DEMO_ACCESS_MODE=invite_only`.
- Secret-backed env vars: `DATABASE_URL`, `JWT_SECRET`, `CUSTOMER_DATA_KEY`, `MFA_TOKEN_SECRET`, `REDIS_URL`, `ALLOWED_ORIGINS`, `DEMO_ALLOWED_EMAILS`.

Frontend Container App:

- Image: ACR frontend image rendered by the workflow.
- Target port: `80`.
- `VITE_API_BASE_URL` must be supplied to the Docker build through the GitHub repository variable; do not rely on a runtime env var for the static frontend.

## 4) Demo-private access model

For demos, use a public HTTPS URL with invite-only application access:

- `REGISTRATION_ENABLED=false`
- `DEMO_ACCESS_MODE=invite_only`
- `DEMO_ALLOWED_EMAILS` stored as a Key Vault-backed secret
- `ALLOWED_ORIGINS` restricted to the frontend URL
- Demo users assigned only to a dedicated demo tenant

If the audience is very small, add Azure Front Door WAF, Application Gateway WAF, or ingress restrictions as an additional edge control.

## 5) Deployment behavior

- Deployment runs only through manual `workflow_dispatch`.
- The workflow builds API and frontend Docker images tagged with the commit SHA.
- The frontend build receives `VITE_API_BASE_URL` as a Docker build argument.
- The workflow pushes both images to ACR.
- If `AZURE_CONTAINER_APP_MIGRATION_JOB` is configured, the workflow starts it before updating services.
- The workflow updates API and frontend Container Apps to the new images.
- If smoke-test URLs are configured, the workflow checks them after deployment.

## 6) Recommended hardening

- Keep deployments behind the protected GitHub `test` environment with approval rules.
- Use Key Vault-backed Container Apps secrets.
- Use private networking for PostgreSQL Flexible Server and Azure Cache for Redis.
- Enable Azure Monitor and Log Analytics alerts for failed revisions, 5xx rates, latency, PostgreSQL capacity, Redis capacity, and task restarts.
- Use immutable image tags and keep rollback steps documented.
