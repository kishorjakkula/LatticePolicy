# Security and compliance — WP-0001

| Check | Result | Notes |
| --- | --- | --- |
| Tenant isolation and RLS | Not applicable | No application code, database or tenant data is touched. |
| Server-side authorization | Not applicable | No API changes. |
| Customer-safe projections | Not applicable | No customer portal changes. |
| Input validation and injection | Pass | The PR body and author reach `delivery-checks.yml` through environment variables, never interpolated into shell; HTML comments and placeholder reasons are rejected. `knowledge-refresh.yml` passes generated Markdown through a file (`--body-file`). Front matter is parsed by a fixed subset parser; no `eval`. |
| Secrets and sensitive logging | Pass | No secrets added. Contracts forbid secrets and customer data in work packages (deployment, end-to-end contracts). |
| Audit (AI vs person actions) | Pass | Gate approvals, waivers, returns and resolutions are recorded with name, date and quoted words in `status.json` history; agents may not approve gates. |
| AI data boundary | Pass | Contracts restate that carrier-private inference never falls back to external AI; the knowledge refresh uses public sources only. |
| Regulatory (filings, notices, disclosures, privacy) | Not applicable | Process change; the business analyst and security contracts now require these checks on future work. |
| Code scanning and dependency results | Pass | CodeQL, dependency audit and dependency review passed on the PR's first commit; no new dependencies (scripts use Node built-ins only). Workflow permissions: `contents: read` (PR check), `contents: read` + `issues: write` (refresh). |

## Findings

| Severity | Finding | Resolution | Outcome |
| --- | --- | --- | --- |
| Low | Branch protection has `enforce_admins` off, so a repository admin can merge without the code-owner review that protects recorded approvals (noted by the re-review). | Recommend enabling "Do not allow bypassing the above settings" for `main`; a repository setting the product owner decides. | accepted — recommendation to the product owner |
