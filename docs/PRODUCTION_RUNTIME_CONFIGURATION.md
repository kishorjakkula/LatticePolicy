# Production Runtime Configuration

This guide defines the API configuration contract for managed LatticePolicy
deployments. It complements the
[frontend production configuration](FRONTEND_PRODUCTION_CONFIGURATION.md),
whose `VITE_*` values are fixed when the frontend image is built.

## Local Demo and Managed Deployments

LatticePolicy intentionally treats local exploration differently from a
shared deployment:

| Mode | How it is selected | Behavior |
| --- | --- | --- |
| Local/demo | `DEPLOYMENT_ENV=local`, or no managed environment marker | Allows local HTTP origins and can continue without PostgreSQL with built-in demo users. |
| Managed | `NODE_ENV=production`, or `DEPLOYMENT_ENV=test`, `validation`, `staging`, or `production` | Validates configuration before startup, requires PostgreSQL, and disables database-free demo login. |

`DEPLOYMENT_ENV=local` explicitly selects local/demo behavior even when a
container image sets `NODE_ENV=production`. Do not use that exception for a
shared, internet-accessible, or customer-data environment.

## Required Managed Configuration

Set these API environment variables through the deployment platform's secret
or configuration service:

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Startup exits if the database cannot initialize. |
| `JWT_SECRET` | Unique, non-placeholder secret of at least 32 characters. |
| `CUSTOMER_DATA_KEY` | Unique, non-placeholder secret of at least 32 characters, separate from signing secrets. |
| `MFA_TOKEN_SECRET` | Unique, non-placeholder secret of at least 32 characters. |
| `ALLOWED_ORIGINS` | Comma-separated list of explicit HTTPS frontend origins. Wildcards, HTTP, localhost, and invalid URLs are rejected. |

The three required secrets must differ from one another. Values such as
`change-me`, `dev-secret`, `password`, `secret`, and other known demo/test
placeholders are rejected.

Additional guarded settings:

- `CACHE_ENABLED=1` requires `REDIS_URL`.
- `DEMO_ACCESS_MODE=invite_only` requires at least one exact username or email
  in the comma-separated `DEMO_ALLOWED_EMAILS` list.
- `SSO_STATE_SECRET` is optional and otherwise derives from `JWT_SECRET`; set a
  separate secret explicitly when enabling OIDC SSO.

The API does not currently provide public self-registration or domain-based
demo allowlisting. Use exact entries in `DEMO_ALLOWED_EMAILS`, provision users
through controlled administration, and place a small external validation
environment behind a WAF, IP allowlist, or identity-aware proxy when needed.

## Safe Configuration Pattern

The following names and URLs are examples only. Resolve secret references from
the cloud secret store instead of placing secret values in source control or
deployment manifests.

```dotenv
NODE_ENV=production
DEPLOYMENT_ENV=staging
DATABASE_URL=<secret-store-reference>
JWT_SECRET=<unique-secret-store-reference>
CUSTOMER_DATA_KEY=<different-secret-store-reference>
MFA_TOKEN_SECRET=<different-secret-store-reference>
ALLOWED_ORIGINS=https://app.example.com
CACHE_ENABLED=1
REDIS_URL=<secret-store-reference>
DEMO_ACCESS_MODE=invite_only
DEMO_ALLOWED_EMAILS=reviewer@example.com
```

Never promote `.env.example` values into a managed environment. That file is a
local template and deliberately contains placeholders and localhost URLs.

## Deployment Verification

Before exposing a managed deployment:

1. Confirm the environment is marked as managed and is not using
   `DEPLOYMENT_ENV=local`.
2. Inject all required values from the platform configuration and secret
   stores.
3. Start the API and verify it does not report `Invalid deployment
   configuration` or a database initialization failure.
4. Confirm `GET /health` succeeds over the deployed HTTPS route.
5. Verify an allowed browser origin can call the API and an unlisted origin
   cannot.
6. For an invite-only validation environment, verify an exact allowed user can
   log in and an unlisted user receives `DEMO_ACCESS_NOT_ALLOWED`.
7. Confirm local demo credentials cannot authenticate through a missing
   database; managed deployments return `DATABASE_UNAVAILABLE` instead.

See [Cloud Deployment](CLOUD_DEPLOYMENT.md) for provider architecture and
[Production Runbooks](PRODUCTION_RUNBOOKS.md) for ongoing operations.

## Troubleshooting

- **The process exits before listening:** read the combined validation message
  for missing variables, unsafe secrets, invalid origins, or a missing Redis
  URL.
- **The process exits during database initialization:** verify the PostgreSQL
  URL, network path, TLS policy, credentials, and migration permissions.
- **An invited user receives `DEMO_ACCESS_NOT_ALLOWED`:** match the normalized
  username or email exactly in `DEMO_ALLOWED_EMAILS`; domain-only entries are
  not supported.
- **A browser request is blocked by CORS:** make `ALLOWED_ORIGINS` exactly match
  the frontend's public HTTPS origin, including scheme and port when present.

