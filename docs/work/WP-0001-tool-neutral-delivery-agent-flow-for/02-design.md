# Design — WP-0001

## Options considered

1. **Vendor-specific agents only** (for example Claude Code sub-agents). Fast,
   but other assistants would not follow it. Rejected.
2. **Hosted orchestrator service.** Central state and automation, but adds
   infrastructure, credentials and a dependency for a process question. Rejected
   for now.
3. **Contracts and state as files in the repository, with generated tool
   adapters and a small CLI.** Works with every assistant and offline,
   reviewable in pull requests. **Chosen.**

## Components touched

- `agents/` — 13 canonical role contracts with machine-readable headers.
- `docs/delivery/` — `WORKFLOW.md` (stages, tracks, gates, decisions) and handoff templates.
- `docs/knowledge/` — P&C and architecture knowledge with review metadata; ADR 0001.
- `scripts/delivery/` — `lib.mjs`, `flow.mjs`, `sync-agents.mjs`, `check.mjs`, `knowledge-report.mjs`, tests.
- Generated: `AGENTS.md` delivery section, `CLAUDE.md`, `GEMINI.md`, `.claude/agents/`, `.github/copilot-instructions.md`, `.github/prompts/`, `.cursor/rules/delivery-flow.mdc`.
- CI: `ci.yml` step, `delivery-checks.yml`, `knowledge-refresh.yml`; PR template.

## Data and migrations

None. No application code, database or runtime configuration changes.

## API contract

None.

## Security, tenancy and audit

No product data. Work packages must not contain secrets or customer data
(stated in the deployment and E2E contracts). The refresh workflow has only
`issues: write`; the PR check has read-only permissions and reads the PR body
from an environment variable, never interpolated into the shell.

## Performance, operations and configuration

Scripts are dependency-free Node; the CI step adds seconds.

## Requirement mapping

| Requirement | Design element |
| --- | --- |
| REQ-1 | `agents/business-analyst.md`, `docs/knowledge/pc-insurance/` |
| REQ-2 | `agents/software-architect.md`, `docs/knowledge/architecture/` |
| REQ-3 | Remaining contracts, `WORKFLOW.md` stages, `flow.mjs` |
| REQ-4 | `sync-agents.mjs`, generated adapters, CI drift check |
| REQ-5 | Review metadata, `knowledge-report.mjs`, `knowledge-refresh.yml`, knowledge curator |
| REQ-6 | Orchestrator, test designer, code reviewer, security and compliance, knowledge curator, tracks, gates |

## ADR

`docs/knowledge/architecture/adr/0001-delivery-agents.md`.
