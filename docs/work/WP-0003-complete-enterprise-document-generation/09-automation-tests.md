# Automation Tests - WP-0003

Scope: forms master data and transaction archives. Full WP automation acceptance
remains pending for the independent document module and unsupported capabilities.

## Specs

- `e2e/forms-management.spec.ts`: existing seeded forms/read-only access,
  draft creation and real DOCX upload, field-catalog rule authoring, synthetic
  positive/negative/suppression cases and absence from live attachment preview.
- `e2e/policy-documents.spec.ts`: every listed output opens real content;
  requests preserve exact version and transaction scopes.
- `e2e/transaction-documents.spec.ts`: actual NB and endorsement versions,
  pinned form snapshots, scoped archive retrieval and byte-size/SHA-256 checks
  against both authenticated API bytes and the browser's resulting Blob.
  Historical views must not call current form preview/template/regeneration.

## Runs

```sh
npm run test:e2e:isolated -- e2e/forms-management.spec.ts e2e/policy-documents.spec.ts e2e/transaction-documents.spec.ts
```

Final run: **6 passed, 0 failed**, 7.9 seconds of browser execution after isolated
Docker build/startup. Earlier complete passing run: 6/6 before final label polish.
No CI run link is available: work is local and has not been pushed.

The disposable stack used API 3301/UI 5174 with independent volumes, and was
removed after each run. The running demo/pilot stacks were not replaced.

Screenshots/overflow assertions cover administration at 1440/390/320px and
transaction Forms/Documents at 1440/390px. They are attached to Playwright's JSON
report in ignored `test-results/`; representative screenshots were inspected.
Final display fixes normalize charset-qualified MIME types, show readable archive
names/date labels and avoid a misleading Issue prompt in historical views.

## Failures Corrected

Early runs exposed outdated ambiguous upload/dropdown selectors and response
matching that ignored new query scopes. Tests now select exact controls and
assert the scopes. A real worksheet SQL-version linkage gap was fixed with an
additional real-DB regression. NB bind/issue share one version, so the historical
test creates a real endorsement rather than inventing a second NB version.

Chromium's intercepted response-body reporting returned empty bytes in one
archive probe; the test now verifies an authenticated exact-URL API response and
independently hashes the browser Blob. No byte/hash assertion was waived.
One image captured an intermediate label edit; a fresh build/rerun passed.

No remaining failure in these three specs. This is not a full-suite, performance,
carrier UAT, conversion-fidelity, restore or production qualification result.

## Subsequent Full Regression

After the user's local deployment request, the full isolated Playwright suite
passed **144/144**, with no failures, flaky or skipped tests. This supersedes
the limited-suite scope above for browser regression execution, not carrier UAT
or enterprise load qualification. The later code review found additional gaps
not covered by these scenarios; see `docs/tasks/wp-0003-latest-implementation-review.md`.
