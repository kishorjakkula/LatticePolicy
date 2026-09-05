API (MVP, v1)

Conventions
- Version via `X-Api-Version: 1` or `/v1` path prefix.
- All requests require `X-Tenant` header to resolve tenant context.
- API routes are mounted under `/api`, so the full path for the endpoints
  below is `/api/v1/...` (for example `/api/v1/policies`). `POST /auth/login`
  and the other `/auth/*` routes are not versioned and are not under `/api`.

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

Examples

These examples use the local dev server (see
[Developer local setup](DEVELOPER_SETUP.md)) at `http://localhost:3300`,
tenant `sample-carrier`, and the local demo users documented in
[Local Login](DEVELOPER_SETUP.md#local-login). Replace the base URL, tenant,
and credentials with your own before using these outside local development.

Authenticate

`POST /auth/login` returns a bearer JWT (`token`) and the authenticated
`user`. Send the token on every subsequent request as
`Authorization: Bearer <token>`, and send `X-Tenant` (or a body/query
`tenantId`, depending on the endpoint) on every request to resolve tenant
context.

```bash
curl -X POST http://localhost:3300/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"tenantId\":\"sample-carrier\",\"username\":\"agent1\",\"password\":\"password\"}"
```

```json
{
  "token": "<jwt>",
  "user": {
    "id": "demo-agent1",
    "username": "agent1",
    "tenantId": "sample-carrier",
    "roles": ["agent"],
    "permissions": ["page.search.view", "page.policy.view", "..."],
    "customerId": null,
    "customerKey": null,
    "customerName": null
  }
}
```

If the tenant requires MFA, the response is `{ "mfaRequired": true, ... }`
instead of a token; see `POST /auth/mfa/verify` and
`POST /auth/mfa/setup/confirm`.

Search policies

`GET /api/v1/policies` supports free-text search, filtering, sorting, and
pagination via query parameters: `q`, `product`, `status`, `effectiveFrom`,
`effectiveTo`, `page`, `pageSize`, `sortBy`, and `sortDir`.

```bash
curl "http://localhost:3300/api/v1/policies?q=doe&status=Issued&page=1&pageSize=20" \
  -H "X-Tenant: sample-carrier" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "items": [
    {
      "policyId": "b6b6c6f0-...-9e2a",
      "policyNumber": "PA-2026-000123",
      "productCode": "personal-auto",
      "status": "Inforced",
      "term": { "effectiveDate": "2026-01-01", "expirationDate": "2026-07-01" },
      "premium": { "total": { "amount": 1200.00, "currency": "USD" } }
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

Customer portal access

Customer portal users authenticate through the same `POST /auth/login`
endpoint; the difference is entirely in the account's role and its link to a
customer record. Every `/api/v1/customer-portal/*` route requires the
`customer.portal.read` permission and returns `403 CUSTOMER_LINK_REQUIRED`
if the authenticated user has no linked customer.

```bash
curl http://localhost:3300/api/v1/customer-portal/summary \
  -H "X-Tenant: sample-carrier" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN"
```

```json
{
  "customer": {
    "customerId": "9f1c...-4d21",
    "customerKey": "CUST-001",
    "customerName": "Jane Doe",
    "entityType": "person"
  },
  "policies": [
    {
      "policyId": "b6b6c6f0-...-9e2a",
      "policyNumber": "PA-2026-000123",
      "productCode": "personal-auto",
      "status": "Issued",
      "term": { "effectiveDate": "2026-01-01", "expirationDate": "2026-07-01" },
      "premium": { "amount": 1200.00, "currency": "USD" }
    }
  ]
}
```

Fetch one portal-safe policy with `GET /api/v1/customer-portal/policies/{policyId}`,
which returns `{ "policy": {...}, "declarations": {...}, "idCard": {...} }`
and `404 POLICY_NOT_FOUND` for a policy not linked to the caller's customer
record.

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
