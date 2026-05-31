# Developer Local Setup

This guide helps contributors run LatticePolicy locally for development, testing, and documentation review.

LatticePolicy is a property and casualty insurance policy underwriting system framework with a React frontend, Node.js/Express API, PostgreSQL database, Redis cache, and Docker Compose local stack.

## Prerequisites

Install these tools before starting:

| Tool | Required version | Purpose |
| --- | --- | --- |
| Git | Current stable | Clone, branch, commit, and push changes |
| Node.js | 20 or later | Run the TypeScript workspaces |
| npm | Bundled with Node.js | Install workspace dependencies |
| Docker Desktop | Current stable | Run PostgreSQL, Redis, API, and UI containers |
| GitHub CLI | Optional | Create and manage pull requests from the terminal |

Verify the core tools:

```bash
git --version
node --version
npm --version
docker --version
docker compose version
```

## Clone the Repository

```bash
git clone https://github.com/kishorjakkula/LatticePolicy.git
cd LatticePolicy
```

Create a working branch from the latest `main`:

```bash
git checkout main
git pull origin main
git checkout -b docs/my-change
```

Use the branch naming guidance in [CONTRIBUTING.md](../CONTRIBUTING.md) for feature, fix, docs, test, refactor, and chore work.

## Configure Environment

Copy the sample environment file:

```bash
cp .env.example .env
```

For Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Local defaults:

| Variable | Required | Local purpose |
| --- | --- | --- |
| `DB_USER` | Yes | PostgreSQL application user |
| `DB_PASSWORD` | Yes | PostgreSQL application password |
| `DB_NAME` | Yes | PostgreSQL database name |
| `JWT_SECRET` | Yes | Local token signing secret |
| `SENTRY_DSN` | No | Server error tracking DSN |
| `VITE_SENTRY_DSN` | No | Frontend error tracking DSN |
| `VITE_API_BASE_URL` | No | Public API base URL used by the browser app |

Do not commit `.env` or real secrets.

## Option 1: Full Docker Stack

This is the fastest path for first-time contributors because it runs the database, cache, API, and UI together.

```bash
docker compose up -d --build
```

Local services:

| Service | URL or port |
| --- | --- |
| Policy UI | `http://localhost:5173` |
| Policy API health | `http://localhost:3300/health` |
| PostgreSQL | `localhost:65432` |
| Redis | `localhost:6379` |

Check container status:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f server
docker compose logs -f frontend
```

Stop the stack:

```bash
docker compose down
```

Reset local database and cache volumes:

```bash
docker compose down -v
docker compose up -d --build
```

Use the volume reset only when you are comfortable deleting local PostgreSQL and Redis data.

## Option 2: Local Node Development

Use this mode when actively changing the API or frontend and you want hot reload from the local Node.js processes.

Install workspace dependencies:

```bash
npm install
```

Start only PostgreSQL and Redis:

```bash
docker compose up -d db cache
```

Set local runtime variables for the API.

PowerShell:

```powershell
$env:DATABASE_URL="postgres://lattice_policy:yourStrongPassword@localhost:65432/lattice_policy"
$env:JWT_SECRET="change-me-please-use-a-long-random-string"
$env:REDIS_URL="redis://localhost:6379"
$env:CACHE_ENABLED="1"
npm run dev:server
```

Bash:

```bash
export DATABASE_URL=postgres://lattice_policy:yourStrongPassword@localhost:65432/lattice_policy
export JWT_SECRET=change-me-please-use-a-long-random-string
export REDIS_URL=redis://localhost:6379
export CACHE_ENABLED=1
npm run dev:server
```

In a second terminal, start the frontend:

```bash
npm run dev:frontend
```

The frontend dev server normally runs on `http://localhost:5173`. If port `5173` is already in use, Vite may choose another port and print the URL in the terminal.

## Database and Migrations

SQL migrations live under `server/migrations/`.

When the API starts with `DATABASE_URL` configured, it:

1. Connects to PostgreSQL.
2. Ensures the `schema_migrations` table exists.
3. Applies unapplied SQL files from `server/migrations/` in version order.

For normal local development, starting the API is enough to initialize the schema.

If database initialization fails, the server can continue in in-memory mode for limited UI exploration. Use PostgreSQL-backed mode when validating persistence, tenant isolation, policy lifecycle behavior, RBAC, customer portal behavior, or migrations.

## Local Login

Use tenant `sample-carrier` for local development.

Sample users:

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `password` | Administrator |
| `uw1` | `password` | Underwriter |
| `agent1` | `password` | Agent |

These credentials are for local/demo use only.

The login API requires a tenant. The UI sends tenant context as part of the login flow. API callers should provide `tenantId` in the request body or `X-Tenant` in the request header.

Example:

```bash
curl -X POST http://localhost:3300/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"tenantId\":\"sample-carrier\",\"username\":\"agent1\",\"password\":\"password\"}"
```

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install all workspace dependencies |
| `npm run dev:server` | Start the API in watch mode |
| `npm run dev:frontend` | Start the React frontend in Vite |
| `npm run build` | Build frontend and server |
| `npm run test` | Run frontend and server tests |
| `npm run typecheck` | Run TypeScript checks across workspaces |
| `npm run smoke --workspace=server` | Run API smoke checks |
| `docker compose up -d --build` | Start the full local stack |
| `docker compose down` | Stop the local stack |
| `docker compose down -v` | Stop the stack and delete local volumes |

## Validation Before Pull Request

Run these checks before opening or updating a pull request:

```bash
npm run build
npm run test
npm run typecheck
```

For Docker, API runtime, database, or deployment changes, also run:

```bash
docker compose up -d --build
docker compose ps
```

For UI changes, include screenshots in the pull request when the visual behavior changes.

## Development Workflow

1. Create a branch from the latest `main`.
2. Make one focused change.
3. Update tests and documentation when behavior changes.
4. Run build, test, and typecheck locally.
5. Commit with a clear message.
6. Push the branch.
7. Open a pull request into `main`.
8. Wait for CI and review approval.
9. Address review comments on the same branch.
10. Merge using the repository's squash merge process after approval.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full branching, pull request, review, and merge process.

## Troubleshooting

### Docker says a port is already in use

Another local process may be using one of the expected ports.

Common ports:

- `5173` for the UI
- `3300` for the API
- `65432` for PostgreSQL
- `6379` for Redis

Stop the conflicting process or update the port mapping in `docker-compose.yml` for local testing.

### API cannot connect to PostgreSQL

Check that the database container is running:

```bash
docker compose ps db
docker compose logs db
```

Also confirm `DATABASE_URL`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` match the Docker Compose configuration.

### Login returns tenant required

Use tenant `sample-carrier`. API callers must provide either:

- `tenantId` in the JSON request body
- `X-Tenant: sample-carrier` request header

### UI cannot call the API

Confirm the API is healthy:

```bash
curl http://localhost:3300/health
```

For Docker-based UI builds, confirm `VITE_API_BASE_URL` is set to `http://localhost:3300` before rebuilding the frontend image.

### Dependency install or build behaves unexpectedly

Clean and reinstall dependencies:

```bash
rm -rf node_modules frontend/node_modules server/node_modules packages/types/node_modules
npm install
```

For Windows PowerShell:

```powershell
Remove-Item -Recurse -Force node_modules, frontend/node_modules, server/node_modules, packages/types/node_modules
npm install
```

### Database state looks stale

Reset local Docker volumes:

```bash
docker compose down -v
docker compose up -d --build
```

This deletes local PostgreSQL and Redis data.

## Related Documentation

- [Architecture](ARCHITECTURE.md)
- [API](API.md)
- [Domain model](DOMAIN.md)
- [Multitenancy](MULTITENANCY.md)
- [Cloud deployment](CLOUD_DEPLOYMENT.md)
- [Contributing](../CONTRIBUTING.md)
