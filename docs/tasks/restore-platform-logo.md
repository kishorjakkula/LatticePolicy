# Restore Default LatticePolicy Branding

Work package: WP-0006 (quick presentation-only bug fix).

The shared CarrierBrand rendered only a carrier name when no uploaded logo
existed, leaving the bundled LatticePolicy artwork unused on login and the app
header. Restore that local SVG fallback and the matching lattice-mark favicon.
Keep the carrier name visible. Uploaded carrier raster logos remain primary;
logo-only updates now refresh the browser icon as well. No authentication,
tenant resolution, branding API/storage, email or document-rendering changes.
New carrier policy documents must still use carrier branding, not this fallback.

Files: `frontend/src/tenant/carrierBranding.tsx`, scoped `carrier-branding.css`,
`frontend/public/favicon.svg`, `frontend/index.html`. Shared header covers
administration, policy/quote workflows, Agent Studio and customer portal without
adding logos to every panel. No remote asset requests or new dependencies.

Tests: new carrierBranding component cases for fallback/name, custom logo,
logo-only favicon updates/removal; existing branding administration/login tests;
`e2e/branding.spec.ts` checks actual image loading, favicon, carrier override,
desktop/mobile light/dark layout and scoped accessibility. Final results and
independent review are in the work-package handoffs. Final results: 607 frontend,
977 server, 221 shared and 18 isolated Docker browser tests passed; root typecheck
and frontend Docker production build passed. Independent review found no
actionable issue. Screenshots inspected at desktop/mobile in both themes.

Local Docker UI at http://localhost:5173 now uses the tested frontend image;
only policy-ui replaced, data/API/pilot stacks unchanged. No carrier logo or
document branding overwritten. Formal merge/deployment Gate C remains pending;
no production approval implied.
