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

Errors
- Problem+JSON with machine-readable codes; include `traceId` for support.

