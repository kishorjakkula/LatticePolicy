# Local Health Checks

Use this checklist after starting the local stack to confirm that the UI, API,
database, and cache are available before investigating an application change.

## 1. Confirm the containers are healthy

```bash
docker compose ps
```

Expected services are `db`, `cache`, `server`, and `frontend`. Wait for the
PostgreSQL and Redis health checks to pass before treating an API startup error
as an application problem.

## 2. Check the UI and API

- Open `http://localhost:5173` and confirm that the login screen loads.
- Request the API health endpoint:

  ```bash
  curl http://localhost:3300/health
  ```

If the UI does not load, run `docker compose logs frontend`. If the health
endpoint does not respond, run `docker compose logs server` and check that the
server container is running.

## 3. Check PostgreSQL

```bash
docker compose ps db
docker compose exec db pg_isready -U lattice_policy -d lattice_policy
```

`accepting connections` confirms that PostgreSQL is ready. If it is not,
inspect `docker compose logs db`. A local port conflict on `65432` can also
prevent the database from starting.

## 4. Check Redis

```bash
docker compose ps cache
docker compose exec cache redis-cli ping
```

Redis should return `PONG`. If it does not, inspect `docker compose logs cache`
and confirm that port `6379` is not already in use.

## Common symptoms

| Symptom | Likely next step |
| --- | --- |
| UI is blank or unavailable | Check `docker compose logs frontend` and the configured `VITE_API_BASE_URL`. |
| API health request fails | Check `docker compose logs server`; verify the database and cache are healthy first. |
| Database connection errors | Confirm the `db` health check and the `DATABASE_URL`/`DB_*` values in `.env`. |
| Cache connection errors | Confirm `redis-cli ping` returns `PONG` and verify `REDIS_URL`. |
| A required port is already in use | Stop the conflicting process or adjust the local Docker Compose port mapping. |

For the full setup and environment reference, see
[Developer Local Setup](DEVELOPER_SETUP.md).
