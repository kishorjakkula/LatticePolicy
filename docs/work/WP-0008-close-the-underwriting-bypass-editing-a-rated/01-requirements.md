# Requirements — WP-0008

Source: the post-merge review of PR #394 (finding M1, 2026-10-23), confirmed in code at
`c55b6bd`. `PATCH /v1/quotes/:id/draft` (`quote.service.ts` `updateDraftQuote`) replaces
the payload, keeps the stored `underwriting` and `premium`, and writes any client-supplied
`status` (the schema accepts any string). Bind (`quote-bind.service.ts`) trusts the stored
`underwriting` decision and premium. Knowledge base: P&C README reviewed 2026-10-17
(90 days, current).

## Business goal

A policy is bound only on the risk that was underwritten and rated. Today an agent can rate
a low-risk quote (Eligible), change the risk on the saved draft (a 17-year-old driver, a
higher limit), and bind: no referral is raised and the old premium is charged. Underwriters
and the carrier rely on bind enforcing their rules and filed rates; this restores that.

## Scope

- Lines of business: all products (the bind path is shared).
- States / jurisdictions: all.
- Transactions: new business quote → rate → bind. Policy transactions (endorse, renew,
  rewrite, cancel, reinstate) re-rate inside their own requests and are out of scope.
- Roles and channels: agents and underwriters using the wizard; any API client of
  `/v1/quotes`.

## Requirements

| ID | Requirement | Source |
| --- | --- | --- |
| REQ-1 | When a draft update changes a rated quote's risk data (anything other than billing method and payment plan), the quote returns to Draft, and its stored underwriting result and premium are cleared. | Underwriting control; product decision |
| REQ-2 | Clients cannot set a quote's status through the draft update. Rated, Bound, Issued and other lifecycle statuses are written only by the server's rate and bind steps. | Underwriting control |
| REQ-3 | Bind accepts a quote only when its stored rating was produced from exactly the payload being bound (ignoring billing fields). Otherwise it refuses with 409 `QUOTE_RERATE_REQUIRED` and binds nothing. | Defense in depth; filed rates |
| REQ-4 | Changing only billing method or payment plan after rating keeps the quote Rated, so the wizard's Premium step still works. | WP-0004 REQ-8 (billing moved to Premium) |
| REQ-5 | The wizard tells the user when a change needs a re-rate, and offers Rate again instead of failing silently at bind. | UX |

## Acceptance criteria

### REQ-1

```gherkin
Scenario: Changing risk after rating needs a re-rate
  Given a quote rated Eligible with a 30-year-old driver
  When the draft is saved with a 17-year-old driver
  Then the quote status is Draft and it has no underwriting result or premium

Scenario: Saving without changes keeps the rating
  Given a rated quote
  When the draft is saved with the same payload (keys in any order)
  Then the quote stays Rated with its underwriting result and premium
```

### REQ-2

```gherkin
Scenario: Client cannot mark a quote Rated
  Given an unrated draft quote
  When an API client saves the draft with status "Rated"
  Then the request is refused with 400 INVALID_STATUS
  And bind of that quote is refused
```

### REQ-3

```gherkin
Scenario: Bind refuses a stale rating
  Given a rated quote whose payload no longer matches its rating fingerprint
  When the agent binds
  Then the response is 409 QUOTE_RERATE_REQUIRED and no policy, version or document is created

Scenario: Bind of an unchanged rated quote still works
  Given a rated quote
  When the agent binds
  Then a policy is created with the rated premium, as today

Scenario: Referral still raised for risky data after re-rate
  Given a rated Eligible quote changed to a 17-year-old driver and rated again
  When the agent binds
  Then the bind is referred to underwriting
```

### REQ-4

```gherkin
Scenario: Billing change keeps the rating
  Given a rated quote
  When only the payment plan changes and the draft is saved
  Then the quote stays Rated and binds with the new payment plan
```

### REQ-5

```gherkin
Scenario: Wizard asks for a re-rate
  Given a rated quote in the wizard
  When the user changes a driver's age and continues
  Then the premium step shows that the quote needs rating again and offers Rate again, and Bind is not offered until it is rated
```

## Business rules

- Billing method and payment plan do not affect rating or underwriting today (confirmed in
  the #394 review: the rater does not read them). They stay editable after rating. Any other
  payload field counts as risk data.
- Status is server-owned: Draft from create or draft update; Rated from rate; Bound and
  later from bind and policy transactions.
- An open or approved referral is tied to the exact proposal (#394); a changed quote needs
  its own decision.

## Regulatory and compliance notes

- Binding at a premium that was not rated for the bound risk is a filed-rate risk; this
  closes it. No rate, form or notice changes.
- Audit: a draft update that resets the rating records the change in the quote status
  history, as status changes do today.

## Out of scope and assumptions

- Out of scope: the other #394 findings (referral premium column, aggregation in the
  proposal hash, docs and gates), which go in a separate follow-up.
- Assumption: no migration. The rated-payload fingerprint is stored inside the existing
  `underwriting` JSON.
- Assumption: quotes already Rated before the release keep binding until changed. Those
  without a fingerprint get one from their current payload on the first bind check.

## Questions and answers

| # | Question | Recommended default | Answer |
| --- | --- | --- | --- |
| 1 | Which fields may change after rating without a re-rate? | Billing method and payment plan only | |
| 2 | Draft update with a client status: reject or ignore? | Refuse "Rated", "Bound" and later statuses with 400 INVALID_STATUS; otherwise keep the server-derived status | |
| 3 | Rated quotes created before release with no fingerprint? | Treat their current payload as rated once; any later change resets them | |
