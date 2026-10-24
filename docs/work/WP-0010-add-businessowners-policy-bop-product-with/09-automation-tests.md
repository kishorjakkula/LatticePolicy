# Automation tests — WP-0010

## Specs added or changed

- `e2e/businessowners.spec.ts` (Codex's spec, made runnable):
  - covers the BOP wizard, package terms, rating and submission review at 1440px and 390px, against a mocked API;
  - loads the product pack with `__dirname`, because `import.meta` fails under this Playwright setup;
  - mocks only `/api/` paths, because the dev server also serves `/src/api/*.ts`;
  - opens steps through the compact toggle on phones.
- `playwright.businessowners.config.ts`: an isolated run on its own dev-server port.
- API-level coverage is in the database suites: `businessowners-lifecycle`, `businessowners-demo` and `businessowners-authorization` (see `06-unit-tests.md`).

## Runs

- Local, `npx playwright test -c playwright.businessowners.config.ts`: passed 4 times (2 tests each), including after each round of review fixes.
- CI on PR #399, head c0de807:
  - Build, Test, Typecheck: pass. https://github.com/kishorjakkula/LatticePolicy/actions/runs/40057314285/job/120763172245
  - DB Integration Tests: pass. https://github.com/kishorjakkula/LatticePolicy/actions/runs/40057314285/job/120763172040
  - Playwright E2E (full isolated Docker suite, which includes the BOP spec): pass. https://github.com/kishorjakkula/LatticePolicy/actions/runs/40057314285/job/120763172225
  - CodeQL, Container Scan, Dependency Review, pilot and the work-package check: pass.

## Environment-only failures

- Dependency Audit fails (https://github.com/kishorjakkula/LatticePolicy/actions/runs/40057314212/job/120763040316). It is not caused by this PR, which changes no `package.json` or lockfile. The Security workflow on `main` fails the same way at 235ee7c (run 40025225655). It needs a separate dependency PR, or the owner's explicit acceptance at Gate C.
- Locally, one existing test (`policy-lifecycle.integration.test.ts`) timed out once while a browser run shared the machine. It passed alone, in the clean full run and in CI.
