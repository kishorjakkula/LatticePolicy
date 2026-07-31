# AI Contributor Process

This process helps new contributors fork LatticePolicy, open it in Codex or
another coding agent, and start useful work with minimal prompting.

## Goal

Every meaningful change should leave enough Markdown context for a future AI
agent to understand:

- what changed,
- why it changed,
- where the important code lives,
- which tests prove the behavior, and
- what remains risky or unfinished.

The goal is not more paperwork. The goal is a repo that can be understood from
the files in the repo, without relying on private chat history.

## First Prompt For A Fresh Agent

After forking and cloning the repository, a contributor should be able to give
an agent a short prompt like:

```text
Read AGENTS.md and docs/PROJECT_CONTEXT.md, then work on issue #<number>.
Follow the contributor process and update tests/docs as needed.
```

The agent should then read:

1. `AGENTS.md`
2. `docs/PROJECT_CONTEXT.md`
3. `docs/TEST_PLAN.md`
4. The GitHub issue or local task note
5. The relevant code, tests, and docs for the touched area

## Required AI-Readable Markdown

For every non-trivial code change, contributors must either update an existing
Markdown document or add a task note under `docs/tasks/`.

Use a task note when the change is not fully explained by existing docs, such
as:

- a feature implementation,
- a bug fix with important root cause,
- a security or tenant-isolation fix,
- a data model or migration change,
- a CI/deployment workflow change,
- a test strategy change,
- a multi-step issue that may continue across PRs.

Use existing docs instead of a task note when the change is simply updating
public setup, API, architecture, deployment, or test guidance.

## Task Note Location

Create task notes in:

```text
docs/tasks/issue-<number>-<short-slug>.md
```

Examples:

```text
docs/tasks/issue-21-insured-validation.md
docs/tasks/issue-44-automation-test-process.md
docs/tasks/ci-workspace-install-fix.md
```

If there is no GitHub issue, use a short descriptive slug.

## Task Note Contents

Use `docs/tasks/TEMPLATE.md` and keep entries concise. A useful note usually
fits on one page.

Each task note should include:

- summary,
- issue or PR links,
- files changed,
- behavior rules,
- tests added or updated,
- validation commands,
- known follow-ups or risks.

## Pull Request Expectations

Every PR should explain the AI context work in the PR template:

- which Markdown file was added or updated,
- why that file is enough for future contributors,
- or why no AI-readable doc update was needed.

Reviewers should ask for a doc or task note when a change would be hard for a
future agent to rediscover from code alone.

## Commit Expectations

Commits should be easy for both people and AI agents to understand:

- use an imperative commit subject,
- keep unrelated changes out,
- include tests with behavior changes,
- include the relevant Markdown context update in the same PR.

For very small commits inside a larger PR, the Markdown update can happen once
in the PR rather than in every individual commit. The final branch must contain
the AI-readable context before review.

## Keeping Context Current

Update these docs when their area changes:

- `AGENTS.md`: agent workflow, commands, repo-level rules.
- `docs/PROJECT_CONTEXT.md`: architecture, module map, domain behavior, major
  workflow changes.
- `docs/TEST_PLAN.md`: test policy, test commands, test-layer ownership.
- `docs/DEVELOPER_SETUP.md`: local setup, Docker, environment variables.
- `docs/API.md`: endpoint behavior and contracts.
- `docs/ARCHITECTURE.md`: architecture, lifecycle, tenancy, security, async,
  rating, or portal concepts.
- `docs/tasks/*.md`: issue-level implementation notes and handoffs.
