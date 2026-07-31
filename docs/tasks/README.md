# Task Notes

Task notes are short AI-readable handoffs for non-trivial changes. They help a
future contributor or coding agent understand the issue, decisions, changed
files, tests, and follow-ups without needing private conversation history.

Create one when a change is not already obvious from existing docs:

```text
docs/tasks/issue-<number>-<short-slug>.md
```

Use `docs/tasks/TEMPLATE.md` as the starting point.

Do not duplicate full PR descriptions or long code walkthroughs. Keep the note
focused on durable context that will still be useful after the PR is merged.
