/**
 * The envelope every outbound message is delivered in, whatever the
 * transport. Its contract is contracts/events/envelope.v1.schema.json.
 *
 * `messageId`, `tenantId`, `topic`, `attempt`, `createdAt`, and `payload` are
 * the fields consumers of the original webhook already rely on and keep
 * their meaning. `specVersion`, `type`, and `schemaVersion` were added so a
 * consumer can tell which envelope and which payload contract it is reading.
 */
export const EVENT_ENVELOPE_VERSION = '1'

export type OutboxMessage = {
  message_id: string
  tenant_id: string
  topic: string
  payload: unknown
  created_at: string | Date
}

export type EventEnvelope = {
  specVersion: string
  messageId: string
  tenantId: string
  /** Same value as `topic`; the name a consumer routes on. */
  type: string
  topic: string
  /** Version of the payload contract, when the payload declares one. */
  schemaVersion: string | null
  attempt: number
  createdAt: string
  payload: unknown
}

function isoDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString()
}

/** The payload contract version a payload declares, looking where the existing events put it. */
export function payloadSchemaVersion(payload: unknown): string | null {
  const candidates = [(payload as any)?.schemaVersion, (payload as any)?.payload?.schemaVersion]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

export function buildEventEnvelope(row: OutboxMessage, attempt: number): EventEnvelope {
  return {
    specVersion: EVENT_ENVELOPE_VERSION,
    messageId: row.message_id,
    tenantId: row.tenant_id,
    type: row.topic,
    topic: row.topic,
    schemaVersion: payloadSchemaVersion(row.payload),
    attempt,
    createdAt: isoDate(row.created_at),
    payload: row.payload,
  }
}

/**
 * What a message is about, for transports that order by key: the policy or
 * other entity when the payload names one, otherwise the message itself.
 * Messages with the same key are delivered in the order they were written.
 */
export function eventOrderingKey(envelope: EventEnvelope): string {
  const payload = envelope.payload as any
  const entity = payload?.entityId ?? payload?.policyId ?? payload?.payload?.policyId ?? payload?.policy?.policyId ?? envelope.messageId
  return `${envelope.tenantId}:${String(entity)}`
}
