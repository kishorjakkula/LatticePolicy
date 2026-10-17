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
| `PII_LOOKUP_KEY` | Unique secret used only for keyed PII lookup tokens; keep separate from encryption and signing keys. |
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
- `LATTICE_ROLE` selects what the process does: `all` (default: API plus the
  background loops that are switched on), `api`, `worker` (batch jobs), or
  `dispatcher` (outbox delivery). See `docs/MODULES.md`.
- `EVENT_TRANSPORT` selects where the dispatcher delivers messages: `webhook`
  (default, `ASYNC_PUSH_WEBHOOK_URL`) or `kafka` (`KAFKA_BROKERS` and related
  settings). A dispatcher with incomplete transport settings refuses to start.
  See `docs/EVENTS.md`.
- `INTAKE_AI_PROVIDER` selects who reads uploaded broker submissions:
  `builtin` (default; local label reader), `private` (independent local OCR/LLM
  processor; `DOCUMENT_PROCESSOR_URL`, `DOCUMENT_PROCESSOR_TOKEN` of at least
  32 characters, optional `DOCUMENT_EXTRACTION_PROFILE`), or
  `anthropic` (external, blocked unless `INTAKE_DATA_BOUNDARY=external`; needs
  `ANTHROPIC_API_KEY`, optional `INTAKE_AI_MODEL`, `INTAKE_AI_BASE_URL`,
  `INTAKE_AI_TIMEOUT_MS`). `INTAKE_EXTRACTION_MODE=job|inline` overrides where
  reads run. Set these on the API and the worker. See
  `docs/SUBMISSION_INTAKE.md` and `docs/PRIVATE_DOCUMENT_PROCESSING.md`.
- LLM release governance requires `LLM_RELEASE_SIGNING_KEY` (Ed25519 private
  PEM, API only) for approvals. `LLM_EMAIL_ENABLED` defaults to `false`; test
  registrations need no SMTP, review URL, or email contacts. Only literal `true`
  enables readiness mail on both API and dispatcher; then configure
  `LLM_REVIEW_UI_URL` (HTTPS admin origin), technical-admin contacts,
  `LLM_SMTP_HOST`, `LLM_SMTP_PORT` (587/465),
  `LLM_SMTP_FROM`, and optional `LLM_SMTP_USER`/`LLM_SMTP_PASSWORD` on the
  dispatcher. Processors use `RELEASE_ENVIRONMENT`, `CARRIER_TENANT_ID`,
  `MODEL_ARTIFACT_SHA256`, and `LLM_RELEASE_PUBLIC_KEY_FILE`, never the private
  signing key. See `docs/LLM_RELEASE_GOVERNANCE.md` for approval and rollout.
- `CARRIER_TENANT_ID` pins the stack to one carrier. Set it on every
  single-carrier deployment: requests, logins, SSO routes, and background
  workers for any other tenant id are rejected with `TENANT_NOT_SERVED`. It is
  optional today so existing shared deployments keep working; see
  `docs/MULTITENANCY.md`.
- `TENANT_RLS_ENFORCED=1` makes Postgres enforce the tenant row-level security
  policies by running every tenant transaction as the restricted
  `lattice_tenant_rls` role (created by migration 058). Startup fails if the
  database user cannot use that role. Recommended for every production stack;
  off by default so existing deployments are unchanged until it is turned on.

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
PII_LOOKUP_KEY=<separate-pii-lookup-secret-reference>
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
