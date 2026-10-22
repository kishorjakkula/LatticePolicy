# Security and compliance — WP-0004

Status: scoped local security review completed; no open high/critical finding
identified in this change. Independent reviewers: Mendel, Boyle and Gibbs,
separate from the developer. Gate B extension explicitly approved 2026-10-21;
Migration 069 implemented. No human Gate C/D approval or production certification.

| Check | Result | Notes |
| --- | --- | --- |
| Tenant isolation and RLS | Scoped checks passed | Full fresh disposable PostgreSQL suite: 298 passed with RLS; foreign bulk IDs reject atomically. Work counts keyed by tenant/user. |
| Server-side authorization | Verified scoped fixes | Exact proposal evidence, explicit decision/authority guards, legacy fail-closed behavior and atomic quote/approval consumption; independent re-review passed. |
| Customer-safe projections | No projection change | Existing portal unit/browser regressions remain in the suites; no new customer-facing data fields added. |
| Input validation and injection | Scoped checks passed | Strict bulk UUID/count/status/reason schema; parameterized queries, bounded lock waits; audit filter validation and CSV protections retained. |
| Secrets and sensitive logging | Scoped review passed | Tenant-private business snapshot; sensitive field/binary digests only, no raw document/credential copy or proposal-content logging. Canonicalization/redaction and malicious display-marker regressions pass. |
| Audit (AI vs person actions) | Scoped checks passed | AI trails stay append-only; actor provenance is a read projection. Bulk filing changes use authenticated user before/after events. |
| AI data boundary | Unchanged | No inference/training provider or off-stack transport change. |
| Regulatory (filings, notices, disclosures, privacy) | Limited review | Filed templates/rates/notice rules unchanged; status changes audited. No jurisdiction-specific certification claimed. |
| Code scanning and dependency results | Partial | npm audit policy passes with existing allowlisted Puppeteer/extract-zip advisories. No fresh remote CodeQL/container-scan result claimed. |

## Findings

| Severity | Finding | Resolution | Outcome |
| --- | --- | --- | --- |
| High | Same reason/date approval can authorize a materially changed proposal. | Approved immutable evidence/hash and Migration 069, all four caller paths tested; independently re-reviewed. | Verified fixed. |
| High | Concurrent binds spend one approval twice. | Quote and approval locks/revalidation inside the policy-creation transaction; real HTTP race regression. | Verified fixed. |
| High | Client redaction-marker field hides material sibling facts. | Exact singleton 64-hex marker handling; malicious sibling risk/coverage test. | Verified fixed. |
| Medium | Cross-principal count cache and dialog/contrast/rollback regressions. | Implemented focused fixes and automated regressions; independent review evidence in `07-code-review.md`. | Fixed for tested scope, not overall production certification. |

## PR #394 CI Environment Follow-Up

The CI and disposable Docker runner now enable tenant RLS explicitly. The
existing isolation assertion is unchanged. Independent review confirmed that
test database guards, restricted-role enforcement and application permission
checks are preserved. No new secrets, production configuration, migration,
audit mutation or AI data-boundary change is introduced by this correction.
