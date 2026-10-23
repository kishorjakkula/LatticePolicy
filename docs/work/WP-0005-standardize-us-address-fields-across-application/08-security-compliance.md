# Security And Compliance - WP-0005

Local code/security assessment; hosted scanning and merge checks remain pending.
Read SECURITY.md, MULTITENANCY.md, ENTERPRISE_IDENTITY_SECURITY.md and
LLM_RELEASE_GOVERNANCE.md. No approval or production-fitness certification.

| Check | Result | Notes |
| --- | --- | --- |
| Tenant isolation and RLS | Pass locally | Exact-tenant/pinned config; existing tenant transaction paths retained; real restricted RLS role asserted; full PostgreSQL 302 passed. |
| Server-side authorization | Pass locally | Existing edit permissions; customer role denied; contact-only updates preserve identity/entity type. R1/R6 fixed and independently reviewed. |
| Customer-safe projections | Pass by inspection | No new customer portal editing or identity reveal; masked DOB stays encrypted on address-only save. |
| Input validation and injection | Pass locally | Strict bounded postal envelope, 4 KB route parser on accepted aliases, fixed HTTPS host, no redirects, 256 KB/5-candidate/5-second limits; per-tenant/user limiter tested. |
| Secrets and sensitive logging | Pass by inspection/tests | No new secret/key required; upstream errors sanitized, no address URLs or bodies logged by new paths; no-store/idempotency bypass; parser error responses sanitized. |
| Audit (AI vs person actions) | Pass by inspection | Existing customer-save audit remains; no AI/person approval substitution; no audit UPDATE/DELETE added. Matching itself writes no policy/customer data. |
| AI data boundary | Not applicable to inference | No inference, training or external-AI fallback added; external postal recipient is independently disclosed/disabled by default. |
| Regulatory (filings, notices, disclosures, privacy) | Carrier rollout pending | No filed rates/forms/notice rules changed. Census range match is not deliverability/unit certification; real-data enablement needs carrier privacy/terms approval. |
| Code scanning and dependency results | Local audit policy passes; hosted scans pending | Targeted lockfile-only ip-address 10.7.3 -> 10.7.4 fixes GHSA-rxp7-6hxx-x8q5. Only one installed package changed; no manifest/API changes. Existing accepted Puppeteer/extract-zip advisories remain under the unchanged project audit policy. Hosted CodeQL/container/dependency checks have not run for this branch. |

## Findings

| Severity | Finding | Resolution | Outcome |
| --- | --- | --- | --- |
| High/medium in initial code review | R1-R6 including response replay, identity authorization and data projection issues | Fixed and independently rechecked; see 07 | Fixed |
| Medium, baseline dependency | ip-address advisory above | Updated locked transitive package to 10.7.4; audit policy passes with no new exceptions | Fixed |

No open high/critical local code findings. Security stage remains pending until
hosted scan results can be resolved/reviewed. Do not
describe the branch as all-security-checks-green. No real carrier addresses were
sent to a provider; service mocks and one public-address smoke only.
