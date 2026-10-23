# Unit And Integration Tests - WP-0006

## Tests added

carrierBranding.test.tsx proves the local logo/name fallback, custom carrier
logo precedence and favicon updates/removal when only the logo changes.
Existing branding settings and both login tests retain configuration/SSO/pinning
coverage. Browser spec tests actual image decoding and the shared portal header.

## Results

- Focused branding/settings/login: 12 passed, 4 files.
- Full frontend: 607 passed, 90 files, one worker.
- Full server: 977 passed, 96 files, one worker (no server changes).
- Shared packages: 221 passed, 4 files.
- Root typecheck and frontend Docker production build passed.
- Final isolated Docker browser: 18 passed in 27.2 seconds (five branding cases,
  role access and existing responsive/accessibility checks), after the color fix.
  The portal test creates a properly linked synthetic customer rather than
  assuming a seeded customer1 login exists; no product/auth change required.
- Inspected actual desktop light header and mobile dark header/login screenshots.
  Solid white artwork/name backing fixes inherited dark-text contrast issues.
- No persistence change, so no new migration/PostgreSQL suite required.

## Requirement coverage

| Requirement | Tests |
| --- | --- |
| REQ-1: restore default logo in existing login/shared header/tab | fallback component test; four desktop/mobile browser cases |
| REQ-2: preserve carrier identity and documents | custom-logo and logo-only icon tests; existing branding settings tests; no document changes |
| REQ-3: responsive/accessibility and real asset loading | browser naturalWidth/favicon checks, both themes, 390/1440 bounds and scoped axe |
