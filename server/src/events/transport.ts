import type { EventTransport } from './types.js'
import { createWebhookTransport } from './transports/webhook.js'
import { createKafkaTransport, readKafkaSettings } from './transports/kafka.js'

export type { EventTransport } from './types.js'

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
