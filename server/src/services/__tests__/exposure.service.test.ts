import { describe, expect, it } from 'vitest'
import { extractExposureDimensions, exposureRowsToCsv, type ExposureRow } from '../exposure.service.js'

describe('extractExposureDimensions', () => {
  it('extracts garaging ZIP and vehicle count for personal-auto', () => {
    const payload = {
      state: 'tx',
      risks: [
        { type: 'autoVehicle', garagingZip: '75201', year: 2020, make: 'Honda', model: 'Civic' },
        { type: 'autoVehicle', garagingZip: '75201', year: 2018, make: 'Toyota', model: 'Camry' },
        { type: 'driver', firstName: 'Jane' },
      ],
      coverages: [{ code: 'BI', selected: true, limit: 100000 }, { code: 'PD', selected: true, limit: 50000 }],
    }
    const dims = extractExposureDimensions('personal-auto', payload)
    expect(dims.state).toBe('TX')
    expect(dims.zip).toBe('75201')
    expect(dims.vehicleFleetCount).toBe(2)
    expect(dims.tiv).toBe(150000)
  })

  it('extracts fleet vehicle count and use class for commercial-auto', () => {
    const payload = {
      state: 'CA',
      risks: [{ type: 'commercialAutoFleet', garagingZip: '90001', vehicleCount: 12, useClass: 'Delivery' }],
      coverages: [],
    }
    const dims = extractExposureDimensions('commercial-auto', payload)
    expect(dims.zip).toBe('90001')
    expect(dims.vehicleFleetCount).toBe(12)
    expect(dims.classOrIndustry).toBe('Delivery')
    expect(dims.tiv).toBeNull()
  })

  it('extracts a best-effort ZIP from a dwelling address string', () => {
    const payload = {
      state: 'FL',
      risks: [{ type: 'dwelling', address: '123 Main St, Miami, FL 33101', construction: 'frame', yearBuilt: 1998 }],
      coverages: [{ code: 'DwellingA', selected: true, limit: 350000 }],
    }
    const dims = extractExposureDimensions('homeowners', payload)
    expect(dims.zip).toBe('33101')
    expect(dims.tiv).toBe(350000)
  })

  it('sums cyber revenue and records across risk entries', () => {
    const payload = {
      state: 'NY',
      risks: [
        { type: 'cyberProfile', annualRevenue: 2000000, recordsCount: 50000 },
        { type: 'firstParty', annualRevenue: 500000 },
      ],
      coverages: [],
    }
    const dims = extractExposureDimensions('cyber', payload)
    expect(dims.cyberAnnualRevenue).toBe(2500000)
    expect(dims.cyberRecordsCount).toBe(50000)
  })

  it('extracts industry class for professional-liability', () => {
    const payload = {
      state: 'IL',
      risks: [{ type: 'professionalLiabilityProfile', industry: 'Accounting', annualRevenue: 900000 }],
      coverages: [],
    }
    const dims = extractExposureDimensions('professional-liability', payload)
    expect(dims.classOrIndustry).toBe('Accounting')
  })

  it('ignores unselected coverages when summing TIV', () => {
    const payload = {
      risks: [],
      coverages: [
        { code: 'A', selected: true, limit: 100 },
        { code: 'B', selected: false, limit: 999999 },
      ],
    }
    const dims = extractExposureDimensions('homeowners', payload)
    expect(dims.tiv).toBe(100)
  })

  it('returns null dimensions gracefully for an empty payload', () => {
    const dims = extractExposureDimensions('homeowners', {})
    expect(dims.state).toBeNull()
    expect(dims.zip).toBeNull()
    expect(dims.tiv).toBeNull()
    expect(dims.vehicleFleetCount).toBeNull()
  })
})

describe('exposureRowsToCsv', () => {
  it('produces a header row and escapes embedded commas', () => {
    const rows: ExposureRow[] = [
      {
        policyId: 'p1',
        policyNumber: 'PA-1',
        productCode: 'personal-auto',
        state: 'TX',
        zip: '75201',
        classOrIndustry: null,
        vehicleFleetCount: 2,
        cyberAnnualRevenue: null,
        cyberRecordsCount: null,
        tiv: 150000,
        effectiveDate: '2026-01-01',
        expirationDate: '2027-01-01',
      },
    ]
    const csv = exposureRowsToCsv(rows)
    const lines = csv.split('\n')
    expect(lines[0]).toContain('policyId')
    expect(lines[1]).toContain('p1')
    expect(lines[1]).toContain('150000')
  })
})
