import { describe, expect, it, vi } from 'vitest'
import { assertBusinessownersAuthorization, BUSINESSOWNERS_USER_SOURCE } from '../businessowners-authorization.service.js'

const actorId = '11111111-1111-4111-8111-111111111111'
const companyId = '22222222-2222-4222-8222-222222222222'
const agencyId = '33333333-3333-4333-8333-333333333333'
const producerId = '44444444-4444-4444-8444-444444444444'
const tenant = 'synthetic-bop'
const payload = () => ({ productCode: 'businessowners', state: 'OH', effectiveDate: '2026-10-23',
  underwritingCompanyId: companyId, agency: { agencyId }, producer: { producerId } })

function queries(patch: Record<string, any[]> = {}) {
  const records: Record<string, any[]> = {
    users: [{ user_id: actorId }], user_roles: [{ role_code: 'agent', permission_code: 'page.wizard.view' }],
    product_state_eligibility: [{ eligibility_id: 'eligible' }], underwriting_companies: [{ company_id: companyId }],
    agencies: [{ agency_id: agencyId }], producers: [{ producer_id: producerId }],
    agency_producer_affiliations: [{ affiliation_id: 'affiliated' }],
    onboarding_appointments: [{ entity_type: 'AGENCY' }, { entity_type: 'PRODUCER' }],
    onboarding_external_identifiers: [{ external_identifier_id: 'identity' }], ...patch,
  }
  return vi.fn(async (sql: string, params: any[] = []) => {
    expect(params[0]).toBe(tenant)
    expect(sql).toMatch(/FOR (SHARE|UPDATE)/)
    const table = sql.match(/FROM (\w+)/)?.[1] || ''
    expect(records).toHaveProperty(table)
    return { rows: records[table], rowCount: records[table].length }
  })
}

describe('BOP dependency authorization', () => {
  it('does not query or change authorization for any existing product', async () => {
    const q = vi.fn()
    for (const productCode of ['personal-auto', 'homeowners', 'commercial-auto', 'cyber', 'professional-liability']) {
      await assertBusinessownersAuthorization(q, tenant, { productCode })
    }
    expect(q).not.toHaveBeenCalled()
  })

  it('accepts active appointed distribution with a current user mapping and locks every dependency', async () => {
    const q = queries()
    await expect(assertBusinessownersAuthorization(q, tenant, payload(), actorId)).resolves.toBeUndefined()
    expect(q).toHaveBeenCalledTimes(10)
    expect(q.mock.calls[q.mock.calls.length - 1]?.[1]).toEqual([tenant, producerId, BUSINESSOWNERS_USER_SOURCE, actorId])
    expect(q.mock.calls.map(call => call[0]).join('\n')).toContain("rp.permission_code='page.wizard.view'")
  })

  it.each(['BUSINESSOWNERS', ' businessowners '])('does not bypass authorization for registry-normalized product %s', async productCode => {
    await expect(assertBusinessownersAuthorization(queries({ onboarding_appointments: [] }), tenant, { ...payload(), productCode }, actorId))
      .rejects.toMatchObject({ code: 'BOP_APPOINTMENT_REQUIRED' })
  })

  it.each([undefined, '', 'agent1', 'not-a-uuid'])('rejects missing or audit-only actor %s', async actor => {
    const q = queries()
    await expect(assertBusinessownersAuthorization(q, tenant, payload(), actor)).rejects.toMatchObject({ code: 'BOP_ACTOR_NOT_AUTHORIZED' })
    expect(q).not.toHaveBeenCalled()
  })

  it.each(['', 'CA', 'oh'])('fails closed on state %s', async state => {
    await expect(assertBusinessownersAuthorization(queries(), tenant, { ...payload(), state }, actorId))
      .rejects.toMatchObject({ code: 'STATE_NOT_ELIGIBLE' })
  })
  it.each([{ country: 'CA' }, { countryCode: 'CA' }, { jurisdiction: { code: 'CA' } }])('rejects contradictory jurisdiction %j', async patch => {
    await expect(assertBusinessownersAuthorization(queries(), tenant, { ...payload(), ...patch }, actorId))
      .rejects.toMatchObject({ code: 'STATE_NOT_ELIGIBLE' })
  })
  it.each([undefined, '', '2026-02-30', '2026-10-23T00:00:00Z', 'not-a-date'])('rejects missing or invalid effective date %s', async effectiveDate => {
    await expect(assertBusinessownersAuthorization(queries(), tenant, { ...payload(), effectiveDate }, actorId))
      .rejects.toMatchObject({ code: 'BOP_EFFECTIVE_DATE_REQUIRED' })
  })
  it.each([undefined, 'company-name', ''])('requires company UUID %s', async underwritingCompanyId => {
    await expect(assertBusinessownersAuthorization(queries(), tenant, { ...payload(), underwritingCompanyId }, actorId))
      .rejects.toMatchObject({ code: 'BOP_COMPANY_NOT_ELIGIBLE' })
  })
  it('rejects missing distribution and conflicting ID aliases', async () => {
    for (const patch of [{ agency: undefined }, { producer: undefined }, { producerId: actorId }, { agencyId: actorId }, { producer: { producerId, agencyId: actorId } }]) {
      await expect(assertBusinessownersAuthorization(queries(), tenant, { ...payload(), ...patch }, actorId))
        .rejects.toMatchObject({ code: 'BOP_DISTRIBUTION_REQUIRED' })
    }
    await expect(assertBusinessownersAuthorization(queries(), tenant,
      { ...payload(), agency: undefined, producer: undefined, agencyId, producerId }, actorId)).resolves.toBeUndefined()
  })
  it.each([
    ['users', 'BOP_ACTOR_NOT_AUTHORIZED'], ['user_roles', 'BOP_ACTOR_NOT_AUTHORIZED'],
    ['product_state_eligibility', 'STATE_NOT_ELIGIBLE'], ['underwriting_companies', 'BOP_COMPANY_NOT_ELIGIBLE'],
    ['agencies', 'BOP_DISTRIBUTION_NOT_AUTHORIZED'], ['producers', 'BOP_DISTRIBUTION_NOT_AUTHORIZED'],
    ['agency_producer_affiliations', 'BOP_DISTRIBUTION_NOT_AUTHORIZED'],
    ['onboarding_appointments', 'BOP_APPOINTMENT_REQUIRED'], ['onboarding_external_identifiers', 'BOP_PRODUCER_IDENTITY_REQUIRED'],
  ])('rejects missing/inactive/nonmatching %s records', async (table, code) => {
    await expect(assertBusinessownersAuthorization(queries({ [table]: [] }), tenant, payload(), actorId))
      .rejects.toMatchObject({ code })
  })
  it.each(['AGENCY', 'PRODUCER'])('requires both appointments, not just %s', async entity_type => {
    await expect(assertBusinessownersAuthorization(queries({ onboarding_appointments: [{ entity_type }] }), tenant, payload(), actorId))
      .rejects.toMatchObject({ code: 'BOP_APPOINTMENT_REQUIRED' })
  })
  it.each(['admin', 'underwriter'])('allows current %s to service appointed distribution without impersonating a producer', async role_code => {
    const q = queries({ user_roles: [{ role_code }], onboarding_external_identifiers: [] })
    await expect(assertBusinessownersAuthorization(q, tenant, payload(), actorId)).resolves.toBeUndefined()
    expect(q).toHaveBeenCalledTimes(9)
  })
  it.each(['customer', 'llm_release_automation'])('denies mixed %s + admin identities', async role_code => {
    await expect(assertBusinessownersAuthorization(queries({ user_roles: [{ role_code: 'admin' }, { role_code }] }), tenant, payload(), actorId))
      .rejects.toMatchObject({ code: 'BOP_ACTOR_NOT_AUTHORIZED' })
  })
  it.each(['customer', 'carrier_technical_admin', 'actuary'])('does not grant wizard access based on unrelated role %s', async role_code => {
    await expect(assertBusinessownersAuthorization(queries({ user_roles: [{ role_code }] }), tenant, payload(), actorId))
      .rejects.toMatchObject({ code: 'BOP_ACTOR_NOT_AUTHORIZED' })
  })
  it.each(['42P01', '42703', 'ECONNRESET'])('never falls back when dependencies fail (%s)', async code => {
    const q = vi.fn().mockRejectedValue(Object.assign(new Error('private DB detail'), { code }))
    await expect(assertBusinessownersAuthorization(q, tenant, payload(), actorId)).rejects.toMatchObject({
      code: 'BOP_DEPENDENCIES_UNAVAILABLE', statusCode: 503,
      message: 'Businessowners authorization dependencies are unavailable; no quote or bind is permitted.',
    })
  })
  it('does not swallow a missing eligibility table after successful current-user authorization', async () => {
    const base = queries()
    const q = async (sql: string, params?: any[]) => {
      if (sql.includes('FROM product_state_eligibility')) throw Object.assign(new Error('missing eligibility table'), { code: '42P01' })
      return base(sql, params)
    }
    await expect(assertBusinessownersAuthorization(q, tenant, payload(), actorId))
      .rejects.toMatchObject({ code: 'BOP_DEPENDENCIES_UNAVAILABLE', statusCode: 503 })
  })
})
