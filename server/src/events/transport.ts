import type { EventEnvelope } from './envelope.js'
import { createWebhookTransport } from './transports/webhook.js'
import { createKafkaTransport, readKafkaSettings } from './transports/kafka.js'

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

export const EVENT_TRANSPORTS = ['webhook', 'kafka'] as const
export type EventTransportName = (typeof EVENT_TRANSPORTS)[number]

export function getEventTransportName(): EventTransportName {
  const value = String(process.env.EVENT_TRANSPORT || '').trim().toLowerCase()
  if (!value) return 'webhook'
  if (!(EVENT_TRANSPORTS as readonly string[]).includes(value)) {
    throw new Error(`EVENT_TRANSPORT must be one of ${EVENT_TRANSPORTS.join(', ')}; got '${value}'`)
  }
  return value as EventTransportName
}

/** Builds the configured transport. Throws when its settings are incomplete. */
export function createEventTransport(name: EventTransportName = getEventTransportName()): EventTransport {
  return name === 'kafka' ? createKafkaTransport() : createWebhookTransport()
}

/**
 * Checks the transport's settings without connecting, so a process that
 * delivers messages fails at startup on a bad configuration rather than on
 * its first message.
 */
export function assertEventTransportConfig(): EventTransportName {
  const name = getEventTransportName()
  if (name === 'kafka') readKafkaSettings()
  return name
}
