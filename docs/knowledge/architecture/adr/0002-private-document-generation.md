# 0002. Independent Carrier-Private Document Generation

- Status: accepted at Gate B by Kishor Jakkula; implementation pending
- Date: 2026-10-18
- Work package: WP-0003

## Context

Carriers require large volumes of PDF, DOCX and XLSX output without coupling
rendering latency/failure to policy transactions. A private stateless renderer
foundation exists in an unmerged worktree, but its coordinator remains in the
Policy API image and actual packet conversion/assembly and governance are incomplete.

## Decision

Use a carrier-private document module with its own coordinator/catalog and
bounded format/conversion workers. Policy applications supply authorized immutable
snapshots through a transactional outbox; idempotent module completion updates
the matching application revision. Publish a complete verified manifest atomically.
Keep source/templates/assets/engines pinned and preserve original issued bytes.
Separate delivery authorization from generation and keep bind/issue semantics
unchanged unless a carrier approves a finalization-gate matrix.

Retain the monorepo, publish independent images/contracts/template packages, and
use replaceable rendering adapters. Initially use PostgreSQL durable work queues;
external broker adapters are replaceable transport choices, not prerequisite
technology churn. Distinct urgent/bulk budgets, deadlines, leases/fencing,
reconciliation, observability and recovery evidence are required.

## Consequences

Independent deployment/scaling and tenant privacy improve, at the cost of explicit
cross-store consistency, migration/routing and template governance. Software and
template compatibility become published contracts. PDF-A/signing/accessibility
and Office feature parity must be qualified, not inferred from basic file output.
No production readiness claim without approved workload, cloud and recovery/UAT
evidence. Engine-specific limitations can require a separately approved private SDK.

## Alternatives Considered

In-process Policy API rendering is simpler but fails isolation/release goals.
External SaaS conflicts with the current carrier-private boundary. A commercial
self-hosted SDK can replace an engine, but does not replace the reliability layer.

## Approval

Gate A is approved; Gate B design acceptance is pending. No ADR acceptance or
implementation authorization is recorded by the document author.
