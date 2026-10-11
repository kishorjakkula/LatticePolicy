# Modules And Replaceability

LatticePolicy is being divided into modules that talk only through published
contracts, so one module can be replaced with different technology, deployed
on its own, or sold on its own without rewriting the others.

This document states the target, the decisions taken, and what exists today.
Update it whenever a module boundary, contract, or deployment unit changes.

## Target Modules

| Module | Responsibility | Contract it publishes | Deployable as |
| --- | --- | --- | --- |
| UI | Operations and customer portal screens | Consumes the public REST API only | Its own image (exists today) |
| Policy API | Quote, bind, issue, endorse, cancel, renew, administration | REST API, business events | API process |
| Rating | Pricing from rate tables and published workbooks, with a calculation trace | Rating API: rate, explain, publish and version models | In-process by default, or a standalone service |
| Batch jobs | Scheduled and queued operational work | Job definitions and schedules | Worker process |
| Asynchronous messaging | Reliable publishing of business events | Versioned event schemas | Dispatcher process, pluggable transport |

## Decisions

- **Ports first, then split.** Each module goes behind an interface inside this
  codebase with the existing in-process behavior as its first implementation.
  A second implementation calls the module over the network. A stack that
  keeps the default sees no change.
- **Rating runs in-process by default; remote is optional.** A stack can be
  configured to call a standalone rating service instead. Both are the same
  rating code.
- **Rating owns its data.** As a standalone product the rating service has its
  own database and no foreign keys into policy data. Everything it needs to
  price a risk arrives in the request.
- **The outbox stays.** An event is recorded in the same transaction as the
  change that caused it. The dispatcher publishes through a transport adapter.
- **Transports:** the existing webhook, and Kafka as the second adapter.
- **One release image, several start commands** for API, worker, and
  dispatcher, so the deployment kit can run them as separate services.
- **Each module owns its tables.** No module joins across another's.

## What Exists Today

| Module | State |
| --- | --- |
| UI | Separate application and image. |
| Shared runtime packages | `packages/rules` (rule expressions, screen rules) is the first package both the API and UI import at run time. `packages/types` remains types only. |
| Rating | In-process function `rate()` in `server/src/services/rating.service.ts`, called synchronously from 16 places in 9 files. Not yet behind an interface. |
| Batch jobs | Worker loop started inside the API process (`JOB_WORKER_ENABLED`). Handlers import core code and the database directly. |
| Asynchronous messaging | `async_message_outbox`, written by notifications only, dispatched in-process to one webhook (`ASYNC_PUSH_*`). |

## Shared Runtime Packages

A shared package holds code that more than one module must run identically.
It has no dependency on the API or the UI.

- Source lives in `packages/<name>/src`, with tests beside it
  (`npm run test:packages`).
- The **server** compiles and runs against the package's built output
  (`dist`). `npm run build:packages` builds it; the server's `prebuild` and
  `predev` scripts do so automatically, and `server/Dockerfile` builds it and
  copies `dist` into the runtime image.
- The **UI**, and both test suites, read the package **source** through an
  alias (`frontend/vite.config.ts`, the `vitest` configs, and `paths` in
  `frontend/tsconfig.json`), so they never depend on a stale build.
- Running `tsc` in `server/` directly needs `npm run build:packages` first.

To add a package: create `packages/<name>` with the same `package.json`,
`tsconfig.json`, and `vitest.config.ts` shape as `packages/rules`; add it as a
`file:` dependency where it is used; add its alias to the three configs above;
copy it in both Dockerfiles; and add it to `build:packages` and
`test:packages` in the root `package.json`.

## Build Order

1. Packaging foundation (done): shared runtime packages.
2. Process split: API, worker, and dispatcher start commands and kit services.
3. Rating port: one interface, asynchronous callers, in-process behavior
   unchanged, with proof that premiums are identical.
4. Rating service: standalone application, API contract, own storage, and a
   remote implementation of the port.
5. Event contracts and transports: versioned business events and a Kafka
   adapter beside the webhook.
