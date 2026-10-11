# Task Note: Process Split (API, Worker, Dispatcher)

## Links

- Issue: none yet (module split, step 2)
- Pull request:

## Summary

Batch jobs and message delivery ran inside the API process. They can now run
as their own processes from the same release image, so each can be scaled,
restarted, or later replaced without touching the API. The default role keeps
the old single-process behavior.

## Important Files

- `server/src/config.ts`: `getProcessRole`, `planProcess`.
- `server/src/index.ts`: starts what the plan says for the role.
- `server/src/worker.ts`, `server/src/dispatcher.ts`: start commands.
- `server/src/app.ts`: `registerProbeRoutes`, `createProbeApp`.
- `server/src/jobs/worker.ts`, `server/src/asyncMessageWorker.ts`: `force`
  option for a dedicated process.
- `deploy/carrier-stack/docker-compose.yml`: `api`, `worker`, `dispatcher`
  services; `stack.sh` stops all of them for restore and upgrade.

## Behavior Rules

- `LATTICE_ROLE` unset means `all`, which must keep starting the API and both
  loops under their existing switches. Existing deployments rely on it.
- The `api` role never runs a background loop, whatever the switches say.
- A dedicated `worker` or `dispatcher` runs its loop whatever the switch
  says, serves probes only, and refuses to start without a database.
- Anything that takes the stack offline for data replacement must stop every
  service that runs the release image, not only the API.
- Do not make the worker or dispatcher rate a policy until the published
  rating model cache is shared or invalidated across processes.

## Automated Tests

- `server/src/__tests__/process-role.test.ts`: role parsing and the plan for
  each role.
- `server/src/__tests__/health.test.ts`: the probe-only app.
- Full unit and integration suites.
- Exercised by hand on a kit stack: three processes from one image, each
  logging only its own loop; a job enqueued through the API was run by the
  worker; five outbox messages from a quote, bind, and issue were delivered
  by the dispatcher and by no other process; backup, restore (all four
  services stopped), and restart. Also started directly: the default role
  (API plus loops), a worker with no database (refused), and an invalid role
  (refused).

## Validation

```bash
npm run test:server
npm run test:integration
```

## Follow-Ups Or Risks

- The worker and dispatcher still share the API's code and database access;
  they are separate processes, not yet separate services with their own
  contracts.
- The kit's worker and dispatcher services have no container healthcheck.
- The AWS and Azure deploy workflows still run a single `all`-role service.
- The published rating model cache is per process (see `docs/MODULES.md`).
