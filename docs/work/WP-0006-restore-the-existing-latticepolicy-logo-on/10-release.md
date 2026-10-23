# Release - WP-0006

Formal deployment stage remains pending human Gate C. This records local-only
branch preview in the ongoing Docker demo; no merge/production approval.

- Branch: `latticepolicy/restore-platform-logo`, based on merged main 7265c31.
- Frontend image: sha256:c662f9f056c6c051f24a9086c3e16a66af8594ca3ba7676c1809549aa56736ee.
- Migrations/new configuration/dependencies: none.
- Rollback: rebuild/redeploy the frontend from reviewed main. No database
  restore required. Do not delete demo data/cache/document volumes.

## Release notes

Restore the existing local LatticePolicy logo on default login/shared headers,
including the customer portal, and its lattice mark in the default browser icon.
Carrier name remains visible. Supplied carrier logos and carrier documents are
unchanged; a logo-only change now refreshes the browser icon correctly.

## Deployments

| Environment | When | Revision | Health | By |
| --- | --- | --- | --- | --- |
| Local Docker branch preview | 2026-10-23 | Image above | UI 5173/favicon 200, API db/cache true | Local development |
| Formal staging | after Gate C | Pending | Pending | Pending |
| production | after Gate D | | | |

Replaced only policy-ui with --no-build --no-deps. API/database/cache/document
and pilot containers were not modified. The exact frontend image passed 18
browser tests in a disposable Docker stack on 5174/3301, including real logo
decoding, both themes/widths, carrier override and existing access/layout checks.
The disposable test stack/volume was removed afterward. No automated tests
seeded or edited demo/pilot data. Local screenshot evidence is in
output/wp-0006-branding-final/ and is not committed.
