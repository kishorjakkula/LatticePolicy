API (MVP, v1)

Conventions
- Version via `X-Api-Version: 1` or `/v1` path prefix.
- All requests require `X-Tenant` header to resolve tenant context.

Endpoints
- POST /v1/quotes
  - Create a quote from risk, coverages, UW answers.
  - Body: `contracts/quote.request.schema.json`
  - Returns: quote id, rated premium breakdown, next actions.

- POST /v1/quotes/{id}/bind
  - Issue policy; generates initial PolicyVersion.
  - Returns: policy number, policy id, PolicyVersion summary.

- GET /v1/policies/{id}
  - Fetch current policy summary with latest version.

- GET /v1/policies/{id}/versions
  - List PolicyVersion headers for timeline.

- POST /v1/policies/{id}/endorse
  - Apply changes effective on date; returns new rated PolicyVersion.
  - Body: endorsement request with deltas and effective date.

- POST /v1/policies/{id}/cancel
  - Cancel policy (flat/pro-rata). Body: effective date, reason.

- POST /v1/policies/{id}/reinstate
  - Reinstate policy within allowed window.

- POST /v1/policies/{id}/renew
  - Create renewal offer (re-rate for next term).

Idempotency
- Send an `Idempotency-Key` header on `POST`, `PUT`, `PATCH`, or `DELETE`
  requests to protect against duplicate side effects from retries or
  concurrent duplicate submissions.
- A key is scoped to the tenant and reserved for the exact
  method + path + body combination that first used it.
- Same tenant, key, method, path, and body:
  - While the original request is still executing, the duplicate gets
    `409 IDEMPOTENCY_KEY_PROCESSING` with a `Retry-After` header. Do not
    resend a new request; retry after the original completes.
  - After the original request completes successfully, the duplicate
    replays the original response instead of re-executing the operation.
  - If the original request failed (non-2xx response or the connection
    closed before a response was sent), the reservation is released and a
    matching retry re-executes the operation.
- Same tenant and key with a different method, path, or body returns
  `409 IDEMPOTENCY_KEY_CONFLICT`. Use a new key for a different request.

Errors
- JSON error envelope with machine-readable fields:
  - `code`: stable error code such as `VALIDATION_ERROR`,
    `INVALID_QUOTE`, `FORBIDDEN`, `IDEMPOTENCY_KEY_CONFLICT`,
    `IDEMPOTENCY_KEY_PROCESSING`, or `INTERNAL_ERROR`.
  - `message`: human-readable summary safe to show to API clients.
  - `traceId`: request correlation id. It matches the `x-request-id` response
    header when one is present.
  - `details`: optional structured details. Contract validation details include
    JSON path, JSON Schema keyword, message, schema source, and keyword params.

Example validation response:

```json
{
  "code": "INVALID_QUOTE",
  "message": "Quote payload failed contract validation",
  "traceId": "req-01HZY4W5J8Q9AVH32R3K8Z4V7P",
  "details": [
    {
      "path": "/risks",
      "keyword": "minItems",
      "message": "must NOT have fewer than 1 items",
      "schema": "quote.request.schema.json",
      "params": { "limit": 1 }
    }
  ]
}
```
