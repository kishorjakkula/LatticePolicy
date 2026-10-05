import { expect } from 'vitest'
import { getDb, withTenantTx } from '../../db.js'
import { createOrRateQuote } from '../../services/quote.service.js'
import { bindQuote } from '../../services/quote-bind.service.js'
import { issuePolicy } from '../../services/lifecycle.service.js'

export const scenarioActor = {
  id: null,
  username: 'policy-scenario-matrix',
  roles: ['admin'],
  permissions: ['uw.referrals.decide', 'uw.authority.override'],
}

export function scenarioQuotePayload(overrides: Record<string, any> = {}) {
  const base = {
    productCode: 'personal-auto', effectiveDate: '2026-07-01', termMonths: 12, state: 'CA',
    applicant: { firstName: 'Scenario', lastName: 'Insured', email: 'scenario@example.com' },
    insureds: { primary: { firstName: 'Scenario', lastName: 'Insured', email: 'scenario@example.com' } },
    uwAnswers: { driverAge: 35 },
    risks: [{ type: 'autoVehicle', year: 2024, make: 'Toyota', model: 'Camry', garagingZip: '94105', symbol: 'A', usage: 'commute', annualMiles: 12000, driverAge: 35 }],
    coverages: [{ code: 'BI', selected: true, limit: 100000 }, { code: 'PD', selected: true, limit: 50000 }],
  }
  return { ...base, ...overrides }
}

export async function ensureScenarioTenant(tenantId: string) {
  await getDb()!.query(
    `INSERT INTO tenants (tenant_id,name,default_locale,default_currency) VALUES ($1,$2,'en-US','USD')
     ON CONFLICT (tenant_id) DO UPDATE SET name=EXCLUDED.name`, [tenantId, `Scenario ${tenantId}`]
  )
  await getDb()!.query(
    `INSERT INTO short_rate_tables (tenant_id,product_code,state_code,table_data,effective_date,active)
     VALUES ($1,'personal-auto','CA',$2::jsonb,'2026-01-01',true)
     ON CONFLICT (tenant_id,COALESCE(product_code,'*'),COALESCE(state_code,'*')) DO UPDATE SET table_data=EXCLUDED.table_data,active=true`,
    [tenantId, JSON.stringify([{ days_from: 0, days_to: 365, earned_pct: 0.35 }])]
  )
  await getDb()!.query(
    `INSERT INTO product_state_eligibility (tenant_id,product_code,state_code,admitted,status,effective_date)
     VALUES ($1,'personal-auto','CA',true,'ACTIVE','2026-01-01')
     ON CONFLICT (tenant_id,product_code,state_code) DO UPDATE SET status='ACTIVE',admitted=true`, [tenantId]
  )
}

export async function seedScenarioForms(tenantId: string) {
  const formId = '31900000-0000-4319-8319-000000000001'
  await getDb()!.query(
    `INSERT INTO forms_admin_forms (form_id,tenant_id,carrier_code,authority,form_number,form_title,edition_date,form_type,line_of_business,workflow_status,active)
     VALUES ($1,$2,'SCENARIO','ISO','SCENARIO-319','Scenario Transaction Form','2026-01-01','Declarations','personal-auto','Approved',true)
     ON CONFLICT (tenant_id,carrier_code,authority,form_number,edition_date) DO UPDATE SET active=true,workflow_status='Approved'`, [formId, tenantId]
  )
  await getDb()!.query(
    `INSERT INTO forms_admin_applicability (tenant_id,form_id,line_of_business,product_code,transaction_types,active)
     VALUES ($1,$2,'personal-auto','personal-auto',ARRAY['NB','Endorse','Cancel','Reinstate','Renew','NonRenewal']::text[],true) ON CONFLICT DO NOTHING`, [tenantId, formId]
  )
  await getDb()!.query(
    `UPDATE forms_admin_applicability SET endorsement_change_criteria='{"alwaysAttachOnEndorsement":true}'::jsonb
      WHERE tenant_id=$1 AND form_id=$2`, [tenantId, formId]
  )
  await getDb()!.query(
    `INSERT INTO forms_admin_jurisdictions (tenant_id,form_id,state_code,regulatory_status,effective_date)
     VALUES ($1,$2,'CA','Approved','2026-01-01') ON CONFLICT DO NOTHING`, [tenantId, formId]
  )
}

export async function createScenarioPolicy(tenantId: string, overrides: Record<string, any> = {}) {
  const quote = await createOrRateQuote({} as any, tenantId, scenarioQuotePayload(overrides), null, 'scenario-matrix')
  const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'scenario-matrix', null, scenarioActor)
  const issued = await withTenantTx(tenantId, (db) => issuePolicy(db, tenantId, bound.policyId, {}, scenarioActor))
  return { quote, bound, issued, policyId: bound.policyId }
}

export async function expectTransactionInvariants(tenantId: string, policyId: string, transactionId: string, label: string) {
  const result = await getDb()!.query(
    `SELECT pt.type, pt.rating_id, pv.version_id, pv.premium_total,
       (SELECT count(*)::int FROM policy_forms pf WHERE pf.tenant_id=pt.tenant_id AND pf.transaction_id=pt.transaction_id) form_count,
       (SELECT count(*)::int FROM documents d WHERE d.tenant_id=pt.tenant_id AND d.transaction_id=pt.transaction_id) document_count,
       (SELECT count(*)::int FROM ledger_events le WHERE le.tenant_id=pt.tenant_id AND le.entity_id=pt.policy_id
          AND (le.payload->>'transactionId'=pt.transaction_id::text OR le.payload->'transaction'->>'transactionId'=pt.transaction_id::text)) event_count
     FROM policy_transactions pt LEFT JOIN policy_versions pv ON pv.tenant_id=pt.tenant_id AND pv.transaction_id=pt.transaction_id
     WHERE pt.tenant_id=$1 AND pt.policy_id=$2 AND pt.transaction_id=$3`, [tenantId, policyId, transactionId]
  )
  const row = result.rows[0]
  expect(row, `${label}: transaction must persist`).toBeTruthy()
  expect(row.version_id, `${label}: transaction must create a policy version`).toBeTruthy()
  expect(row.rating_id, `${label}: transaction must retain a rating reference`).toBeTruthy()
  expect(Number(row.form_count), `${label}: transaction must pin at least one form`).toBeGreaterThan(0)
  expect(Number(row.document_count), `${label}: transaction must create a document packet`).toBeGreaterThan(0)
  expect(Number(row.event_count), `${label}: transaction must emit a correlated ledger event`).toBeGreaterThan(0)
  expect(Number.isFinite(Number(row.premium_total)), `${label}: version premium must be numeric`).toBe(true)
  return row
}

export async function transactionIdFor(tenantId: string, policyId: string, transactionNumber: string) {
  const result = await getDb()!.query(
    `SELECT transaction_id FROM policy_transactions WHERE tenant_id=$1 AND policy_id=$2
      AND (metadata->>'transactionNumber'=$3 OR snapshot->>'transactionNumber'=$3)
      ORDER BY processed_at DESC LIMIT 1`, [tenantId, policyId, transactionNumber]
  )
  expect(result.rows[0]?.transaction_id, `${transactionNumber}: transaction number must resolve to a durable transaction`).toBeTruthy()
  return result.rows[0].transaction_id as string
}
