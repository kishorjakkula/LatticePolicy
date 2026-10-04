import { withTenantTx, toRawQuery } from '../../db.js'
import { v4 as uuidv4 } from '../../uuid.js'
import type { JobHandler } from '../registry.js'

export const POLICY_INTEGRITY_CLASSES = [
  'MISSING_VERSION',
  'MISSING_RATING',
  'MISSING_FORMS',
  'MISSING_DOCUMENT',
  'MISSING_LEDGER_EVENT',
  'MISSING_CUSTOMER_LINK',
  'INCOMPLETE_SIDE_EFFECT',
] as const

export interface PolicyIntegrityPayload {
  policyId?: string
}

interface DetectedException {
  policy_id: string
  transaction_id: string | null
  exception_class: typeof POLICY_INTEGRITY_CLASSES[number]
  severity: 'Warning' | 'Error' | 'Critical'
  summary: string
  suggested_action: string
  details: Record<string, unknown>
}

const DOCUMENT_TRANSACTION_TYPES = "'NB','ENDORSE','CANCEL','REINSTATE','RENEW','REWRITE','NON_RENEWAL'"

export function policyIntegrityQueries(policyId?: string): Array<{ exceptionClass: string; sql: string; params: unknown[] }> {
  const scope = policyId ? ' AND p.policy_id = $2' : ''
  const params = policyId ? [policyId] : []
  return [
    {
      exceptionClass: 'MISSING_VERSION', params,
      sql: `SELECT p.policy_id, pt.transaction_id, 'MISSING_VERSION' exception_class, 'Critical' severity,
                   'Completed transaction has no policy version' summary, 'Investigate' suggested_action,
                   jsonb_build_object('transactionType', pt.type, 'processedAt', pt.processed_at) details
              FROM policies p JOIN policy_transactions pt ON pt.tenant_id = p.tenant_id AND pt.policy_id = p.policy_id
             WHERE p.tenant_id = $1 AND pt.processed_at IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM policy_versions pv WHERE pv.tenant_id = p.tenant_id AND pv.transaction_id = pt.transaction_id)${scope}`,
    },
    {
      exceptionClass: 'MISSING_RATING', params,
      sql: `SELECT p.policy_id, pt.transaction_id, 'MISSING_RATING' exception_class, 'Critical' severity,
                   'Transaction references a missing rating result' summary, 'Investigate' suggested_action,
                   jsonb_build_object('ratingId', pt.rating_id, 'transactionType', pt.type) details
              FROM policies p JOIN policy_transactions pt ON pt.tenant_id = p.tenant_id AND pt.policy_id = p.policy_id
             WHERE p.tenant_id = $1 AND pt.processed_at IS NOT NULL AND pt.rating_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.tenant_id = p.tenant_id AND r.rating_id = pt.rating_id)${scope}`,
    },
    {
      exceptionClass: 'MISSING_FORMS', params,
      sql: `SELECT p.policy_id, pt.transaction_id, 'MISSING_FORMS' exception_class, 'Error' severity,
                   'Document-producing transaction has no pinned forms' summary, 'RebuildPacket' suggested_action,
                   jsonb_build_object('transactionType', pt.type) details
              FROM policies p JOIN policy_transactions pt ON pt.tenant_id = p.tenant_id AND pt.policy_id = p.policy_id
             WHERE p.tenant_id = $1 AND pt.processed_at IS NOT NULL AND pt.type::text IN (${DOCUMENT_TRANSACTION_TYPES})
               AND NOT EXISTS (SELECT 1 FROM policy_forms pf WHERE pf.tenant_id = p.tenant_id AND pf.transaction_id = pt.transaction_id)${scope}`,
    },
    {
      exceptionClass: 'MISSING_DOCUMENT', params,
      sql: `SELECT p.policy_id, pt.transaction_id, 'MISSING_DOCUMENT' exception_class, 'Error' severity,
                   'Document-producing transaction has no policy packet' summary, 'RebuildPacket' suggested_action,
                   jsonb_build_object('transactionType', pt.type) details
              FROM policies p JOIN policy_transactions pt ON pt.tenant_id = p.tenant_id AND pt.policy_id = p.policy_id
             WHERE p.tenant_id = $1 AND pt.processed_at IS NOT NULL AND pt.type::text IN (${DOCUMENT_TRANSACTION_TYPES})
               AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.tenant_id = p.tenant_id AND d.transaction_id = pt.transaction_id)${scope}`,
    },
    {
      exceptionClass: 'MISSING_LEDGER_EVENT', params,
      sql: `SELECT p.policy_id, pt.transaction_id, 'MISSING_LEDGER_EVENT' exception_class, 'Critical' severity,
                   'Completed transaction has no policy ledger event' summary, 'Investigate' suggested_action,
                   jsonb_build_object('transactionType', pt.type) details
              FROM policies p JOIN policy_transactions pt ON pt.tenant_id = p.tenant_id AND pt.policy_id = p.policy_id
             WHERE p.tenant_id = $1 AND pt.processed_at IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM ledger_events le WHERE le.tenant_id = p.tenant_id AND le.entity_type = 'Policy' AND le.entity_id = p.policy_id
                 AND (le.payload->>'transactionId' = pt.transaction_id::text OR le.payload->>'transaction_id' = pt.transaction_id::text))${scope}`,
    },
    {
      exceptionClass: 'MISSING_CUSTOMER_LINK', params,
      sql: `SELECT p.policy_id, NULL::uuid transaction_id, 'MISSING_CUSTOMER_LINK' exception_class, 'Warning' severity,
                   'Issued policy has no active customer link' summary, 'LinkCustomer' suggested_action,
                   jsonb_build_object('policyStatus', p.status) details
              FROM policies p WHERE p.tenant_id = $1 AND p.status IN ('Bound','Issued','Cancelled')
               AND NOT EXISTS (SELECT 1 FROM policy_customer_links pcl WHERE pcl.tenant_id = p.tenant_id AND pcl.policy_id = p.policy_id)${scope}`,
    },
    {
      exceptionClass: 'INCOMPLETE_SIDE_EFFECT', params,
      sql: `SELECT DISTINCT p.policy_id, pt.transaction_id, 'INCOMPLETE_SIDE_EFFECT' exception_class, 'Critical' severity,
                   'Transaction has a failed or incomplete required side effect' summary, 'Retry' suggested_action,
                   jsonb_build_object('documentIntegrity', d.integrity_status, 'outboxStatus', amo.status) details
              FROM policies p JOIN policy_transactions pt ON pt.tenant_id = p.tenant_id AND pt.policy_id = p.policy_id
              LEFT JOIN documents d ON d.tenant_id = p.tenant_id AND d.transaction_id = pt.transaction_id
              LEFT JOIN ledger_events le ON le.tenant_id = p.tenant_id AND le.entity_type = 'Policy' AND le.entity_id = p.policy_id
                AND (le.payload->>'transactionId' = pt.transaction_id::text OR le.payload->>'transaction_id' = pt.transaction_id::text)
              LEFT JOIN async_message_outbox amo ON amo.tenant_id = p.tenant_id AND amo.source_id = le.event_id
             WHERE p.tenant_id = $1 AND pt.processed_at IS NOT NULL
               AND (d.integrity_status = 'FAILED' OR amo.status = 'Failed')${scope}`,
    },
  ]
}

export const policyIntegrityReconciliationHandler: JobHandler = async ({ run, requestPayload, checkpoint }) => {
  const policyId = typeof (requestPayload as PolicyIntegrityPayload)?.policyId === 'string'
    ? (requestPayload as PolicyIntegrityPayload).policyId
    : undefined
  const correlationId = `policy-integrity:${run.run_id}:${uuidv4()}`

  const result = await withTenantTx(run.tenant_id, async (db) => {
    const q = toRawQuery(db)
    const detected: DetectedException[] = []
    for (const rule of policyIntegrityQueries(policyId)) {
      const rows = await q(rule.sql, [run.tenant_id, ...rule.params])
      detected.push(...rows.rows as DetectedException[])
    }

    const activeKeys = new Set<string>()
    for (const finding of detected) {
      const key = `${finding.policy_id}:${finding.transaction_id || ''}:${finding.exception_class}`
      activeKeys.add(key)
      await q(
        `INSERT INTO policy_integrity_exceptions
           (tenant_id, policy_id, transaction_id, exception_class, severity, summary, details, suggested_action, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_id, policy_id, (COALESCE(transaction_id, '00000000-0000-0000-0000-000000000000'::uuid)), exception_class)
           WHERE status <> 'Resolved'
         DO UPDATE SET severity = EXCLUDED.severity, summary = EXCLUDED.summary, details = EXCLUDED.details,
           suggested_action = EXCLUDED.suggested_action, correlation_id = EXCLUDED.correlation_id,
           last_detected_at = now(), updated_at = now()`,
        [run.tenant_id, finding.policy_id, finding.transaction_id, finding.exception_class, finding.severity,
          finding.summary, finding.details, finding.suggested_action, correlationId]
      )
    }

    const open = await q(
      `SELECT exception_id, policy_id, transaction_id, exception_class FROM policy_integrity_exceptions
        WHERE tenant_id = $1 AND status <> 'Resolved'${policyId ? ' AND policy_id = $2' : ''}`,
      policyId ? [run.tenant_id, policyId] : [run.tenant_id]
    )
    let autoResolved = 0
    for (const row of open.rows) {
      const key = `${row.policy_id}:${row.transaction_id || ''}:${row.exception_class}`
      if (!activeKeys.has(key)) {
        await q(`UPDATE policy_integrity_exceptions SET status = 'Resolved', resolved_at = now(), resolution_note = 'Automatically resolved by reconciliation', updated_at = now() WHERE exception_id = $1`, [row.exception_id])
        autoResolved += 1
      }
    }
    return { detected: detected.length, autoResolved, correlationId }
  })

  await checkpoint(result)
  return { resultPayload: result }
}
