# Issue 315: Servicing Compliance Controls

Cancellation and non-renewal now resolve effective-dated rules by tenant,
product, state, transaction type, and transaction effective date. A rule
controls allowed reasons, minimum/maximum notice, return-premium method,
required forms, and required delivery methods.

Both lifecycle services validate the rule before writing any transaction.
The selected rule, computed notice days, and evidence requirements are stored
in transaction metadata. Notification intents retain structured delivery
evidence so provider message IDs, timestamps, and proof can be audited.

Compliance administrators can list and create rules under
`/v1/admin/compliance/servicing-rules`. Existing tenants remain compatible
until a matching rule is configured.
