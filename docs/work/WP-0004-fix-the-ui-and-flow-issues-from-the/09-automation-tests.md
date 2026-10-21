# Automation tests — WP-0004

Status: final full isolated browser run **161 passed** (2026-10-21).
Gate B extension approved and implemented; no merge approval.

## Latest Verification

- Rebuilt both Docker images from the final runtime code, applied migrations
  on fresh isolated volumes and ran `npm run test:e2e:isolated -- --workers=2`:
  **161 passed**, no failures or skipped serial authority cases.
- Referral detail checks compare the displayed fingerprint with server
  evidence, inspect actual risk values and reviewed premium, and assert no
  page overflow at 390px. Desktop/mobile screenshots were captured and mobile
  evidence inspected; snapshots remain read-only and separate from current facts.
- Authority fixtures now approve the referral returned for the actual binding
  actor/proposal, not an unrelated latest work item.
- One earlier run found a resize measurement race in qualification alignment:
  label/radio boxes were sampled across scroll-anchor frames. Both are now
  measured atomically with unchanged width/alignment assertions.
- Another run exposed a wizard fixture assuming Make/ZIP were empty despite
  carrier/demo defaults. It now explicitly clears the fields under test and
  retains every required-field assertion. Final full run passed.
- Previous outcomes below are historical and superseded. Demo and pilot
  stacks were not test targets or redeployed. Remote CI/CodeQL and carrier
  staging/business sign-off are not claimed by local checks.

## Specs added or changed

- Existing role, navigation, wizard, workflow, authority and pre-bind selectors
  updated for the new route/layout and explicit referral decisions.
- `uw-referrals.spec.ts`: detail review, mandatory reason, queue-only Open
  actions and denied agent access; oldest-first-compatible row identification.
- `ui-section-standards.spec.ts`: administration home and live referral detail.
- New `ui-flow-accessibility.spec.ts`: phone overflow/screenshots, search
  filters, shared pager and desktop/phone dark/light contrast checks.
- New `ui-flow-business-mobile.spec.ts`: real ten-state compliance change,
  required reason, persisted statuses, policy/wizard/submissions at 390px.

## Runs

- First isolated accessibility run: 7 passed, 2 failed (missing primary variant
  selector and genuine dark search-tab/count contrast). Fixed and rebuilt.
- Rebuilt isolated accessibility run: 9 passed.
- Referral/pre-bind/authority/wizard/screen audit: 46 passed, 1 failed because
  the new administration home lacked the shared collapsible section. Fixed.
- Final full isolated stack run: **158 passed, 1 failed, 2 did not run**.
  The authority E2E approves an earlier agent referral after an intervening
  admin attempt changes its authority requirements. Update it to reevaluate
  the actual binding actor's proposal and approve that current referral, then
  rerun all three serial authority cases and the full suite. Do not weaken the
  fresh-requirements checks to satisfy this old fixture.
- Uses separate 5174/3301 ports and
  throwaway database volumes; the demo and carrier pilot are not test targets.
- No CI run URL or production/pilot verification is claimed by this handoff.

## Environment-only failures

Unbounded concurrent local unit suites timed out while Docker was building;
bounded-worker reruns passed without weaker assertions. Database guard refusal
for a nonstandard temporary database name is documented in `06-unit-tests.md`.
Two exploratory browser commands overlapped in the same output directory and
collided during trace cleanup (ENOENT); these are not passing evidence. The
last full run was a single browser command and had only the authority failure
described above. The populated mobile queue overflow was a real issue: an
absolute-positioned screen-reader label escaped the scroll region. Positioning
that region relatively fixed page width (927px -> 390px) without removing
accessible text. The final full run passed that populated-data regression.
