---
title: Tech radar
last_reviewed: 2026-10-17
review_every_days: 90
sources: repository package manifests and current practice; review against official release notes when refreshing
---

# Tech Radar

| Ring | Technology or practice | Notes |
| --- | --- | --- |
| Adopt | TypeScript, Express, PostgreSQL with RLS, Drizzle with raw SQL where clearer | Current stack |
| Adopt | React, Vite, TanStack Query, Zustand | Current frontend |
| Adopt | Zod for request and config validation | Server and shared types |
| Adopt | Vitest, Playwright, disposable PostgreSQL for integration tests | `docs/TEST_PLAN.md` |
| Adopt | Shared rules package for logic the UI and API both run | `packages/rules` |
| Adopt | Signed, verified releases for models; append-only hash-chained audit | `docs/LLM_RELEASE_GOVERNANCE.md` |
| Adopt | Delivery agents with human gates | `docs/delivery/WORKFLOW.md` |
| Trial | Carrier-private document processing with OCR and local models | `docs/PRIVATE_DOCUMENT_PROCESSING.md` |
| Trial | OpenTelemetry tracing across API, worker and dispatcher | `docker-compose.observability.yml` |
| Assess | Cloud KMS/HSM behind the release signer contract | Replaces the signer key file |
| Hold | Sending carrier documents to external AI without an explicit data-boundary decision | Default stays private |
| Hold | Hard-coded per-product rules where configuration exists | Use product packs and admin rules |
