import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  mapAcordSubmissionToQuoteIntake,
  mapGrlcSubmissionToInternal,
  mapPolicyToAcordCanonical,
} from '../policy.mapper.js'

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8'))
}

describe('mapAcordSubmissionToQuoteIntake', () => {
  it('maps a valid ACORD personal-lines submission to internal quote intake', () => {
    const payload = loadFixture('acord-personal-submission.inbound.json')
    const result = mapAcordSubmissionToQuoteIntake(payload)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.productCode).toBe('auto')
    expect(result.data.effectiveDate).toBe('2026-09-01')
    expect(result.data.termMonths).toBe(6)
    expect(result.data.state).toBe('TX')
    expect(result.data.insuredParty.fullName).toBe('Jordan Rivera')
    expect(result.data.insuredParty.address?.stateCode).toBe('TX')
    expect(result.data.insuredParty.email).toBe('jordan.rivera@example.com')
  })

  it('returns structured errors for a payload missing required fields', () => {
    const payload = loadFixture('acord-personal-submission.invalid.json')
    const result = mapAcordSubmissionToQuoteIntake(payload)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.data).toBeNull()
    const fields = result.errors.map((e) => e.field)
    expect(fields).toContain('LOBCd')
    expect(fields).toContain('InsuredOrPrincipal')
    expect(result.errors.every((e) => e.code && e.message)).toBe(true)
  })

  it('rejects a non-object payload', () => {
    const result = mapAcordSubmissionToQuoteIntake('not an object')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0].field).toBe('$')
  })
})

describe('mapPolicyToAcordCanonical', () => {
  it('maps an internal policy row to an ACORD-style canonical policy payload', () => {
    const canonical = mapPolicyToAcordCanonical({
      policyNumber: 'POL-000123',
      productCode: 'auto',
      status: 'Active',
      termEffectiveDate: '2026-09-01',
      termExpirationDate: '2027-03-01',
      currencyCode: 'USD',
      jurisdictionCode: 'TX',
      insuredParty: {
        name: 'Jordan Rivera',
        address: { line1: '410 Oak Street', city: 'Austin', stateCode: 'TX', postalCode: '78701' },
        email: 'jordan.rivera@example.com',
      },
    })

    expect(canonical.policyNumber).toBe('POL-000123')
    expect(canonical.statusCode).toBe('Active')
    expect(canonical.insuredParty.fullName).toBe('Jordan Rivera')
    expect(canonical.insuredParty.roleCode).toBe('Insured')
    expect(canonical.insuredParty.addresses[0]?.stateCode).toBe('TX')
    expect(canonical.insuredParty.contacts.find((c) => c.contactType === 'Email')?.value).toBe(
      'jordan.rivera@example.com'
    )
  })

  it('defaults currency to USD when the internal row has none', () => {
    const canonical = mapPolicyToAcordCanonical({
      policyNumber: null,
      productCode: 'homeowners',
      status: 'Quote',
      termEffectiveDate: '2026-09-01',
      termExpirationDate: '2027-09-01',
      currencyCode: null,
      jurisdictionCode: null,
      insuredParty: { name: 'Test Insured' },
    })
    expect(canonical.currencyCode).toBe('USD')
    expect(canonical.policyNumber).toBeUndefined()
  })
})

describe('mapGrlcSubmissionToInternal', () => {
  it('marks the result as a large commercial placement', () => {
    const payload = {
      LOBCd: 'commercial-property',
      'ContractTerm.EffectiveDt': '2026-06-01',
      InsuredOrPrincipal: { GeneralPartyInfo: { NameInfo: { 'CommlName.CommercialName': 'Acme Holdings LLC' } } },
    }
    const result = mapGrlcSubmissionToInternal(payload)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.isLargeCommercialPlacement).toBe(true)
    expect(result.data.insuredParty.fullName).toBe('Acme Holdings LLC')
  })

  it('returns structured errors when the effective date is missing', () => {
    const result = mapGrlcSubmissionToInternal({ LOBCd: 'commercial-property' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.field === 'ContractTerm.EffectiveDt')).toBe(true)
  })
})
