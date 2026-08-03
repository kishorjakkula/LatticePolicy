# Dependabot Noise Control

## Summary

Tuned Dependabot so dependency maintenance remains active while keeping the
open pull request queue small enough for maintainers and contributors to review.

## Why

After enabling Dependabot, the repository opened separate npm and GitHub Actions
update PRs up to the previous configured limits. That is useful signal, but ten
open bot PRs makes the project harder to triage.

## Changed Files

- `.github/dependabot.yml`: reduced open PR limits, added stable weekly
  windows, kept npm minor/patch grouping, and added GitHub Actions minor/patch
  grouping.

## Policy

- Keep Dependabot enabled for security and maintenance visibility.
- Limit npm version update PRs to three open PRs.
- Limit GitHub Actions version update PRs to two open PRs.
- Group minor and patch updates together.
- Let major updates remain separate so maintainers can review risk clearly.
- Do not auto-merge dependency updates until CI, integration, E2E, and security
  checks are green for the affected dependency set.

## Operational Note

This configuration affects future Dependabot runs. Existing Dependabot PRs may
need to be reviewed, merged, closed, or recreated manually.

## Validation

- YAML syntax parsed locally with Ruby.
