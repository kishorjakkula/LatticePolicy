# UI control standards

## Radio buttons

All application screens and carrier-configured forms use
`frontend/src/components/RadioGroup.tsx`. Do not render raw radio inputs in
feature code. The source audit in `radio-standard.test.ts` enforces this rule.

- Give every group a unique `name` and an accessible name through `ariaLabel`
  or `labelledBy`. Give each option readable label text.
- Pass controlled `value`, typed `options`, and `onChange`. Native radios
  preserve tab, arrow-key, focus, and label-click behavior.
- Use `layout="binary"` for Yes/No choices: fixed, equal option columns.
  Use the default choices layout for enums, including long option labels.
- `disabled`, `required`, `invalid`, and `describedBy` carry interaction and
  validation state. Disabled/read-only screens must pass `disabled`.
- Shared styles live in `frontend/src/styles/radio.css`, imported by the active
  stylesheet. Align each circle to the first text line; keep its size fixed.
  Long labels wrap, and controls must remain inside the viewport.
- Repeated qualification rows use a flexible question column and fixed answer
  column. At widths below 760px, answers appear below the question. Grid tracks
  must allow shrinking with `minmax(0, 1fr)`.

## Postal Addresses And Contact Communication

Reuse `AddressFields` for one structured postal address and `ContactAddresses`
for a contact's collection, within the existing screen/section. Contact email
and mobile are separate fields, never postal properties. Customer master data
retains its existing contact-points editor; quote/insured contacts use
`ContactCommunication`. Each dwelling/vehicle risk keeps one address, with no
collection actions. Use stable contact/row scope IDs to discard late suggestions.
Preserve units, ZIP+4, county and existing non-US values in legacy adapters.
Optional matching needs an explicit check and Apply/Keep review; it must not
silently change a draft, a primary address or the rating jurisdiction.

`e2e/contact-addresses.spec.ts` covers embedded contact save/reopen and single
garaging address behavior, including mobile viewport bounds. Matching controls
are tested with mocked provider traffic; never use customer addresses in CI.

## Validation

`e2e/support/radio-standard.ts` checks visible radios for shared markup,
accessible group names, label alignment, and viewport bounds. The existing
screen audit calls it for every registered internal screen and policy view.

`e2e/qualification-alignment.spec.ts` checks all five core products on desktop
and mobile, exercises selections, and saves screenshots. Component tests cover
boolean and enum values, required/error descriptions, blur, and disabled state;
configured-form tests verify the same component inside carrier-defined screens.

Add every new screen to the screen audit and use the shared control for new
radio choices. Browser checks complement the source audit: source coverage also
includes screens whose radios appear only after data or workflow steps load.
