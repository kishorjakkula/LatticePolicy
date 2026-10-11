import type { EventEnvelope } from './envelope.js'

/**
 * Where outbox messages are delivered. The outbox and the dispatcher are the
 * same for every transport; only this last step differs, so a carrier can
 * move from a webhook to a broker without touching anything that publishes.
 *
 * `publish` must throw when the message was not accepted, so the dispatcher
 * retries it. It must be safe to call again with the same message.
 */
export interface EventTransport {
  readonly name: string
  publish(envelope: EventEnvelope): Promise<void>
  close(): Promise<void>
}
