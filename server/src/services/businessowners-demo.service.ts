import { createHash } from 'node:crypto'
import { getDb, withTenantTx, toRawQuery, type DrizzleDB } from '../db.js'
import { getPinnedTenantId } from '../config.js'
import { createCustomerRecord, loadCustomerRecordById, normalizeCustomerInput } from '../routes/customers.routes.js'
import { insertDraftQuote, createOrRateQuote } from './quote.service.js'
import { bindQuote } from './quote-bind.service.js'
import { issuePolicy } from './lifecycle.service.js'
import { createValidationRule, listValidationRules, type ValidationRuleInput } from './validation-rules.service.js'
import { runValidationGate, runPolicyValidationGate } from '../lib/validation-gate.js'
import { seedProductDocumentTemplates } from './product-document-templates.service.js'

type Q = (sql: string, params?: any[]) => Promise<any>
type Row = Record<string, any>
export const BUSINESSOWNERS_DEMO_KEY = 'WP-0010-BOP-DEMO-V1'
const TENANT = 'sample-carrier'
const PRODUCT = 'businessowners'
const COMPANY = 'Lattice Demo Commercial Insurance Company'
const AGENCY = 'Lattice Demo Business Agency'
const marker = (key: string) => ({ demoSetup: BUSINESSOWNERS_DEMO_KEY, demoKey: key, synthetic: true, nonContractual: true })

export type BusinessownersDemoOptions = {
  enabled: boolean
  tenantId: string
  operatorUserId: string
  agentUserId: string
  effectiveDate: string
  issueExample?: boolean
}
export type BusinessownersDemoResult = {
  tenantId: string
  companyId: string
  agencyId: string
  producerId: string
  customers: Record<string, string>
  quotes: Record<string, string>
  policyId: string | null
  blockers: Array<{ stage: string; code: string }>
}

export function assertBusinessownersDemoOptIn(options: BusinessownersDemoOptions): void {
  if (options.enabled !== true) throw new Error('BOP_DEMO_OPT_IN_REQUIRED')
  if (options.tenantId !== TENANT) throw new Error('BOP_DEMO_TENANT_NOT_ALLOWED')
  if (!['local', 'test'].includes(process.env.DEPLOYMENT_ENV || '') || process.env.NODE_ENV === 'production') {
    throw new Error('BOP_DEMO_LOCAL_OR_TEST_ONLY')
  }
  if (getPinnedTenantId() && getPinnedTenantId() !== TENANT) throw new Error('BOP_DEMO_TENANT_NOT_SERVED')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.effectiveDate) || !Number.isFinite(Date.parse(options.effectiveDate)) ||
      new Date(options.effectiveDate).toISOString().slice(0, 10) !== options.effectiveDate) throw new Error('BOP_DEMO_DATE_REQUIRED')
  for (const id of [options.operatorUserId, options.agentUserId]) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('BOP_DEMO_EXISTING_USER_REQUIRED')
  }
}

function stable(value: any): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
}

function matches(actual: any, expected: any): boolean {
  // A fixture field left undefined (such as a generated ID) is not compared.
  if (expected === undefined) return true
  if (actual instanceof Date) actual = actual.toISOString().slice(0, 10)
  if (typeof expected === 'number') return actual != null && Number(actual) === expected
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((item, i) => matches(actual[i], item))
  if (expected && typeof expected === 'object') return actual != null && Object.entries(expected).every(([key, value]) => matches(actual[key], value))
  return actual === expected
}

function requireMatch(actual: any, expected: any, key: string) {
  if (!matches(actual, expected)) throw new Error(`BOP_DEMO_CONFLICT:${key}`)
}

// Table and column identifiers below are fixed by this module, never supplied
// by a caller. Existing rows are compared, not updated or adopted silently.
async function ensureRow(q: Q, table: string, keys: Row, expected: Row): Promise<{ row: Row; created: boolean }> {
  const where = Object.keys(keys).map((key, i) => `${key}=$${i + 2}`).join(' AND ')
  const found = await q(`SELECT * FROM ${table} WHERE tenant_id=$1 AND ${where}`, [TENANT, ...Object.values(keys)])
  if (found.rows.length > 1) throw new Error(`BOP_DEMO_CONFLICT:${table}:duplicate`)
  if (found.rows[0]) {
    requireMatch(found.rows[0], { ...keys, ...expected }, table)
    return { row: found.rows[0], created: false }
  }
  const values = { tenant_id: TENANT, ...keys, ...expected }
  const columns = Object.keys(values)
  const inserted = await q(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(values))
  return { row: inserted.rows[0], created: true }
}

async function existingUser(q: Q, id: string, permissions: string[]) {
  const user = await q('SELECT user_id,username FROM users WHERE tenant_id=$1 AND user_id=$2 AND disabled=false', [TENANT, id])
  if (!user.rows[0]) throw new Error('BOP_DEMO_EXISTING_USER_REQUIRED')
  const access = await q(`SELECT DISTINCT ur.role_code,rp.permission_code FROM user_roles ur
    JOIN rbac_roles r ON r.tenant_id=$1 AND r.role_code=ur.role_code AND r.active=true
    JOIN rbac_role_permissions rp ON rp.tenant_id=r.tenant_id AND rp.role_code=r.role_code
    WHERE ur.user_id=$2`, [TENANT, id])
  if (!permissions.every(permission => access.rows.some((row: Row) => row.permission_code === permission))) throw new Error('BOP_DEMO_OPERATOR_NOT_AUTHORIZED')
  return { id, username: user.rows[0].username, roles: [...new Set<string>(access.rows.map((row: Row) => row.role_code))], permissions: [...new Set<string>(access.rows.map((row: Row) => row.permission_code))] }
}

export function businessownersDemoValidationRules(effectiveDate: string): ValidationRuleInput[] {
  const base = { levels: ['screen', 'rate', 'bind', 'issue'], transactionTypes: ['new_business', 'endorsement', 'renewal', 'rewrite'],
    productCode: PRODUCT, stateCode: 'OH', severity: 'error', effectiveDate, active: true } as const
  const rules: ValidationRuleInput[] = []
  const required = (code: string, fieldPath: string, screen: 'product' | 'insureds' | 'risk') => rules.push({ ...base,
    levels: [...base.levels], transactionTypes: [...base.transactionTypes], ruleCode: `BOP_DEMO_${code}`, name: `Demo: ${code}`, kind: 'required', fieldPath, screen, message: `Demo BOP requires ${fieldPath}.` })
  required('COMPANY', 'underwritingCompanyId', 'product')
  required('AGENCY', 'agency.agencyId', 'product')
  required('PRODUCER', 'producer.producerId', 'product')
  required('CUSTOMER', 'insureds.primary.customerId', 'insureds')
  for (const field of ['businessName', 'businessClass', 'occupancy', 'buildingInterest', 'annualRevenue', 'annualPayroll', 'employeeCount', 'yearsInBusiness',
    'priorLossCount', 'priorLossAmount', 'construction', 'yearBuilt', 'roofAgeYears', 'squareFeet', 'protectionClass', 'sprinklers', 'fireAlarm',
    'burglarAlarm', 'vacancyDays', 'hazardousOperations', 'locationAddress.line1', 'locationAddress.city', 'locationAddress.state', 'locationAddress.postalCode', 'locationAddress.country']) {
    required(field.replace(/[^a-z0-9]/gi, '_').toUpperCase(), `risks[0].${field}`, 'risk')
  }
  const condition = (code: string, expression: string, screen: 'risk' | 'coverages') => rules.push({ ...base,
    levels: [...base.levels], transactionTypes: [...base.transactionTypes], ruleCode: `BOP_DEMO_${code}`, name: `Demo: ${code}`, kind: 'condition', condition: expression, screen, message: `Demo BOP check: ${code}.` })
  condition('SINGLE_PREMISES', 'count(risks) == 1', 'risk')
  condition('CLASS', 'risk.businessClass == "office" || risk.businessClass == "retail" || risk.businessClass == "service"', 'risk')
  condition('SALES', 'risk.annualRevenue >= 0 && risk.annualRevenue <= 5000000', 'risk')
  condition('EMPLOYEES', 'risk.employeeCount >= 0 && risk.employeeCount <= 50', 'risk')
  condition('OH_PREMISES', 'risk.locationAddress.state == "OH" && risk.locationAddress.country == "US"', 'risk')
  for (const code of ['BOP_BPP', 'BOP_BI_EE', 'BOP_LIAB', 'BOP_MED']) condition(code, `coverages.${code}.selected == true`, 'coverages')
  condition('BUILDING_INTEREST', 'coverages.BOP_BUILDING.selected != true || risk.buildingInterest == true', 'coverages')
  condition('OWNED_BUILDING', 'risk.occupancy != "owner" || (risk.buildingInterest == true && coverages.BOP_BUILDING.selected == true)', 'coverages')
  return rules
}

export const BUSINESSOWNERS_DEMO_UW_RULES = [
  ['VACANCY', 'vacancyDays', 'greater_than', 30, 'Decline'],
  ['HAZARD', 'hazardousOperations', 'is_true', true, 'Decline'],
  ['LOSS', 'priorLossCount', 'greater_than', 0, 'Refer'],
  ['ROOF', 'roofAgeYears', 'greater_than', 20, 'Refer'],
  ['PROTECTION', 'protectionClass', 'greater_than_or_equal', 9, 'Refer'],
] as const

async function seedValidationRules(date: string, actor: string) {
  const existing = await listValidationRules(TENANT)
  for (const rule of businessownersDemoValidationRules(date)) {
    const found = existing.find((item: { ruleCode: string }) => item.ruleCode === rule.ruleCode)
    if (found) requireMatch(found, rule, rule.ruleCode)
    else await createValidationRule(TENANT, actor, rule)
  }
}

async function seedDependencies(q: Q, options: BusinessownersDemoOptions, actor: string) {
  const date = options.effectiveDate
  const company = await ensureRow(q, 'underwriting_companies', { name: COMPANY, product_code: PRODUCT, country_code: 'US', state_code: 'OH' }, { active: true })
  const eligibility = await ensureRow(q, 'product_state_eligibility', { product_code: PRODUCT, state_code: 'OH' }, {
    status: 'ACTIVE', admitted: false, surplus_lines: false, effective_date: date, expiration_date: null,
    notes: `${BUSINESSOWNERS_DEMO_KEY}: synthetic demo only; no admission, filing or surplus-lines representation`,
  })
  const common = { status: 'ACTIVE', metadata: { ...marker('distribution'), agentUserId: options.agentUserId, effectiveDate: date }, created_by: actor }
  const agency = await ensureRow(q, 'agencies', { agency_key: 'BOP-DEMO-AGENCY-V1' }, {
    ...common, legal_name: AGENCY, agency_code: 'BOPDEMO', agency_type: 'INDEPENDENT', effective_from: date, effective_to: null,
  })
  const producer = await ensureRow(q, 'producers', { producer_key: 'BOP-DEMO-PRODUCER-V1' }, { ...common, first_name: 'Demo', last_name: 'Business Producer' })
  const agencyId = agency.row.agency_id as string
  const producerId = producer.row.producer_id as string
  await ensureRow(q, 'agency_producer_affiliations', { agency_id: agencyId, producer_id: producerId, affiliation_role: 'PRODUCER' }, {
    effective_from: date, effective_to: null, metadata: marker('affiliation'), created_by: actor,
  })
  for (const [entity_type, entity_id] of [['AGENCY', agencyId], ['PRODUCER', producerId]]) await ensureRow(q, 'onboarding_appointments', {
    entity_type, entity_id, carrier_code: TENANT, state: 'OH', product_code: PRODUCT,
  }, { appointment_status: 'ACTIVE', appointment_effective_date: date, termination_date: null, metadata: marker(`appointment-${entity_type}`), created_by: actor })
  await ensureRow(q, 'onboarding_external_identifiers', { source_system: 'latticepolicy-user', external_id: options.agentUserId }, {
    entity_type: 'PRODUCER', entity_id: producerId, id_type: 'USER_ID', active_flag: true, metadata: marker('existing-user'), created_by: actor,
  })
  const grant = await ensureRow(q, 'underwriting_authority_grants', { subject_type: 'USER', subject_id: options.agentUserId, product_code: PRODUCT, state_code: 'OH' }, {
    transaction_types: ['NewBusiness'], max_premium: 10000, max_limit: 5000000, may_override: false, active: true, effective_date: date, expiration_date: null, created_by: actor,
  })
  if (grant.created) await q(`INSERT INTO underwriting_authority_audit (tenant_id,grant_id,action,actor,before_value,after_value)
    VALUES($1,$2,'CREATED',$3,NULL,$4::jsonb)`, [TENANT, grant.row.grant_id, actor, JSON.stringify(grant.row)])
  for (const [code, field, operator, comparison, outcome] of BUSINESSOWNERS_DEMO_UW_RULES) await ensureRow(q, 'underwriting_rules', { reason_code: `BOP_DEMO_${code}` }, {
    product_code: PRODUCT, state_code: 'OH', field_path: `risks[0].${field}`, operator, comparison_value: comparison, outcome,
    reason_description: `Synthetic BOP appetite: ${code.toLowerCase()} requires ${outcome.toLowerCase()}.`, active: true, effective_date: date, expiration_date: null, created_by: actor, updated_by: actor,
  })
  if (agency.created || producer.created || company.created || eligibility.created) await q(`INSERT INTO onboarding_audit_events
    (tenant_id,entity_type,entity_id,event_type,actor,reason,after_json) VALUES($1,'AGENCY',$2,'DEMO_DEPENDENCIES_CREATED',$3,$4,$5::jsonb)`,
  [TENANT, agencyId, actor, 'Explicit opt-in synthetic demo setup; no regulatory verification or human approval', JSON.stringify({ companyId: company.row.company_id, agencyId, producerId, ...marker('dependencies') })])
  return { companyId: String(company.row.company_id), agencyId, producerId }
}

function customerFixture(kind: 'owner' | 'tenant') {
  return normalizeCustomerInput({ entityType: 'COMPANY', status: 'ACTIVE',
    identity: { company: { legalName: kind === 'owner' ? 'Demo Buckeye Retail LLC' : 'Demo Buckeye Office LLC', incorporationState: 'OH', incorporationCountry: 'US' } },
    contactPoints: [{ contactType: 'EMAIL', value: `bop-${kind}@example.invalid`, preferred: true }],
    addresses: [{ addressType: 'BUSINESS', line1: kind === 'owner' ? '100 Synthetic Retail Way' : '200 Synthetic Office Way', line2: kind === 'tenant' ? 'Suite 2' : '', city: 'Columbus', state: 'OH', postalCode: '43215', country: 'US', primary: true }],
    metadata: marker(`customer-${kind}`),
  })
}

async function seedCustomer(q: Q, kind: 'owner' | 'tenant', actor: string) {
  const fixture = customerFixture(kind)
  const found = await q(`SELECT customer_id FROM customers WHERE tenant_id=$1 AND metadata->>'demoSetup'=$2 AND metadata->>'demoKey'=$3`, [TENANT, BUSINESSOWNERS_DEMO_KEY, `customer-${kind}`])
  if (found.rows.length > 1) throw new Error(`BOP_DEMO_CONFLICT:customer-${kind}`)
  if (found.rows[0]) {
    const existing = await loadCustomerRecordById(q, TENANT, found.rows[0].customer_id, true)
    requireMatch(normalizeCustomerInput(existing), fixture, `customer-${kind}`)
    return existing
  }
  // Never interpret a duplicate customer as permission to merge or overwrite it.
  const created = await createCustomerRecord(q, { tenantId: TENANT, payload: fixture, actor, reason: 'Explicit synthetic BOP demo setup', createAnyway: false })
  if (!created.customer) throw new Error(`BOP_DEMO_CUSTOMER_DUPLICATE:customer-${kind}`)
  return created.customer
}

export function businessownersDemoPayload(kind: 'owner' | 'tenant', effectiveDate: string, ids: { companyId: string; agencyId: string; producerId: string }, customer: Row): Row {
  const source = customerFixture(kind)
  const a = source.addresses[0]
  const postal = { line1: a.line1, line2: a.line2, city: a.city, state: a.state, postalCode: a.postalCode, country: a.country }
  const address = { street: a.line1, line2: a.line2, city: a.city, state: a.state, zip: a.postalCode, country: a.country }
  return { productCode: PRODUCT, country: 'US', state: 'OH', effectiveDate, termMonths: 12,
    underwritingCompanyId: ids.companyId, underwritingCompanyName: COMPANY,
    agency: { agencyId: ids.agencyId, agencyName: AGENCY }, producer: { producerId: ids.producerId },
    applicant: { firstName: 'Demo', lastName: kind === 'owner' ? 'Retail' : 'Office', email: `bop-${kind}@example.invalid` },
    insureds: { primary: { customerId: customer.customerId, customerKey: customer.customerKey, firstName: 'Demo', lastName: kind === 'owner' ? 'Retail' : 'Office',
      displayName: source.identity.company.legalName, email: `bop-${kind}@example.invalid`, phone: '', address, addresses: source.addresses }, secondary: {}, additional: [] },
    mailingAddress: address,
    risks: [{ type: 'businessownersLocation', businessName: source.identity.company.legalName, businessClass: kind === 'owner' ? 'retail' : 'office', occupancy: kind,
      buildingInterest: kind === 'owner', annualRevenue: 750000, annualPayroll: 200000, employeeCount: 5, yearsInBusiness: 8, priorLossCount: 0, priorLossAmount: 0,
      construction: 'masonry', yearBuilt: 2010, roofAgeYears: 5, squareFeet: 2500, protectionClass: 3, sprinklers: true, fireAlarm: true, burglarAlarm: true,
      vacancyDays: 0, hazardousOperations: false, locationAddress: postal }],
    coverages: [
      ...(kind === 'owner' ? [{ code: 'BOP_BUILDING', selected: true, limit: 500000, deductible: 1000 }] : []),
      { code: 'BOP_BPP', selected: true, limit: 100000, deductible: 1000 }, { code: 'BOP_BI_EE', selected: true, limit: 100000 },
      { code: 'BOP_LIAB', selected: true, limit: 1000000 }, { code: 'BOP_MED', selected: true, limit: 5000 },
    ], metadata: marker(`quote-${kind}`),
  }
}

async function seedDraft(q: Q, key: string, payload: Row, actor: string): Promise<string> {
  const hash = createHash('sha256').update(stable(payload)).digest('hex')
  const desired = { ...payload, metadata: { ...marker(key), demoInputHash: hash } }
  const found = await q(`SELECT quote_id,payload FROM quotes WHERE tenant_id=$1 AND payload->'metadata'->>'demoSetup'=$2 AND payload->'metadata'->>'demoKey'=$3`, [TENANT, BUSINESSOWNERS_DEMO_KEY, key])
  if (found.rows.length > 1) throw new Error(`BOP_DEMO_CONFLICT:${key}`)
  if (found.rows[0]) {
    requireMatch(found.rows[0].payload, desired, key)
    return String(found.rows[0].quote_id)
  }
  return (await insertDraftQuote(q, TENANT, { payload: desired, progressStep: 4 }, actor)).quoteId
}

function blocker(error: unknown): string {
  const code = (error as any)?.code
  // Do not print arbitrary database errors or payloads through the demo CLI.
  return typeof code === 'string' && /^[A-Z0-9_:-]+$/.test(code) ? code : 'BOP_DEMO_DOMAIN_FLOW_BLOCKED'
}

export async function seedBusinessownersDemo(options: BusinessownersDemoOptions): Promise<BusinessownersDemoResult> {
  assertBusinessownersDemoOptIn(options)
  const pool = getDb()
  if (!pool) throw new Error('BOP_DEMO_DATABASE_REQUIRED')
  const lock = await pool.connect()
  let locked = false
  try {
    // A session lock spans domain services' own committed tenant transactions.
    // Releasing it never changes application data or drops policy history.
    await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [`${TENANT}:${BUSINESSOWNERS_DEMO_KEY}`])
    locked = true
    const users = await withTenantTx(TENANT, async db => {
      const q = toRawQuery(db)
      if (!(await q('SELECT 1 FROM tenants WHERE tenant_id=$1', [TENANT])).rows.length) throw new Error('BOP_DEMO_EXISTING_TENANT_REQUIRED')
      const operator = await existingUser(q, options.operatorUserId, ['admin.customers.manage', 'admin.onboarding.manage', 'admin.underwriting_rules.manage', 'admin.validation_rules.manage', 'uw.authority.manage'])
      const agent = await existingUser(q, options.agentUserId, ['page.wizard.view', ...(options.issueExample ? ['page.policy.view'] : [])])
      if (!agent.roles.some(role => ['agent', 'admin', 'underwriter'].includes(role))) throw new Error('BOP_DEMO_AGENT_NOT_AUTHORIZED')
      return { operator, agent }
    })
    const actor = `automation:${BUSINESSOWNERS_DEMO_KEY}:${users.operator.id}`
    await seedValidationRules(options.effectiveDate, actor)
    const prepared = await withTenantTx(TENANT, async db => {
      const q = toRawQuery(db)
      const ids = await seedDependencies(q, options, actor)
      const owner = await seedCustomer(q, 'owner', actor)
      const tenant = await seedCustomer(q, 'tenant', actor)
      const quotes: Record<string, string> = {}
      for (const [kind, customer] of [['owner', owner], ['tenant', tenant]] as const) quotes[kind] = await seedDraft(q, `quote-${kind}`, businessownersDemoPayload(kind, options.effectiveDate, ids, customer), actor)
      if (options.issueExample) quotes.issue = await seedDraft(q, 'quote-issued-example', businessownersDemoPayload('owner', options.effectiveDate, ids, owner), actor)
      await seedProductDocumentTemplates(q, TENANT, actor, { carrierCode: 'BOP-DEMO', authority: 'DEMO-NON-CONTRACT', editionDate: '2026-10-01', productCodes: [PRODUCT] })
      return { ...ids, customers: { owner: owner.customerId, tenant: tenant.customerId }, quotes }
    })
    const result: BusinessownersDemoResult = { tenantId: TENANT, ...prepared, policyId: null, blockers: [] }
    if (!options.issueExample) return result
    try {
      let quote = await withTenantTx(TENANT, async db => (await toRawQuery(db)('SELECT payload,status,converted_policy_id FROM quotes WHERE tenant_id=$1 AND quote_id=$2', [TENANT, prepared.quotes.issue])).rows[0])
      let policyId: string | null = quote.converted_policy_id || null
      if (!policyId) {
        // Invoke the same configurable rate gate as the HTTP route. Never pass
        // acknowledgements, override reasons or human referral approvals.
        await withTenantTx(TENANT, db => runValidationGate(db, TENANT, { level: 'rate', transaction: 'new_business', payload: quote.payload, actor }))
        await createOrRateQuote({} as DrizzleDB, TENANT, quote.payload, prepared.quotes.issue, actor, { actorId: users.agent.id } as Parameters<typeof createOrRateQuote>[5])
        const bound = await bindQuote({} as DrizzleDB, TENANT, prepared.quotes.issue, {}, actor, users.agent.id, users.agent)
        policyId = bound.policyId
      }
      result.policyId = policyId
      await withTenantTx(TENANT, async db => {
        const q = toRawQuery(db)
        // A rerun after a completed issue has nothing left to do.
        const current = await q('SELECT status FROM policies WHERE tenant_id=$1 AND policy_id=$2', [TENANT, policyId])
        if (current.rows[0]?.status === 'Issued') return
        await runPolicyValidationGate(db, TENANT, policyId!, { level: 'issue', transaction: 'new_business', actor })
        await issuePolicy(db, TENANT, policyId!, {}, { ...users.agent, username: actor })
      })
    } catch (error) { result.blockers.push({ stage: 'rate-bind-issue', code: blocker(error) }) }
    return result
  } finally {
    try { if (locked) await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`${TENANT}:${BUSINESSOWNERS_DEMO_KEY}`]); lock.release() }
    catch { lock.release(true) }
  }
}
