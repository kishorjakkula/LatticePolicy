# Outbound Messages And Transports

LatticePolicy tells other systems what happened to a policy by publishing
messages. This document describes how they are recorded, the envelope they
are delivered in, and where they can be delivered.

## How A Message Is Produced

1. A policy transaction writes a row to `ledger_events` in the same database
   transaction as the change itself (for example `STATUS_CHANGE`, `CANCELLED`,
   `COMMISSION_HANDOFF`). Notifications write to `notification_intents`.
2. A database trigger copies each ledger event into `async_message_outbox`
   with the topic `ledger.<event>`. A queued notification is added with the
   topic `notification.<event type>`.
3. The dispatcher (`LATTICE_ROLE=dispatcher`, or the `all` role) claims
   pending rows, delivers each through the configured transport, and marks it
   `Sent`, or schedules a retry with backoff.

Because the outbox row is written with the change, a message is never
published for a change that did not commit, and a committed change always has
its message recorded.

## Delivery Guarantees

- **At least once.** A message can be delivered more than once (a retry after
  a timeout, or a dispatcher restart). Treat `messageId` as an idempotency key.
- **Retries.** A failed delivery is retried with exponential backoff up to the
  row's `max_attempts`, then marked `Failed`.
- **Abandoned claims.** A message a dispatcher claimed but did not finish
  (the process stopped) is taken over after
  `ASYNC_PUSH_CLAIM_LEASE_SECONDS` (default 300). Keep the lease longer than a
  batch can take.
- **Ordering.** One dispatcher delivers in the order messages were recorded.
  On Kafka, messages about the same policy share a key and so a partition.

## Envelope

Every message, on every transport, is the JSON envelope described by
`contracts/events/envelope.v1.schema.json`:

```json
{
  "specVersion": "1",
  "messageId": "0b0f...",
  "tenantId": "acme-mutual",
  "type": "ledger.commission_handoff",
  "topic": "ledger.commission_handoff",
  "schemaVersion": "commission-handoff.v1",
  "attempt": 1,
  "createdAt": "2026-10-11T02:00:00.000Z",
  "payload": { }
}
```

`messageId`, `tenantId`, `topic`, `attempt`, `createdAt`, and `payload` are
the fields the original webhook sent and are unchanged. `specVersion`, `type`
(equal to `topic`), and `schemaVersion` were added.

## Message Types

| Type | When | Payload |
| --- | --- | --- |
| `ledger.status_change` | A policy changes state (bound, issued, and so on) | Ledger event: `entityType`, `entityId`, `event`, `fromState`, `toState`, `occurredAt`, `actor`, `payload` |
| `ledger.cancelled`, `ledger.endorse_issued`, `ledger.renewed`, and other `ledger.<event>` | The matching policy transaction | Ledger event, as above |
| `ledger.commission_handoff` | Any premium-bearing transaction | Ledger event whose `payload` is `commission-handoff.v1` (`docs/COMMISSION_HANDOFF.md`) |
| `notification.<event type>` | A notification is queued | The notification (`docs/NOTIFICATIONS.md`) |

The type is derived from the ledger event name, so a new ledger event is
published automatically. Only `commission-handoff.v1` declares a payload
contract version today; the other payloads are not yet versioned.

## Transports

`EVENT_TRANSPORT` selects where the dispatcher delivers.

### `webhook` (default)

Posts the envelope to `ASYNC_PUSH_WEBHOOK_URL` with an optional
`ASYNC_PUSH_AUTH_HEADER`. A response outside 2xx is a failed delivery. With
no URL the envelope is written to the dispatcher's log, which is how local
and demo stacks run.

### `kafka`

| Setting | Meaning |
| --- | --- |
| `KAFKA_BROKERS` | `host:port` list, comma-separated. Required. |
| `KAFKA_TOPIC` | One topic for every message. Default `lattice.events`. |
| `KAFKA_TOPIC_PREFIX` | Set instead of `KAFKA_TOPIC` for one topic per type: `<prefix>.<type>`. |
| `KAFKA_CLIENT_ID` | Default `lattice-policy`. |
| `KAFKA_SSL` | `1` to use TLS. |
| `KAFKA_SASL_MECHANISM` | `plain`, `scram-sha-256`, or `scram-sha-512`, with `KAFKA_SASL_USERNAME` and `KAFKA_SASL_PASSWORD`. |

- Record value: the envelope as JSON.
- Record key: `<tenantId>:<entity id>`, the policy when the payload names one.
- Record headers: `lattice-message-id`, `lattice-tenant-id`, `lattice-type`,
  `lattice-spec-version`, and `lattice-schema-version` when known.
- The producer is idempotent and waits for all in-sync replicas.
- A dispatcher that cannot reach the brokers keeps retrying; policy
  transactions are unaffected because they only write the outbox.
- Topics are created on first use if the broker allows it. In a managed
  cluster create them ahead of time.

## Adding A Transport

Implement `EventTransport` (`server/src/events/transport.ts`): `publish` must
throw when the message was not accepted and be safe to call again with the
same message. Add its name to `EVENT_TRANSPORTS`, build it in
`createEventTransport`, and check its settings in `assertEventTransportConfig`
so a misconfigured dispatcher fails at startup.
