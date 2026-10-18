---
title: UI/UX knowledge — design principles, accessibility, insurance UX
last_reviewed: 2026-10-18
review_every_days: 180
sources: docs/UI_CONTROL_STANDARDS.md; frontend/src/components and styles; W3C WCAG 2.2 (https://www.w3.org/TR/WCAG22/); WAI-ARIA Authoring Practices (https://www.w3.org/WAI/ARIA/apg/)
---

# UI/UX Knowledge

For the UI/UX designer, developer, automation test and business validation agents.

## LatticePolicy design system

- Sections: every section on a working screen is a `CollapsibleSection`
  (checked by `e2e/ui-section-standards.spec.ts`; new screens are added there).
- Choices: radios use `RadioGroup` (binary layout for Yes/No); checkboxes use
  `Checkbox`. Raw radio inputs are not allowed (`radio-standard.test.ts`).
- Validation: field messages next to the field (`FieldError`); carrier
  validation rules show in the screen's "Checks for this screen" panel; warnings
  at bind and issue open an acknowledgement dialog (`docs/VALIDATION_RULES.md`).
- Status: `StatusBadge` with text; feedback through `Toast`; empty lists use
  `EmptyState`; long lists use `TablePagination`.
- Tokens and styles: `frontend/src/styles/` (`search-design-system.css` defines
  the `--ps-*` tokens). Colours come from tokens; no one-off literals.
- Tables inside horizontal scroll wrappers use `table-no-sticky-head`.
- Carrier branding: logo and primary colour per carrier on screens and documents.

## Accessibility (WCAG 2.2 AA)

- Every control has a visible label or an accessible name; groups have names.
- Keyboard: logical tab order, visible focus, no keyboard traps, dialogs trap
  and restore focus, Escape closes non-destructive dialogs.
- Contrast: 4.5:1 for text, 3:1 for large text and UI components; meaning is
  never carried by colour alone.
- Errors are announced (`role="alert"`) and say how to fix them.
- Target size at least 24×24 CSS px (WCAG 2.2, 2.5.8); respect reduced motion.
- Works at 390px width with no horizontal page scroll; tables scroll in their
  own container.

## Insurance UX conventions

- Wizards follow the policy lifecycle steps users know: product, qualification,
  insureds, risk, coverages, rating, premium, forms and documents.
- Show effective dates, terms, limits, deductibles and premiums in consistent
  formats; right-align money in tables; show currency.
- Binding, issuing, cancelling and other contractual actions are explicit
  buttons with confirmation and a clear result message.
- Underwriters scan: put the decision, referral reasons and key exposures first;
  details below.
- AI-drafted values are visibly marked as AI proposals with their evidence and
  confidence until a person confirms them (`docs/SUBMISSION_INTAKE.md`).
- Policyholders in the portal see plain language and only customer-safe data.
