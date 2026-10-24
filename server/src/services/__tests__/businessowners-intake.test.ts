import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildQuotePayload } from '../submission-intake.service.js'
import { buildTargetFields } from '../../lib/intake/target-fields.js'
import { loadProductConfig } from '../../products.js'
import { applyProductPackage, productPackageViolations } from '../../lib/product-package.js'
import { validateQuoteDetailed } from '../../contracts.js'
import { rate } from '../rating.service.js'

const fixtures = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../examples/intake-samples/product-demo/fixtures.json'), 'utf8'))

function intakePayload() {
  const values = { ...fixtures.common, ...fixtures.products.businessowners, productCode: 'businessowners' }
  const fields = buildTargetFields('businessowners').map(field => ({ ...field, value: values[field.key] || '', status: 'accepted' }))
  return buildQuotePayload({ submissionId: 'synthetic-submission', submissionNumber: 'DEMO-BOP-001' }, fields as any, null, { approvedBy: 'synthetic-reviewer', approvedAt: '2026-10-23T00:00:00Z' })
}

describe('businessowners submission draft mapping', () => {
  it('preserves structured premises and booleans separately from insured contact data', () => {
    const payload = intakePayload()
    expect(payload.risks[0]).toMatchObject({ type: 'businessownersLocation', buildingInterest: false, hazardousOperations: false, priorLossCount: 0, locationAddress: { line1: '100 Synthetic Demo Lane', line2: 'Suite 200', city: 'Columbus', state: 'OH', postalCode: '43215-0001', country: 'US' } })
    expect(payload.insureds.primary.email).toBe('intake-demo@example.com')
    expect(payload.risks[0].locationAddress).not.toHaveProperty('email')
    expect(validateQuoteDetailed(payload)).toEqual({ valid: true, errors: [] })
    expect(productPackageViolations(payload, loadProductConfig('businessowners'))).toEqual([])
  })
  it('maps all required coverages including fixed income/medical limits before rating', () => {
    const payload = intakePayload()
    applyProductPackage(payload, loadProductConfig('businessowners'))
    expect(payload.coverages.map(coverage => coverage.code)).toEqual(['BOP_BPP', 'BOP_BI_EE', 'BOP_LIAB', 'BOP_MED'])
    const premium = rate('sample-carrier', payload)
    expect(premium.total.amount).toBe(800)
    expect(premium.byCoverage.find(coverage => coverage.code === 'BOP_MED')?.amount.amount).toBe(0)
    expect(payload.coverages.find(coverage => coverage.code === 'BOP_LIAB')).toMatchObject({ packageTerms: { generalAggregate: 2000000 } })
  })
  it('rejects missing facts and a malformed address, rather than defaulting them safe', () => {
    const payload = intakePayload()
    delete payload.risks[0].hazardousOperations
    payload.risks[0].locationAddress = 'not a structured address'
    const paths = productPackageViolations(payload, loadProductConfig('businessowners')).map(error => error.path)
    expect(paths).toContain('/risks/0/hazardousOperations')
    expect(paths).toContain('/risks/0/locationAddress')
  })
  it.each([
    ['employeeCount', -1], ['employeeCount', 51], ['employeeCount', 1.5],
    ['annualRevenue', 5000001], ['annualRevenue', true], ['annualPayroll', -1],
    ['priorLossCount', 'not a number'], ['construction', 'unknown'],
    ['hazardousOperations', 'false'], ['protectionClass', 11], ['squareFeet', 0],
  ])('rejects invalid configured risk field %s=%s', (key, value) => {
    const payload = intakePayload()
    payload.risks[0][key] = value
    expect(productPackageViolations(payload, loadProductConfig('businessowners')).some(error => error.path === `/risks/0/${key}`)).toBe(true)
  })
  it('preserves ZIP+4 and rejects a mismatched rating state', () => {
    const payload = intakePayload()
    expect(payload.risks[0].locationAddress).toMatchObject({ postalCode: '43215-0001' })
    ;(payload.risks[0].locationAddress as any).state = 'TX'
    expect(productPackageViolations(payload, loadProductConfig('businessowners')).some(error => error.path === '/risks/0/locationAddress')).toBe(true)
  })
  it('never traverses prototype keys from a forged extraction field', () => {
    const fields: any[] = [
      { key: 'productCode', value: 'businessowners' },
      { key: 'risk.__proto__.polluted', value: 'true' },
      { key: 'risk.constructor.prototype.polluted', value: 'true' },
    ]
    const payload = buildQuotePayload({ submissionId: 'synthetic', submissionNumber: 'DEMO' }, fields, null, null)
    expect(payload.risks[0]).toEqual({ type: 'businessownersLocation' })
    expect(({} as any).polluted).toBeUndefined()
  })
})
