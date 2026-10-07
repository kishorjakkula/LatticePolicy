# Authenticated API Docs Browser Access

## Summary

Swagger UI and its OpenAPI document remain admin-only, but administrators can
open the documentation from the application without placing a JWT in the URL.

## Behavior

- The admin-only header control posts to `/api-docs/session` with the normal
  bearer token.
- The API exchanges that authentication for a five-minute, HttpOnly,
  same-site documentation cookie.
- `/api-docs` and `/openapi.json` accept that cookie. Query-string JWTs are no
  longer accepted, preventing token exposure through browser history, logs,
  screenshots, and referrer headers.
- Non-admin users continue to receive `403 Forbidden`.
- Direct browser navigation to the API URL redirects to the frontend handoff;
  after login, the original API Docs destination is restored automatically.

## Validation

- Server tests cover session creation, cookie-backed docs access, and rejected
  unauthenticated access.
- Frontend build/typecheck and browser verification cover the admin control.
