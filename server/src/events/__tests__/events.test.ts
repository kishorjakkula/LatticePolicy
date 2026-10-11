import fs from 'fs'
import path from 'path'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildEventEnvelope, eventOrderingKey, payloadSchemaVersion } from '../envelope.js'
import { assertEventTransportConfig, createEventTransport, getEventTransportName } from '../transport.js'
import { kafkaTopicFor, readKafkaSettings } from '../transports/kafka.js'
import { createWebhookTransport } from '../transports/webhook.js'

const row = {
  message_id: '11111111-1111-4111-8111-111111111111',
  tenant_id: 'acme-mutual',
  topic: 'ledger.commission_handoff',
  created_at: '2026-10-11T02:00:00.000Z',
  payload: { eventId: 'e-1', entityType: 'Policy', entityId: 'policy-9', event: 'COMMISSION_HANDOFF', payload: { schemaVersion: 'commission-handoff.v1' } },
}

describe('event envelope', () => {
  it('keeps the original webhook fields and adds a version, a type, and the payload contract version', () => {
    expect(buildEventEnvelope(row, 2)).toEqual({
      specVersion: '1',
      messageId: row.message_id,
      tenantId: 'acme-mutual',
      type: 'ledger.commission_handoff',
      topic: 'ledger.commission_handoff',
      schemaVersion: 'commission-handoff.v1',
      attempt: 2,
      createdAt: '2026-10-11T02:00:00.000Z',
      payload: row.payload,
    })
    expect(buildEventEnvelope({ ...row, created_at: new Date('2026-10-11T02:00:00Z') }, 1).createdAt).toBe('2026-10-11T02:00:00.000Z')
  })

  it('matches the published envelope contract', () => {
    const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../contracts/events/envelope.v1.schema.json'), 'utf8'))
    const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema)
    expect(validate(buildEventEnvelope(row, 1))).toBe(true)
    expect(validate({ ...buildEventEnvelope(row, 1), specVersion: '2' })).toBe(false)
    const { messageId: _omitted, ...withoutId } = buildEventEnvelope(row, 1)
    expect(validate(withoutId)).toBe(false)
  })

  it('reads the payload contract version from where existing events put it', () => {
    expect(payloadSchemaVersion({ schemaVersion: 'x.v2' })).toBe('x.v2')
    expect(payloadSchemaVersion({ payload: { schemaVersion: 'commission-handoff.v1' } })).toBe('commission-handoff.v1')
    expect(payloadSchemaVersion({ payload: {} })).toBeNull()
    expect(payloadSchemaVersion(null)).toBeNull()
  })

  it('keys a message by tenant and the entity it is about, so one policy stays in order', () => {
    expect(eventOrderingKey(buildEventEnvelope(row, 1))).toBe('acme-mutual:policy-9')
    expect(eventOrderingKey(buildEventEnvelope({ ...row, payload: { policyId: 'policy-3' } }, 1))).toBe('acme-mutual:policy-3')
    expect(eventOrderingKey(buildEventEnvelope({ ...row, payload: { subject: 'hello' } }, 1))).toBe(`acme-mutual:${row.message_id}`)
  })
})

describe('event transport selection', () => {
  const original = { ...process.env }
  beforeEach(() => {
    for (const key of Object.keys(process.env)) if (key.startsWith('KAFKA_') || key === 'EVENT_TRANSPORT' || key.startsWith('ASYNC_PUSH_')) delete process.env[key]
  })
  afterEach(() => {
    process.env = { ...original }
    vi.unstubAllGlobals()
  })

  it('defaults to the webhook, as before', () => {
    expect(getEventTransportName()).toBe('webhook')
    expect(assertEventTransportConfig()).toBe('webhook')
    expect(createEventTransport().name).toBe('webhook')
  })

  it('rejects an unknown transport and an incomplete Kafka configuration at startup', () => {
    process.env.EVENT_TRANSPORT = 'pigeon'
    expect(() => getEventTransportName()).toThrow(/EVENT_TRANSPORT must be one of webhook, kafka; got 'pigeon'/)
    process.env.EVENT_TRANSPORT = 'kafka'
    expect(() => assertEventTransportConfig()).toThrow(/KAFKA_BROKERS is required/)
    process.env.KAFKA_BROKERS = 'broker-1:9092'
    expect(assertEventTransportConfig()).toBe('kafka')
  })

  it('reads Kafka settings', () => {
    expect(readKafkaSettings({ KAFKA_BROKERS: ' a:9092, b:9092 ,' })).toEqual({
      brokers: ['a:9092', 'b:9092'], clientId: 'lattice-policy', topic: 'lattice.events', topicPrefix: null, ssl: false, sasl: undefined,
    })
    expect(readKafkaSettings({ KAFKA_BROKERS: 'a:9092', KAFKA_TOPIC_PREFIX: 'acme', KAFKA_CLIENT_ID: 'acme-pas', KAFKA_SSL: 'true', KAFKA_SASL_MECHANISM: 'SCRAM-SHA-512', KAFKA_SASL_USERNAME: 'u', KAFKA_SASL_PASSWORD: 'p' })).toEqual({
      brokers: ['a:9092'], clientId: 'acme-pas', topic: null, topicPrefix: 'acme', ssl: true, sasl: { mechanism: 'scram-sha-512', username: 'u', password: 'p' },
    })
  })

  it('rejects Kafka settings that cannot work', () => {
    expect(() => readKafkaSettings({})).toThrow(/KAFKA_BROKERS is required/)
    expect(() => readKafkaSettings({ KAFKA_BROKERS: 'a:9092', KAFKA_TOPIC: 'one', KAFKA_TOPIC_PREFIX: 'two' })).toThrow(/not both/)
    expect(() => readKafkaSettings({ KAFKA_BROKERS: 'a:9092', KAFKA_TOPIC: 'bad topic' })).toThrow(/may only use/)
    expect(() => readKafkaSettings({ KAFKA_BROKERS: 'a:9092', KAFKA_SASL_MECHANISM: 'kerberos' })).toThrow(/KAFKA_SASL_MECHANISM must be one of/)
    expect(() => readKafkaSettings({ KAFKA_BROKERS: 'a:9092', KAFKA_SASL_MECHANISM: 'plain' })).toThrow(/KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD/)
  })

  it('sends everything to one topic, or one topic per message type with a prefix', () => {
    expect(kafkaTopicFor({ topic: 'lattice.events', topicPrefix: null }, 'ledger.commission_handoff')).toBe('lattice.events')
    expect(kafkaTopicFor({ topic: null, topicPrefix: 'acme' }, 'ledger.commission_handoff')).toBe('acme.ledger.commission_handoff')
    expect(kafkaTopicFor({ topic: null, topicPrefix: 'acme' }, 'notification.policy issued!')).toBe('acme.notification.policy_issued_')
  })
})

describe('webhook transport', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts the envelope with the configured authorization', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    await createWebhookTransport({ webhookUrl: 'https://hooks.example.com/pas', authHeader: 'Bearer token' }).publish(buildEventEnvelope(row, 1))

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://hooks.example.com/pas')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token')
    expect(JSON.parse(String(init.body))).toMatchObject({ specVersion: '1', messageId: row.message_id, topic: 'ledger.commission_handoff', payload: row.payload })
  })

  it('fails the delivery when the receiver does not accept it, so the dispatcher retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream down', { status: 503 })))
    await expect(createWebhookTransport({ webhookUrl: 'https://hooks.example.com/pas' }).publish(buildEventEnvelope(row, 1)))
      .rejects.toThrow('webhook returned 503: upstream down')
  })

  it('writes to the log instead when no URL is configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await createWebhookTransport({ webhookUrl: '' }).publish(buildEventEnvelope(row, 1))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
