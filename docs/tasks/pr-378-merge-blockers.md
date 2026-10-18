# PR 378 Merge Blockers

## Summary

Fix the build, audit-chain concurrency and CodeQL rate-limit findings from
[PR 378](https://github.com/kishorjakkula/LatticePolicy/pull/378). Email remains
disabled by default. No model, document or deployment privacy boundary changes.

## Changes

- `065_audit_chain_serialized_sequence.sql`: allocate chain positions AFTER
  taking the existing per-table/carrier lock, in the same critical section as
  predecessor lookup and hashing. Remove sequence defaults so they cannot run
  before the trigger. Keep sequence ownership and append-only historical rows.
  Caller-supplied positions are overwritten; rollback gaps are valid.
- `audit-chain-concurrency.integration.test.ts`: deterministic two-connection
  regression for both audit tables, with an overtaking transaction, supplied
  positions and rollback. Checks actual final chain integrity, under RLS when
  enabled. The migration-upgrade test also expects 064 and 065.
- `ai-audit.service.ts`: explicit `AiAuditEntry[]` query return type fixes the
  implicit-any propagation into integration tests without weakening type checks.
- `llm-release.service.test.ts`: preserve the criticalErrors zero literal in
  the valid evaluation fixture, matching the strict release contract.
- AI audit component test: use array indexing supported by the frontend's
  configured TypeScript library instead of `Array.at` (no target/config change).
- Audit/release route modules: explicit per-IP route limits before permission,
  credential authentication and database work. Audit reads 120/15 minutes;
  integrity/export share 20/15 minutes. Release/credential reads share
  120/15 minutes; release actions and credential operations share 60/15 minutes.
  The existing global limiter still applies; limits remain per API instance.
- `governance-rate-limits.test.ts`: 429 and Retry-After behavior, separate read/
  expensive-action budgets and no authorization work after exhaustion.

## Rollout And Limitations

Migration 065 is forward-only because 064 may already be applied. It does not
re-hash or conceal an existing broken chain. Check integrity before/after a
reviewed deployment and investigate any historical break separately. Migration
takes exclusive locks on the two audit tables briefly; schedule accordingly.
No demo/pilot database is used for tests. Do not weaken approval, CodeQL, CI,
or branch protection to hide failures.

## Validation

- Targeted route/service unit tests: 38 passed.
- Fresh PostgreSQL 15 concurrency and upgrade integration: 3 passed.
- Full build/tests and GitHub checks must pass on the final pushed revision
  before merging; final outcome is recorded in the PR.
