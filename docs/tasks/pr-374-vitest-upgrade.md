# Vitest 5 toolchain alignment

PR: https://github.com/kishorjakkula/LatticePolicy/pull/374

Vitest 5 requires Node 22.12+, and its coverage provider must match the runner.
The previous upgrade retained a Vitest 4 coverage provider and the generic
jest-dom setup, producing incompatible assertion types during typecheck.

- Align both workspace coverage providers with Vitest 5.0.5.
- Import `@testing-library/jest-dom/vitest` to register and type the matchers.
- Pin Node 22 for local tooling, Actions, test containers and application
  images; the package engine documents the supported Vitest Node ranges.
- Keep the existing coverage thresholds and application behavior unchanged.

Validation: clean install, workspace build/typecheck, shared/server/frontend
tests, both coverage suites, security policy, DB integration, Playwright and
synthetic pilot checks. The existing matcher assertions and coverage gates
exercise this tooling change without adding tests that mirror configuration.
