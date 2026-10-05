# Issue 319: Production Policy Scenario Matrix

## Goal

Provide deterministic, reusable policy-production scenarios whose failures identify the specific business invariant that broke.

## Coverage

The DB-backed matrix covers:

- referred and declined new business;
- backdated and out-of-sequence endorsements;
- flat, pro-rata, and short-rate cancellation;
- cancellation followed by reinstatement;
- renewal with changed coverage inputs;
- non-renewal notice deadlines;
- idempotent retries and side-effect deduplication;
- optimistic concurrency; and
- tenant isolation.

Every successful transaction is checked for a policy version, numeric premium, pinned form, document packet, rating reference, and correlated ledger event. Assertions include the scenario and violated invariant in their messages.

## Reuse

Shared builders and invariant assertions live in `server/src/__tests__/fixtures/policy-scenarios.ts`. New scenarios should use these helpers instead of duplicating tenant, quote, form, bind, and issue setup.

The Playwright critical path in `e2e/production-policy-scenarios.spec.ts` verifies that a cancellation executed through the API is visible as cancelled in the policy UI with its transaction history. Both the DB integration suite and all Playwright specs are mandatory CI jobs.

## Commands

```bash
npm run test:integration
npm run test:e2e:docker
```
