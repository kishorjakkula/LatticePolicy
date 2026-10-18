# 0001. Tool-neutral delivery agents with human gates

- Status: accepted
- Date: 2026-10-17
- Work package: WP-0001

## Context

LatticePolicy is built with several AI coding assistants. Each tool has its own
way of configuring agents, and quality depended on how each session was
prompted. The product owner asked for a fixed sequence of specialist agents —
business analysis, architecture, development, unit tests, automation tests,
deployment, end-to-end tests and business validation — that works whichever AI
writes the code.

## Decision

- Agents are Markdown role contracts in `agents/`; the workflow is
  `docs/delivery/WORKFLOW.md`; handoffs are files in `docs/work/<WP>/`.
- `scripts/delivery/sync-agents.mjs` generates each tool's files from the
  contracts; CI fails when they drift.
- Added to the requested agents: orchestrator, test designer, independent code
  reviewer, security and compliance, knowledge curator; a UI/UX designer was
  added at the product owner's request.
- Three tracks (quick, standard, major) and four human gates (A requirements,
  B design, C merge, D business sign-off). Agents never approve gates, merge or
  deploy to production.
- Domain and architecture knowledge lives in `docs/knowledge/` with sources and
  review dates; a monthly workflow flags stale files for a reviewed refresh.

## Consequences

- Any tool or person can continue a work package from its files.
- More process for small changes is avoided by the quick track.
- Knowledge stays current only if refresh issues are worked; stale files are
  visible in `npm run knowledge:report`.

## Alternatives considered

- Vendor-specific agent configuration only (for example only Claude Code
  sub-agents): rejected, ties the process to one tool.
- A hosted orchestration service: rejected for now; files in the repository are
  simpler, reviewable and work offline.
