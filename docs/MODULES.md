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
| Rating | Pricing from rate tables and published workbooks, with a calculation trace | The `rate()` function and its result shape | Inside the Policy API. A copy can be split out and hosted as its own application later if that is needed |
| Batch jobs | Scheduled and queued operational work | Job definitions and schedules | Worker process |
| Document processing | Private OCR and schema-driven LLM extraction; no policy database access | Versioned authenticated `/v1/extract` JSON contract | Independent processor image and self-hosted model |
| Asynchronous messaging | Reliable publishing of business events | Versioned event schemas | Dispatcher process, pluggable transport |

## Decisions

- **Ports first, then split.** Each module goes behind an interface inside this
  codebase with the existing in-process behavior as its first implementation.
  A second implementation calls the module over the network. A stack that
  keeps the default sees no change.
- **Rating stays in the API flow.** Rating runs inside the Policy API process
  and is called directly. No rating interface, asynchronous callers, or
  standalone rating service is being built now. If rating is later needed as a
  separate product, a copy of the rating code is split out and hosted as its
  own application then. To keep that possible, rating code should not reach
  into policy tables: it prices a payload from a product definition
  (`server/src/lib/product-snapshot.ts`).
- **The outbox stays.** An event is recorded in the same transaction as the
  change that caused it. The dispatcher publishes through a transport adapter.
- **Transports:** the existing webhook, and Kafka as the second adapter
  (`EVENT_TRANSPORT`). Both deliver the same envelope.
- **One release image, several start commands** for API, worker, and
  dispatcher, so the deployment kit can run them as separate services.
- **Each module owns its tables.** No module joins across another's.

## What Exists Today

| Module | State |
| --- | --- |
| UI | Separate application and image. |
| Document processing | Standalone Node service in `services/document-processor`, local OCR and private OpenAI-compatible inference. Submission intake supplies the schema and retains review/approval. Independent `services/document-learning` jobs curate approved examples, calculate held-out evaluation, optionally train offline weights and register candidates. Technical-admin approvals gate signed deployment. See `docs/PRIVATE_DOCUMENT_PROCESSING.md` and `docs/DOCUMENT_LEARNING.md`. |
| Shared runtime packages | `packages/rules` (rule expressions, screen rules) is the first package both the API and UI import at run time: the wizard renders a carrier pack screen with it and the API enforces the same rules when a quote is rated. `packages/types` remains types only. |
| Rating | In-process function `rate()` in `server/src/services/rating.service.ts`, called synchronously from 16 places in 9 files. Staying that way by decision. It prices from a product definition, either today's or the snapshot a policy term is pinned to. |
| Batch jobs | Runs as its own process (`LATTICE_ROLE=worker`, or `node server/dist/worker.js`); the deployment kit runs it as the `worker` service. Handlers still import core code and the database directly, so it shares the release image. |
| Asynchronous messaging | Policy transactions write `ledger_events`; a trigger copies each into `async_message_outbox`, and notifications are added there too. Its own process (`LATTICE_ROLE=dispatcher`, or `node server/dist/dispatcher.js`) delivers them in a versioned envelope through a pluggable transport: webhook or Kafka. See `docs/EVENTS.md`. |

## Process Roles

One release image runs as any of four roles, chosen by `LATTICE_ROLE`:

| Role | Serves | Runs |
| --- | --- | --- |
| `all` (default) | Full API | Job worker and dispatcher, each obeying its own switch (`JOB_WORKER_ENABLED`, `ASYNC_PUSH_ENABLED`). This is how every deployment ran before roles existed. |
| `api` | Full API | No background loops. |
| `worker` | `/health`, `/version` only | Job scheduler and worker, regardless of `JOB_WORKER_ENABLED`. |
| `dispatcher` | `/health`, `/version` only | Outbox delivery, regardless of `ASYNC_PUSH_ENABLED`. |

- `planProcess` in `server/src/config.ts` is the single definition of what
  each role starts; `server/src/index.ts` follows it.
- A worker or dispatcher exits at startup without a database.
- Every role validates the carrier pack and applies pending migrations at
  startup (migrations are serialized by an advisory lock).
- `GET /version` reports the role.
- Known limit: the published rating model cache is in process memory and is
  refreshed only in the process that publishes a workbook. No job rates a
  policy today, so the worker is unaffected, but any process that rates must
  either be the API or get cache invalidation first. This also applies to
  running more than one API replica.

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
2. Process split (done): API, worker, and dispatcher roles and kit services.
3. Event contracts and transports (done): a versioned envelope, a transport
   interface, and a Kafka transport beside the webhook.

Not planned: a rating interface with asynchronous callers and a standalone
rating service. Rating stays in the API flow (see Decisions).
