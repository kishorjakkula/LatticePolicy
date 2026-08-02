# GitHub Roadmap Setup

This guide defines the GitHub planning setup for LatticePolicy. The repository
roadmap lives in `docs/ROADMAP.md`; this page explains how maintainers should
represent that roadmap in GitHub Issues, Projects, labels, and milestones.

## Goals

- Make the backlog easy to scan by phase, priority, domain, and readiness.
- Help contributors find well-scoped work.
- Keep roadmap issues, PRs, docs, and AI-readable task notes connected.
- Avoid relying on private chat history for project planning context.

## Project Board

Create a GitHub Project named:

```text
LatticePolicy Carrier & Reinsurance Roadmap
```

Recommended views:

- Roadmap table: all open issues grouped by `Status`.
- Pilot board: filter `Readiness = Pilot`.
- Production board: filter `Readiness = Production`.
- Contributor board: filter `good first issue` or `help wanted`.
- Domain board: group by `Domain`.

Recommended fields:

| Field | Type | Values |
| --- | --- | --- |
| Status | Single select | Inbox, Needs Analysis, Ready, In Progress, In Review, Blocked, Done |
| Priority | Single select | P0, P1, P2 |
| Readiness | Single select | Demo, Pilot, Production |
| Domain | Single select | Policy, Underwriting, Documents, Compliance, Reinsurance, Exposure, Integration, Security, Operations, Product, Testing, Docs |
| Size | Single select | S, M, L, XL |
| Owner | Text or people | Maintainer or contributor owner |

## Labels

The canonical labels are listed in `.github/labels.yml`.

Label conventions:

- Use exactly one `type:*` label when possible.
- Use one `priority:*` label on roadmap issues that are ready to compare.
- Use one or more `domain:*` labels for affected areas.
- Use `readiness:*` labels to separate demo, pilot, and production outcomes.
- Add `good first issue` only when the task is truly bounded for a new
  contributor.
- Add `help wanted` when maintainers are comfortable with an external
  contributor owning the task.

## Milestones

The canonical milestones are listed in `.github/milestones.yml`.

Recommended mapping:

| Milestone | Roadmap phase |
| --- | --- |
| Carrier Pilot Readiness | Phase 1 |
| Insurance Platform Readiness | Phase 2 |
| Reinsurance Compatibility | Phase 3 |
| Product Governance And Filing Readiness | Phase 5 |
| Enterprise Security And Compliance Readiness | Phase 6 |
| Production Operations And Integration Readiness | Phase 7 |
| Contributor Experience | Cross-cutting contributor and documentation work |

Phase 4 ACORD and GRLC work can be tracked under Reinsurance Compatibility or a
dedicated future milestone if the backlog grows.

## Issue Triage Rules

For each new issue:

1. Confirm whether it is an epic, task, bug, docs, test, or research item.
2. Add priority only after scope is understood.
3. Add readiness and domain labels.
4. Link parent epics in the issue body when applicable.
5. Add a milestone when the issue belongs to a roadmap phase.
6. Mark `good first issue` only when expected files, validation commands, and
   acceptance criteria are clear.

## Pull Request Rules

Every roadmap PR should:

- link the issue it addresses,
- update tests for behavior changes,
- update AI-readable Markdown context for non-trivial changes,
- preserve tenant isolation and security boundaries,
- update API, architecture, deployment, or Wiki-facing docs when public behavior
  changes.

## Wiki Synchronization

Repository docs are the source of truth. The Wiki should summarize stable,
merged content from:

- `docs/PROJECT_CONTEXT.md`
- `docs/ROADMAP.md`
- `docs/TEST_PLAN.md`
- `docs/AI_CONTRIBUTOR_PROCESS.md`
- `docs/tasks/*.md`

Update Wiki pages after meaningful PRs merge, not while work is still in review.

Suggested Wiki pages:

- Project Overview
- Application Functionality
- Architecture
- Development Process
- AI Contributor Guide
- Testing Strategy
- Roadmap
- Production Readiness
- Contribution Areas

## Initial Setup Checklist

- [ ] Create the GitHub Project board.
- [ ] Add project fields and views.
- [ ] Create labels from `.github/labels.yml`.
- [ ] Create milestones from `.github/milestones.yml`.
- [ ] Apply labels and milestones to roadmap issues.
- [ ] Link the Project board from `docs/ROADMAP.md` after the public URL exists.
- [ ] Link stable Wiki pages from README after they are created.
