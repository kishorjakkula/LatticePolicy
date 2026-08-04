# Private Cloud Test Deployment

## Context

The project needs to support a controlled external test/validation environment
on AWS and Azure without opening the application to all internet users. The
desired deployment posture is public HTTPS reachability, login-required
application access, no public self-registration, and an explicit allowlist for
validation users.

## Changes

- Added managed deployment validation for required database and secret
  configuration.
- Scoped managed deployment guardrails to `DEPLOYMENT_ENV`/`APP_ENV` so
  `NODE_ENV=production` can still be used for container runtime optimization
  without breaking local Docker Compose.
- Made managed test startup fail closed when PostgreSQL configuration or
  initialization is missing.
- Added invite-only demo access controls using `DEMO_ACCESS_MODE=invite_only`
  and `DEMO_ALLOWED_EMAILS`.
- Added managed deployment CORS origin control through `ALLOWED_ORIGINS` and
  enabled proxy trust for cloud test deployments.
- Updated AWS ECS task definitions for test env/secrets, health checks,
  and frontend port `80`.
- Added rate limiting to API docs routes so admin documentation authorization
  endpoints have the same brute-force protection posture as auth endpoints.
- Updated AWS deployment workflow to pass the frontend API URL as a Docker
  build argument and run optional smoke checks.
- Added an Azure Container Apps deployment workflow skeleton using the same
  application images and runtime configuration.
- Documented private demo access expectations in the cloud deployment docs.

## Expected Demo Operation

1. Deploy API and frontend containers to AWS or Azure.
2. Inject test environment secrets from the cloud provider secret store.
3. Configure `ALLOWED_ORIGINS` to the frontend URL.
4. Configure `DEMO_ACCESS_MODE=invite_only`.
5. Configure `DEMO_ALLOWED_EMAILS` with only approved demo users.
6. Create those users in the demo tenant with limited roles.
7. Share the frontend URL only with approved validation users.

## Tests

- Unit tests cover managed deployment config validation, allowed CORS origin parsing,
  and invite-only demo user checks.
