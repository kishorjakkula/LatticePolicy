# DOCX Policy Form Templates

## Summary

Added validated Word template support for policy forms. Administrators can
upload `.docx` templates containing a curated set of `{{token}}` merge fields;
document generation resolves those fields from tenant-scoped policy data and
stores a filled DOCX artifact alongside the existing PDF policy packet.

## Behavior

- Uploads remain limited to 10 MB and accept PDF or DOCX MIME types.
- Unknown DOCX placeholders reject the upload with their exact token names.
- Templates are validated again at generation time for older stored assets.
- Each generated artifact is hashed, stored, retrieved, and verified through
  the existing document storage adapter.
- A broken individual form template is logged and skipped without preventing
  generation of the policy packet.
- DOCX content downloads with a `.docx` filename and the Office MIME type.

## Important Files

- `server/src/services/document-template-variables.ts`
- `server/src/services/document-generation.service.ts`
- `server/src/routes/forms-admin.routes.ts`
- `server/src/routes/policies.routes.ts`

## Validation

- Template parsing, token validation, substitution, and resolver unit tests
- Policy document generation unit tests
- Build, typecheck, server tests, DB integration, Playwright, security,
  CodeQL, and container checks

## Follow-Up

DOCX-to-PDF conversion is intentionally outside this change. It should only
be introduced with a tested conversion runtime and an explicit fidelity and
resource-isolation design.

