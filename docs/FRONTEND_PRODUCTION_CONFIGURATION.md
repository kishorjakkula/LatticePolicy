# Frontend Production Configuration

The LatticePolicy frontend is a static React application built by Vite and
served by Nginx. Production configuration is compiled into its JavaScript
assets during `npm run build`; container runtime environment variables do not
change an already-built frontend image.

## Build Variables

| Variable | Production expectation | Notes |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Required | Absolute HTTPS origin for the public API, for example `https://api.example.com`. Do not include `/api` or a trailing slash; the client appends `/api` and the versioned route itself. Localhost HTTP URLs are accepted only for local smoke tests. |
| `VITE_USE_MOCK` | Must not be `1` or `true` | Set to `0` for explicit production builds. When omitted, a configured API URL also disables mock mode. Production startup fails if mock mode resolves to enabled. |
| `VITE_SENTRY_DSN` | Optional | Browser-side Sentry DSN. Like every `VITE_*` value, it is visible in downloaded browser assets and must not be treated as a secret. |
| `VITE_MOCK_API_DELAY_MS` | Local/demo only | Artificial latency for the mock API. Do not configure it for production because mock mode must be disabled. |

Vite also supplies `MODE`, `PROD`, and `DEV`. Production builds use
`MODE=production`; React Query developer tools are excluded when `DEV` is
false.

Never place passwords, signing keys, database URLs, encryption keys, private
tokens, or server-side Sentry credentials in a `VITE_*` variable. Those values
are embedded in public static files.

## URL And CORS Contract

For a frontend at `https://app.example.com` and API at
`https://api.example.com`:

```text
VITE_API_BASE_URL=https://api.example.com
ALLOWED_ORIGINS=https://app.example.com
```

`VITE_API_BASE_URL` tells the browser where to send requests.
`ALLOWED_ORIGINS` is separate API runtime configuration that authorizes the
frontend origin. Both must describe the same deployment topology. A mismatch
normally appears as a browser CORS failure even when both containers are
healthy.

The current client always adds `/api` before its versioned route. For example,
`/v1/policies` becomes
`https://api.example.com/api/v1/policies`. Therefore the configured base URL
must be the API origin, not `https://api.example.com/api`.

## Build Examples

Direct workspace build:

```bash
VITE_API_BASE_URL=https://api.example.com \
VITE_USE_MOCK=0 \
npm run build:frontend
```

Standard frontend container build:

```bash
docker build \
  -f frontend/Dockerfile \
  --build-arg VITE_API_BASE_URL=https://api.example.com \
  -t lattice-policy-ui:<immutable-tag> .
```

The standard Dockerfile accepts `VITE_API_BASE_URL`. Mock mode resolves to off
because that URL is present. `VITE_SENTRY_DSN` is optional and is not currently
exposed as a standard Docker build argument; a deployment that enables browser
Sentry must deliberately add that public build input to its image pipeline.

AWS and Azure deployment workflows read `VITE_API_BASE_URL` from a GitHub
repository variable, validate that it is present, and pass it to `docker build`.
Do not add it to ECS task environment variables or Azure Container App runtime
variables: changing it requires rebuilding and redeploying the frontend image.

## Local Versus Managed Builds

Local development may use mock mode from `frontend/.env.example` or the real
local API values in the root `.env.example`:

```text
VITE_API_BASE_URL=http://localhost:3300
VITE_USE_MOCK=0
```

The localhost HTTP exception exists for development and automated smoke tests.
Managed test, validation, staging, and production builds should use a public or
privately routed HTTPS API URL.

## Release Verification

Before promoting a frontend image:

1. Confirm the build used the intended immutable source revision and API URL.
2. Confirm mock mode is disabled and no sensitive value uses a `VITE_*` name.
3. Confirm the API `ALLOWED_ORIGINS` includes the exact deployed frontend
   origin.
4. Open the deployed UI and verify login plus an authenticated API request in
   browser developer tools.
5. Confirm static routes reload successfully through the Nginx SPA fallback.
6. Rebuild and redeploy the image whenever any frontend build variable changes.

The validation logic is implemented in `frontend/src/config.ts` and covered by
`frontend/src/__tests__/config.test.ts`.
