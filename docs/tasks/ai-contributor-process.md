# Task Note: AI Contributor Process

## Links

- Issue: none
- Pull request: pending

## Summary

Added a repository-level process so new contributors can fork LatticePolicy,
open it in Codex or another coding agent, and start work from a minimal prompt.
The process defines which Markdown context an agent should read first and how
contributors should keep AI-readable handoff notes current.

## Important Files

- `AGENTS.md`: first-stop guide for AI coding agents.
- `docs/AI_CONTRIBUTOR_PROCESS.md`: full contributor process for AI-readable
  context and task notes.
- `docs/tasks/TEMPLATE.md`: reusable task-note structure.
- `docs/tasks/README.md`: purpose and location of task notes.
- `CONTRIBUTING.md`: contributor-facing requirement.
- `.github/pull_request_template.md`: PR checklist enforcement point.
- `docs/PROJECT_CONTEXT.md`: project map now points agents to the process.

## Behavior Rules

- Non-trivial code changes should update existing Markdown docs or add a task
  note under `docs/tasks/`.
- Behavior changes should include automated tests in the same PR unless a clear
  exception is documented.
- Very small commits inside a larger PR can share one Markdown context update,
  but the final branch must contain durable AI-readable context before review.

## Automated Tests

- Tests added or updated: none.
- Test layer used: not applicable.
- Why this layer is enough: documentation-only process change with no product
  behavior change.

## Validation

```bash
git diff --check
```

## Follow-Ups Or Risks

- Reviewers need to enforce the new PR checklist consistently.
- Future issue templates could link to `docs/tasks/TEMPLATE.md` if maintainers
  want stronger upfront task-note guidance.
