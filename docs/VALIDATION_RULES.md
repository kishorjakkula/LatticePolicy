# Validation Rules Framework

Carrier-configured required fields and checks, applied at every level of
every transaction, without code changes. Administrators manage them at
**Administration > Validation Rules** (`/admin/validation-rules`).

## Model

| Dimension | Values |
| --- | --- |
| Level | `screen` (as the user types, on one wizard screen), `rate` (rating, or an endorsement/renewal preview), `bind` (new business), `issue` (issuing new business, or processing any policy change) |
| Transaction | `new_business`, `endorsement`, `cancellation`, `reinstatement`, `renewal`, `rewrite`, `non_renewal`, or **`common`** = all of them |
| Scope | one product or all; one state or all; effective and expiration dates (compared with the quote or transaction effective date) |
| Check | **Required field** (`fieldPath` must have a value; `[*]` checks every list item, e.g. `risks[*].vin`) or **Condition** (an expression that must be true) |
| Only when | optional expression; the rule is skipped while it is false |
| Severity | **error** = hard stop; **warning** = soft stop: shown on screens and with the rated premium, and at bind and issue a person must acknowledge it |

Where each transaction meets each level:

| Transaction | Screen | Rate | Bind | Issue |
| --- | --- | --- | --- | --- |
| New business | wizard | `POST /quotes` | `POST /quotes/:id/bind` | `POST /policies/:id/issue` |
| Endorsement | wizard | `POST /policies/:id/endorse/preview` | — | `POST /policies/:id/endorse` |
| Renewal | wizard | `POST /policies/:id/renew/preview`, `POST /quotes?transaction=renew` | — | `POST /policies/:id/renew` |
| Rewrite | wizard | `POST /quotes?transaction=rewrite` | — | `POST /policies/:id/rewrite` |
| Cancellation | wizard | — | — | `POST /policies/:id/cancel` |
| Reinstatement | wizard | — | — | `POST /policies/:id/reinstate` |
| Non-renewal | — | — | — | `POST /policies/:id/non-renew` |

Levels are explicit: a `screen`-only rule guides the user but the API does not
enforce it. Tick `rate`, `bind` or `issue` as well to enforce it server-side
(new rules default to Screen + Rate + Bind).

## Writing rules

Required-field paths are payload paths: `effectiveDate`, `applicant.email`,
`mailingAddress.zip`, `insureds[*].phone`, `risks[*].vin`,
`additionalInterests[*].loanNumber`, plus transaction facts
`transaction.reasonCode`, `transaction.effectiveDate`, `transaction.reason`,
`transaction.overrideReason`. The editor suggests paths for the selected
product (`GET /admin/validation-rules/catalog?productCode=`).

Conditions use the shared expression language (`packages/rules/src/expression.ts`):

- Names: `risk` (first risk), `risks`, `quote.state`, `quote.effectiveDate`,
  `quote.productCode`, `quote.termMonths`, `applicant`, `insureds`,
  `coverages.CODE.selected|limit|deductible`, `uwAnswers`, `payload`,
  `transaction.type|effectiveDate|reason|reasonCode`,
  `policy.status|policyNumber|termEffectiveDate|termExpirationDate`,
  `premium.total` (at bind and issue).
- Functions: `isSet isEmpty len count sum min max abs round lower upper
  contains startsWith number lookup today daysBetween`.

Examples:

| Purpose | Rule |
| --- | --- |
| Cancellation needs a reason | required `transaction.reasonCode`, Issue, Cancellation, error |
| Backdating warning, every transaction | condition `daysBetween(transaction.effectiveDate, today()) <= 30`, Issue, Common, warning |
| VIN on every vehicle before binding | required `risks[*].vin`, Screen (Risk) + Bind, New business, error |
| Mortgagee loan number | required `additionalInterests[*].loanNumber`, only when `count(additionalInterests) > 0`, Bind, error |
| High premium review | condition `premium.total < 25000`, Bind, warning |

A rule's definition is checked when saved (path syntax, expression syntax,
screen chosen for screen rules, Common not combined with other types). A rule
that cannot be evaluated at run time is reported, never silently passed.

## Behavior

- One engine: `packages/rules/src/validation-rules.ts` runs in the browser
  (live screen checks) and in the API (`server/src/lib/validation-gate.ts`), so
  both reach the same answer.
- Errors return `422 VALIDATION_FAILED` with
  `details: {level, transactionType, errors, warnings}`.
- Unacknowledged warnings at bind/issue return
  `409 VALIDATION_WARNINGS_UNACKNOWLEDGED` with `details.pending`. Retry with
  `validationAcknowledgements: [ruleCode...]` in the request body.
- Acknowledgements are stored in `validation_acknowledgements` (who, when, rule
  version, message, field) inside the transaction's own database transaction.
  `GET /validation-acknowledgements?entityType=quote|policy&entityId=`.
- Rate responses carry `validation.warnings`.
- The wizard shows **Checks for this screen** (errors after the user tries to
  continue, warnings immediately), blocks Continue on that screen's errors,
  shows rate/bind/issue stops, and opens an acknowledgement dialog for warnings.

## Governance

- Permissions: `admin.validation_rules.read` / `.manage`, menu/page view
  permissions (granted to `admin`). Wizard users read applicable rules with
  `page.wizard.view` or `page.policy.view`.
- Every create, change and delete is recorded in `validation_rule_audit` with
  the full before/after; rules carry a version; a rule code cannot change.
- `validation_rule_audit` and `validation_acknowledgements` are append-only.
- All tables are tenant-isolated with row-level security.

## Not covered

Existing built-in checks (contract schema, carrier-pack screen rules,
underwriting rules, wizard required fields) are unchanged and still apply;
this framework adds carrier rules on top. Moving built-in checks into rules is
a separate, per-product decision.
