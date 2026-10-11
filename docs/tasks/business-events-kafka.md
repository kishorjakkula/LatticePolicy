# Task Note: Message Envelope, Transport Interface, And Kafka

## Links

- Issue: none yet (module split, step 3)
- Pull request:

## Summary

Policy transactions already published messages through `ledger_events`, a
trigger, and `async_message_outbox`, delivered to one webhook. This change
gives those messages a versioned envelope, puts delivery behind a transport
interface, adds a Kafka transport, and fixes a case where a message could be
lost.

## Important Files

- `server/src/events/envelope.ts`: `buildEventEnvelope`, `eventOrderingKey`.
- `server/src/events/transport.ts`: `EventTransport`, `createEventTransport`,
  `assertEventTransportConfig`.
- `server/src/events/transports/webhook.ts`, `kafka.ts`.
- `server/src/asyncMessageWorker.ts`: publishes through the transport;
  `claimOutboxRows` takes over abandoned `Processing` rows after a lease.
- `server/src/index.ts`: a dispatching process checks its transport settings
  at startup.
- `contracts/events/envelope.v1.schema.json`: the envelope contract.
- `deploy/carrier-stack/`: `EVENT_TRANSPORT` and `KAFKA_*` for the dispatcher.
- `docs/EVENTS.md`.

## Behavior Rules

- The fields the original webhook sent (`messageId`, `tenantId`, `topic`,
  `attempt`, `createdAt`, `payload`) keep their names and meaning. New
  envelope fields are additive; a breaking change needs a new `specVersion`.
- `EVENT_TRANSPORT` unset means `webhook`, with the behavior it always had.
- A transport's `publish` throws when the message was not accepted. The
  dispatcher owns retries and status; a transport never marks a row.
- Publishing must not happen inside a policy transaction. Transactions write
  the outbox; only the dispatcher talks to a webhook or broker.
- Delivery is at least once. Do not add logic that assumes exactly once.

## Automated Tests

- `server/src/events/__tests__/events.test.ts`: envelope shape and contract,
  ordering key, transport selection, Kafka settings, webhook delivery.
- `server/src/__tests__/job-queue.integration.test.ts`: an abandoned
  `Processing` row is taken over; one within its lease, or out of attempts,
  is not.
- Full unit and integration suites.
- Exercised by hand on a kit stack against a real Kafka broker
  (`apache/kafka:3.9.0`): five messages from a quote, bind, and issue were
  delivered with the expected key, headers, and envelope; with the broker
  stopped a cancellation still succeeded and its messages waited, then were
  delivered once the broker returned, with no duplicates; a row left in
  `Processing` was not delivered before the lease fix and was after it.

## Validation

```bash
npm run test:server
npm run test:integration
```

## Follow-Ups Or Risks

- Only `commission-handoff.v1` has a versioned payload contract. The other
  ledger and notification payloads are published as they are stored.
- No dedicated events for quote rated or product changes; only what the
  ledger and notifications already record is published.
- The Kafka transport was tested against one unauthenticated broker. TLS and
  SASL settings are parsed and passed to the client but were not exercised.
- No consumer, schema registry, or dead-letter topic is provided. A message
  that exhausts its attempts stays `Failed` in the outbox.
- While the broker is unreachable the dispatcher's batch waits on the Kafka
  client's own connection retries before the outbox retry takes over.
- There is no automated test against a broker in CI.
