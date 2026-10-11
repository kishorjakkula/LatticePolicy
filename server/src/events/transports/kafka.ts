import { Kafka, logLevel, type KafkaConfig, type Producer, type SASLOptions } from 'kafkajs'
import { logger } from '../../logger.js'
import { eventOrderingKey, type EventEnvelope } from '../envelope.js'
import type { EventTransport } from '../transport.js'

/**
 * Publishes each message to Kafka.
 *
 *   KAFKA_BROKERS         host:port list, comma-separated (required)
 *   KAFKA_TOPIC           one topic for every message (default lattice.events)
 *   KAFKA_TOPIC_PREFIX    set instead of KAFKA_TOPIC to publish each message
 *                         type to its own topic: <prefix>.<type>
 *   KAFKA_CLIENT_ID       default lattice-policy
 *   KAFKA_SSL             1 to use TLS
 *   KAFKA_SASL_MECHANISM  plain | scram-sha-256 | scram-sha-512
 *   KAFKA_SASL_USERNAME, KAFKA_SASL_PASSWORD
 *
 * The record key is the tenant and the entity the message is about, so
 * messages for one policy stay in order within a partition. The value is the
 * same JSON envelope the webhook sends. Delivery is at least once: a consumer
 * should treat `messageId` as an idempotency key.
 */

export type KafkaTransportSettings = {
  brokers: string[]
  clientId: string
  topic: string | null
  topicPrefix: string | null
  ssl: boolean
  sasl: SASLOptions | undefined
}

const SASL_MECHANISMS = ['plain', 'scram-sha-256', 'scram-sha-512'] as const

export function readKafkaSettings(env: NodeJS.ProcessEnv = process.env): KafkaTransportSettings {
  const brokers = String(env.KAFKA_BROKERS || '').split(',').map((broker) => broker.trim()).filter(Boolean)
  if (brokers.length === 0) throw new Error('KAFKA_BROKERS is required when EVENT_TRANSPORT is kafka')

  const topic = String(env.KAFKA_TOPIC || '').trim()
  const topicPrefix = String(env.KAFKA_TOPIC_PREFIX || '').trim()
  if (topic && topicPrefix) throw new Error('Set KAFKA_TOPIC or KAFKA_TOPIC_PREFIX, not both')
  for (const name of [topic, topicPrefix].filter(Boolean)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`Kafka topic names may only use letters, digits, '.', '_' and '-'; got '${name}'`)
  }

  const mechanism = String(env.KAFKA_SASL_MECHANISM || '').trim().toLowerCase()
  let sasl: SASLOptions | undefined
  if (mechanism) {
    if (!(SASL_MECHANISMS as readonly string[]).includes(mechanism)) {
      throw new Error(`KAFKA_SASL_MECHANISM must be one of ${SASL_MECHANISMS.join(', ')}`)
    }
    const username = String(env.KAFKA_SASL_USERNAME || '')
    const password = String(env.KAFKA_SASL_PASSWORD || '')
    if (!username || !password) throw new Error('KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required with KAFKA_SASL_MECHANISM')
    sasl = { mechanism, username, password } as SASLOptions
  }

  return {
    brokers,
    clientId: String(env.KAFKA_CLIENT_ID || '').trim() || 'lattice-policy',
    topic: topicPrefix ? null : topic || 'lattice.events',
    topicPrefix: topicPrefix || null,
    ssl: ['1', 'true', 'yes', 'on'].includes(String(env.KAFKA_SSL || '').trim().toLowerCase()),
    sasl,
  }
}

/** The Kafka topic a message type goes to. Type names are made safe for Kafka. */
export function kafkaTopicFor(settings: Pick<KafkaTransportSettings, 'topic' | 'topicPrefix'>, type: string): string {
  if (settings.topic) return settings.topic
  return `${settings.topicPrefix}.${String(type).replace(/[^A-Za-z0-9._-]+/g, '_')}`
}

export function createKafkaTransport(settings: KafkaTransportSettings = readKafkaSettings()): EventTransport {
  const config: KafkaConfig = {
    clientId: settings.clientId,
    brokers: settings.brokers,
    ssl: settings.ssl,
    sasl: settings.sasl,
    logLevel: logLevel.ERROR,
    logCreator: () => ({ log }) => logger.error({ kafka: log.message, broker: (log as any).broker }, '[async-push] Kafka client error'),
  }
  const producer: Producer = new Kafka(config).producer({ allowAutoTopicCreation: true, idempotent: true, maxInFlightRequests: 1 })
  let connected: Promise<void> | null = null

  // Connect on first use and again after a failure, so a broker that is down
  // at startup only delays delivery.
  const ensureConnected = () => {
    if (!connected) {
      connected = producer.connect().catch((err) => {
        connected = null
        throw err
      })
    }
    return connected
  }

  return {
    name: 'kafka',
    async publish(envelope: EventEnvelope) {
      await ensureConnected()
      try {
        await producer.send({
          topic: kafkaTopicFor(settings, envelope.type),
          acks: -1,
          messages: [{
            key: eventOrderingKey(envelope),
            value: JSON.stringify(envelope),
            headers: {
              'lattice-message-id': envelope.messageId,
              'lattice-tenant-id': envelope.tenantId,
              'lattice-type': envelope.type,
              'lattice-spec-version': envelope.specVersion,
              ...(envelope.schemaVersion ? { 'lattice-schema-version': envelope.schemaVersion } : {}),
            },
          }],
        })
      } catch (err) {
        // Force a clean reconnect before the dispatcher's retry.
        connected = null
        await producer.disconnect().catch(() => {})
        throw err
      }
    },
    async close() {
      connected = null
      await producer.disconnect().catch(() => {})
    },
  }
}
