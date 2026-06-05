# GitHub Security Issue Drafts

Generated from `npm audit --json` for contributor-friendly remediation issues.

## 1. Security: upgrade Vitest and coverage tooling for critical advisory

### Summary

`npm audit` reports critical vulnerabilities in the test tooling chain:

- `vitest` severity: critical
- `@vitest/coverage-v8` severity: critical through `vitest`

### Advisory Details

- `vitest`: "When Vitest UI server is listening, arbitrary file can be read and executed"
- Advisory: https://github.com/advisories/GHSA-5xrq-8626-4rwp
- CWE: CWE-862
- CVSS: 9.8
- Affected range: `<4.1.0`

### Current Audit Path

- `vitest` is a direct dependency
- `@vitest/coverage-v8` is a direct dependency and is affected through `vitest`

### Suggested Fix

Upgrade the test tooling to the fixed major versions reported by npm audit:

- `vitest@4.1.8`
- `@vitest/coverage-v8@4.1.8`

This is a semver-major upgrade, so contributors should verify any config/API changes required by Vitest 4.

### Validation

```bash
npm install
npm run test
```

Expected result: server tests, frontend tests, and typecheck pass with no remaining Vitest critical advisory.

## 2. Security: update React Router dependencies for high-severity advisories

### Summary

`npm audit` reports high-severity vulnerabilities in the React Router dependency chain:

- `react-router` severity: high
- `react-router-dom` severity: high through `react-router`

### Advisory Details

Reported advisories include:

- Unauthenticated RCE via vendored `turbo-stream` TYPE_ERROR deserialization: https://github.com/advisories/GHSA-49rj-9fvp-4h2h
- Open redirect through protocol-relative URL reinterpretation: https://github.com/advisories/GHSA-2j2x-hqr9-3h42
- XSS in unstable RSC redirect handling: https://github.com/advisories/GHSA-8646-j5j9-6r62
- Stored XSS via unescaped Location header in prerendered redirect HTML: https://github.com/advisories/GHSA-f22v-gfqf-p8f3
- DoS via unbounded path expansion in `__manifest` endpoint: https://github.com/advisories/GHSA-8x6r-g9mw-2r78

### Current Audit Path

- `react-router-dom` is a direct dependency
- `react-router` is pulled through `react-router-dom`

### Suggested Fix

Upgrade `react-router-dom` and the resolved `react-router` package to versions outside the affected ranges. `npm audit` reports a fix is available.

### Validation

```bash
npm install
npm run test
```

Also smoke-test the frontend routes in local Docker, especially search, quote wizard, policy detail, login redirects, and protected routes.

## 3. Security: upgrade Drizzle tooling and ORM to resolve SQL injection/esbuild advisories

### Summary

`npm audit` reports vulnerabilities in the Drizzle dependency chain:

- `drizzle-orm` severity: high
- `drizzle-kit` severity: moderate
- `esbuild` severity: moderate through Drizzle tooling
- `@esbuild-kit/core-utils` and `@esbuild-kit/esm-loader` severity: moderate through `esbuild`

### Advisory Details

#### `drizzle-orm`

- Title: "Drizzle ORM has SQL injection via improperly escaped SQL identifiers"
- Advisory: https://github.com/advisories/GHSA-gpj5-g38j-94v9
- CWE: CWE-89
- CVSS: 7.5
- Affected range: `<0.45.2`
- Audit fix: `drizzle-orm@0.45.2` semver-major

#### `esbuild`

- Title: "esbuild enables any website to send any requests to the development server and read the response"
- Advisory: https://github.com/advisories/GHSA-67mh-4wv8-2f99
- CWE: CWE-346
- CVSS: 5.3
- Affected range: `<=0.24.2`
- Audit fix path: upgrade `drizzle-kit` to `0.31.10`, semver-major

### Suggested Fix

Upgrade:

- `drizzle-orm` to `0.45.2` or newer
- `drizzle-kit` to `0.31.10` or newer

Because this touches schema/migration tooling, contributors should verify migration generation, local DB startup, and server typecheck.

### Validation

```bash
npm install
npm run test
npm run typecheck --workspaces --if-present
```

Also run the local Docker stack and verify API health plus quote/policy flows.

## 4. Security: replace or mitigate SheetJS xlsx vulnerabilities

### Summary

`npm audit` reports high-severity vulnerabilities in the direct `xlsx` dependency. No npm audit fix is currently available for this package.

### Advisory Details

#### Prototype Pollution

- Package: `xlsx`
- Advisory: https://github.com/advisories/GHSA-4r6h-8v6p-xvw6
- CWE: CWE-1321
- CVSS: 7.8
- Affected range: `<0.19.3`

#### Regular Expression Denial of Service

- Package: `xlsx`
- Advisory: https://github.com/advisories/GHSA-5pgg-2g8v-p4x9
- CWE: CWE-1333
- CVSS: 7.5
- Affected range: `<0.20.2`

### Current Audit Path

- `xlsx` is a direct dependency
- `npm audit` reports `fixAvailable: false`

### Suggested Fix Options

Investigate one of these approaches:

- Replace `xlsx` with a maintained alternative for the project use cases, such as ExcelJS or another actively patched parser/writer.
- If replacement is too large, isolate `xlsx` usage and add input restrictions around uploaded/imported spreadsheets.
- Document any accepted residual risk if the package is only used in trusted/admin-only paths.

### Validation

```bash
npm install
npm run test
```

Also manually verify any spreadsheet import/export workflows affected by the replacement or mitigation.
