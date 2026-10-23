# End-To-End Results - WP-0005

Local pre-merge branch verification explicitly requested by the maintainer;
not formal post-Gate-C staging acceptance or carrier business sign-off.

- Revision: a58291d13191b6bc1add4e663012799f826d17e7, PR #396.
- Deployment: Docker API/UI at 3300/5173; read-only availability checks passed,
  database/cache healthy, external address checking disabled.
- Automation: same exact server/UI images, separate fresh disposable Docker
  project `latticepolicy-wp0005-verification`, UI 5174/API 3301, tenant RLS on,
  Redis cache, inline extraction. No demo/pilot database used for automation.
- Command: `E2E_BASE_URL=http://localhost:5174 E2E_API_BASE_URL=http://localhost:3301
  npx playwright test e2e/contact-addresses.spec.ts e2e/auth-route-access.spec.ts
  e2e/quote-wizard.spec.ts --workers=1 --output=output/wp-0005-docker`.
- Results: 14 passed, 33.4 seconds, zero retries/skips. Contact collection
  save/reopen, units/ZIP+4, separate email/mobile, consent/Keep/Apply, all-role
  routing and personal-auto quote/rate/bind/issue flow included.
- Evidence: local `test-results/results.json`, scoped screenshots under
  `output/wp-0005-docker/`; full earlier 165-case run and nine repeated new
  journeys recorded in 09. Outputs are not committed.
- Defects: none observed in this Docker verification scope. No complete carrier
  UAT, production workload, provider fitness or deliverability claim.
- Cleanup: disposable test stack/volume removed; demo database/cache/document
  volumes preserved. Backup and prior image tags remain available locally.
- Formal E2E stage and Gates C/D remain pending; this is verification evidence,
  not a person signing off or authorizing merge/production.
