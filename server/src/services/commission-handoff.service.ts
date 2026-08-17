import { toRawQuery, type DrizzleDB } from '../db.js'
import { safeMoney } from '../persistence.js'

type CommissionTransactionType =
  | 'QuoteBind'
  | 'Issue'
  | 'Endorse'
  | 'Cancel'
  | 'Reinstate'
  | 'Rewrite'
  | 'Renew'
  | 'NonRenewal'

type CommissionHandoffInput = {
  tenantId: string
  policyId: string
  policyNumber?: string | null
  transactionId?: string | null
  transactionNumber?: string | null
  transactionType: CommissionTransactionType
  sourceEvent?: string | null
  effectiveDate?: string | null
  expirationDate?: string | null
  processedAt?: string | null
  productCode?: string | null
  state?: string | null
  premiumImpact?: number | null
  currency?: string | null
  payload?: any
  policyMetadata?: any
  actorId?: string | null
  correlationId?: string | null
  requestId?: string | null
}

function readPath(source: any, path: string): any {
  if (!source || typeof source !== 'object') return null
  return path.split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') return null
    return current[part]
  }, source)
}

function firstText(...values: any[]): string | null {
  for (const value of values) {
    if (value == null) continue
    const text = String(value).trim()
    if (text) return text
  }
  return null
}

function normalizeMoney(amount: number | null | undefined, currency: string | null | undefined) {
  return {
    amount: safeMoney(amount),
    currency: firstText(currency, 'USD') || 'USD',
  }
}

function extractProducer(payload: any, metadata: any) {
  const producer = payload?.producer || payload?.agent || payload?.broker || {}
  const agency = payload?.agency || producer?.agency || {}
  return {
    producerId: firstText(
      metadata?.producerId,
      metadata?.producer_id,
      payload?.producerId,
      payload?.producer_id,
      producer?.producerId,
      producer?.producer_id,
      producer?.id,
    ),
    producerKey: firstText(
      metadata?.producerKey,
      metadata?.producer_key,
      payload?.producerKey,
      payload?.producer_key,
      producer?.producerKey,
      producer?.producer_key,
      producer?.key,
    ),
    producerNpn: firstText(
      metadata?.producerNpn,
      metadata?.npn,
      payload?.producerNpn,
      payload?.npn,
      producer?.npn,
      producer?.producerNpn,
    ),
    producerName: firstText(
      metadata?.producerName,
      payload?.producerName,
      producer?.name,
      producer?.displayName,
      [producer?.firstName, producer?.lastName].filter(Boolean).join(' '),
    ),
    agencyId: firstText(
      metadata?.agencyId,
      metadata?.agency_id,
      payload?.agencyId,
      payload?.agency_id,
      agency?.agencyId,
      agency?.agency_id,
      agency?.id,
      producer?.agencyId,
    ),
    agencyKey: firstText(
      metadata?.agencyKey,
      metadata?.agency_key,
      payload?.agencyKey,
      payload?.agency_key,
      agency?.agencyKey,
      agency?.agency_key,
      agency?.key,
      producer?.agencyKey,
    ),
    agencyCode: firstText(
      metadata?.agencyCode,
      metadata?.agency_code,
      payload?.agencyCode,
      payload?.agency_code,
      agency?.agencyCode,
      agency?.agency_code,
      agency?.code,
      producer?.agencyCode,
    ),
    agencyName: firstText(
      metadata?.agencyName,
      payload?.agencyName,
      agency?.legalName,
      agency?.name,
      producer?.agencyName,
    ),
  }
}

export function buildCommissionHandoffPayload(input: CommissionHandoffInput) {
  const payload = input.payload || {}
  const metadata = input.policyMetadata || {}
  const transactionNumber = firstText(input.transactionNumber, metadata?.transactionNumber)
  const productCode = firstText(input.productCode, payload?.productCode)
  const state = firstText(
    input.state,
    payload?.state,
    payload?.jurisdiction?.code,
    readPath(payload, 'risk.state'),
    readPath(payload, 'insureds.primary.address.state'),
  )
  const processedAt = input.processedAt || new Date().toISOString()
  const correlationId = firstText(
    input.correlationId,
    input.requestId,
    transactionNumber,
    input.transactionId,
  )

  return {
    schemaVersion: 'commission-handoff.v1',
    eventType: 'COMMISSION_HANDOFF',
    sourceEvent: firstText(input.sourceEvent, input.transactionType),
    idempotencyKey: [
      input.tenantId,
      input.policyId,
      input.transactionId || transactionNumber || input.transactionType,
      input.transactionType,
    ].join(':'),
    correlationId,
    requestId: firstText(input.requestId),
    tenantId: input.tenantId,
    policy: {
      policyId: input.policyId,
      policyNumber: firstText(input.policyNumber, metadata?.policyNumber),
      productCode,
      state,
      effectiveDate: firstText(input.effectiveDate, payload?.effectiveDate),
      expirationDate: firstText(input.expirationDate, payload?.expirationDate),
    },
    transaction: {
      transactionId: firstText(input.transactionId),
      transactionNumber,
      transactionType: input.transactionType,
      effectiveDate: firstText(input.effectiveDate, payload?.effectiveDate),
      processedAt,
    },
    producer: extractProducer(payload, metadata),
    premiumImpact: normalizeMoney(input.premiumImpact, input.currency),
    accountingBoundary: {
      latticePolicyOwns: [
        'policy transaction source event',
        'producer and agency identifiers captured on the policy',
        'premium impact produced by the policy transaction',
        'tenant-scoped idempotent handoff event',
      ],
      externalCommissionSystemOwns: [
        'commission calculation',
        'producer payable creation',
        'commission statements',
        'chargeback accounting',
        'payment and settlement status',
      ],
    },
  }
}

export async function createCommissionHandoffEvent(
  db: DrizzleDB,
  input: CommissionHandoffInput,
): Promise<void> {
  const q = toRawQuery(db)
  const handoffPayload = buildCommissionHandoffPayload(input)
  await q(
    `INSERT INTO ledger_events (
      tenant_id, entity_type, entity_id, event, from_state, to_state, payload, actor
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.tenantId,
      'Policy',
      input.policyId,
      'COMMISSION_HANDOFF',
      input.sourceEvent || null,
      'CommissionHandoffQueued',
      handoffPayload,
      input.actorId || null,
    ],
  )
}
