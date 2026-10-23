# Carrier branding on screens and printed output

## Summary and links

Pilot administration owns carrier identity instead of displaying the framework logo on customer output. This extends the pilot configuration work in PR #371. Implementation: [PR #372](https://github.com/kishorjakkula/LatticePolicy/pull/372).

## Important files

- `server/migrations/060_tenant_branding.sql`, `server/src/schema.ts`: tenant-scoped persisted branding.
- `server/src/services/carrier-branding.service.ts`: validation, public projection and scoped storage, with memory fallback.
- `server/src/app.ts`, `server/src/routes/admin.routes.ts`: public identity for login and permission-protected administration.
- `frontend/src/tenant/carrierBranding.tsx`, `frontend/src/features/admin/CarrierBrandingSettings.tsx`: shared screen branding and editable tenant settings.
- `server/src/services/document-storage.service.ts`, `document-generation.service.ts`, `server/src/persistence.ts`: carrier identity on packets and worksheets, snapshotted at generation.
- `frontend/src/features/wizard/QuoteWizard.tsx`: carrier identity on all four browser PDF generators.
- `scripts/pilot-lib.mjs`: supplies synthetic Acme branding only when unconfigured; preserves administrator changes.
- `scripts/pilot-rebrand-documents.mjs`: explicit, synthetic-pilot-only conversion of pre-branding examples into verified branded copies, preserving original paths and hashes in revision metadata.

## Behavior rules

- Public `/brand` returns only display name, raster logo, primary color and document footer. Tenant pinning and claim/header mismatch checks still apply.
- `/api/v1/admin/branding` GET requires tenant read permission; PATCH requires tenant manage permission and the admin menu permission.
- Logos must be embedded PNG/JPEG/WebP with validated signatures, bounded size (500 KB), and bounded dimensions. Reject remote URLs and SVG. Names/footers are escaped in HTML; colors are strict hex.
- Use the current carrier brand for screen/login and browser quote/transaction previews. Issued server documents store the exact branding used; later edits apply to future documents. Recovery uses the stored snapshot, restores the recorded artifact filename, and verifies packet hashes before writing. This preserves the original artifact when recovering an explicitly branded pilot copy.
- Historical packets without a branding snapshot retain their old rendering contract solely for byte-identical recovery. The framework name is never inserted into new carrier documents. Uploaded regulatory DOCX form content remains authored by the carrier.
- Synthetic pilot examples can be rebranded with `npm run pilot:rebrand-documents`; setup does not rewrite issued documents automatically. Originals remain archived through their existing immutable storage paths.
- The checked-in Acme logo is a replaceable demonstration monogram, not a customer-provided identity.
- Screen-only default: when a carrier has not supplied a logo, show the bundled
  LatticePolicy artwork plus the carrier name on login and shared app header;
  use its lattice mark for the default browser icon. Supplied carrier logos
  remain primary. This does not add framework branding to carrier documents.
  See `restore-platform-logo.md` (WP-0006).

## Automated tests and validation

- Unit/API tests cover invalid logo/color rejection, permissions, tenant mismatch, safe public projection, escaping and immutable branding.
- PostgreSQL integration proves migration, tenant isolation and printed snapshot retention.
- Frontend tests exercise save, header refresh, upload errors and server error presentation; login tests retain SSO/pinning coverage.
- Pilot Playwright uploads a real PNG through admin, checks header/login image loading, opens every accepted document and parses actual PDF text to require carrier identity and exclude framework branding. Browser worksheet and packet section headings reserve enough baseline spacing to avoid overlap; Playwright checks the worksheet heading-to-field gap.

Commands: `npm run test:frontend`, `npm run test:server`, `npm run typecheck`, `npm run build`, targeted PostgreSQL integration, `npm run security:audit`, and the pilot acceptance/browser/recovery/monitor/handoff pipeline. Final results are recorded in the PR and pilot evidence.
