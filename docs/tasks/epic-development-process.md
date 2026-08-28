# Task Note: Epic Development Workflow

## Links

- Issue:
- Pull request:

## Summary

Analyzed all 7 phase epics (#70-#76) plus the master roadmap epic (#69)
against real child-issue state (not the static checklist text in each
epic body) and found every phase epic had made substantial progress —
40% to 78% of child issues closed — but none had ever been closed or
had its checklist updated, and several blocking child issues (e.g.
#47, #48, #60, #62) looked functionally complete from merged PRs but
were left open with no process step that ever revisited them. Added
`docs/EPIC_WORKFLOW.md` defining a repeatable audit procedure, a
child-issue completion convention (`Closes` vs `Progresses`), role
boundaries for who may close an epic/issue, and an audit cadence.

## Important Files

- `docs/EPIC_WORKFLOW.md`: the process itself — epic anatomy, why
  progress isn't self-maintaining, the audit procedure, roles, and
  cadence.
- `docs/ROADMAP.md`: cross-linked from the Execution Model section.
- `docs/GITHUB_ROADMAP_SETUP.md`: added an epic-specific triage rule
  pointing at the new workflow doc.
- `AGENTS.md`: pointed AI contributors at the workflow doc and made
  explicit that closing an issue/epic is a shared-state action
  requiring maintainer authorization, not something to assume is
  allowed.
- `README.md`: doc-index link.

## Behavior Rules

- An epic's `- [ ] #NN` checklist is a planning-time snapshot; GitHub
  does not rewrite it when the linked issue closes. Anyone auditing an
  epic must query real issue state, not trust the rendered checkbox.
- A PR should say `Closes #NN` only when the issue's full stated scope
  is met; otherwise `Progresses #NN` with an explicit remaining-scope
  note. Epic completion percentages are only meaningful if this
  convention is honest.
- AI contributors should propose epic/issue closures with evidence
  rather than perform them, since closing issues has previously been
  blocked by this environment's permission layer even when opening PRs
  was allowed.

## Automated Tests

- Tests added or updated: none.
- Test layer used: documentation/process review.
- Why this layer is enough: this is a process document with no runtime
  behavior change.

## Validation

```bash
npm run build
npm run test
npm run typecheck
```

## Follow-Ups Or Risks

- A concrete audit pass against #70-#76 using this new procedure is a
  natural next step: #47, #48, #60, and #62 in particular look
  functionally complete from merged PRs and are worth a maintainer
  review to close.
- Consider whether GitHub's native sub-issues feature (distinct from
  Markdown task lists) would reduce the "checklist goes stale" problem
  if/when it becomes available through the tooling used in this repo.
