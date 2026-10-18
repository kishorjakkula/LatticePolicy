# Release — WP-0001

- Revision / version: `main` at 4b4c068 (PR #382 ef18fa9, PR #383 4b4c068); application version unchanged (0.2.3).
- Migrations: none.
- New configuration (names only): none. New repository automation: `delivery-checks.yml` (pull requests), `knowledge-refresh.yml` (monthly, `issues: write`).
- Rollback: revert PRs #383 and #382; no data or runtime state to undo. Work packages under `docs/work/` are plain files.

## Release notes

- Every coding request follows the LatticePolicy delivery flow (`docs/delivery/WORKFLOW.md`): 14 specialist agents, quick/standard/major tracks, human gates for requirements, design, merge and business sign-off.
- Works with any AI assistant: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Claude sub-agents, Copilot prompts and Cursor rules are generated from `agents/`.
- `npm run flow -- start "<request>"` creates a work package; pull requests must name it (or declare a quick change).
- Knowledge bases for P&C insurance, UI/UX and architecture with review dates and a monthly refresh issue.

## Deployments

| Environment | When | Revision | Health | By |
| --- | --- | --- | --- | --- |
| staging (local Docker stack built from `main`) | 2026-10-18 15:23 UTC | 4b4c068 | API and database healthy, UI 200, all four containers up | Deployment agent |
| production | after Gate D | — | — | — |

There is no separate production environment for this repository today; for a
process and tooling change, "production" is `main` itself, which already
carries the change. Gate D records the business owner's acceptance.
