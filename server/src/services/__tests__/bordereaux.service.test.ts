import { describe, expect, it } from 'vitest'
import { assertValidBordereauType, toCsv, validateBordereauRow, type BordereauExportRow } from '../bordereaux.service.js'

describe('assertValidBordereauType', () => {
  it('accepts every documented bordereau type', () => {
    for (const type of ['RISK', 'PREMIUM', 'TRANSACTION', 'CANCELLATION', 'CORRECTION', 'CLAIMS_REFERENCE_HANDOFF']) {
      expect(() => assertValidBordereauType(type)).not.toThrow()
    }
  })

  it('rejects an unknown type', () => {
    expect(() => assertValidBordereauType('NOT_A_TYPE')).toThrow()
  })
})

describe('validateBordereauRow', () => {
  it('requires policyId and policyNumber for every bordereau type', () => {
    const result = validateBordereauRow('RISK', { policyId: null, transactionId: null, policyNumber: null, data: {} })
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('policyId is required')
    expect(result.errors).toContain('policyNumber is required')
  })

  it('requires riskUnitId, riskKind, and effectiveDate for a RISK row', () => {
    const result = validateBordereauRow('RISK', {
      policyId: 'p1',
      transactionId: null,
      policyNumber: 'POL-1',
      data: {}
    })
    expect(result.isValid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining(['riskUnitId is required', 'riskKind is required', 'effectiveDate is required']))
  })

  it('passes a well-formed RISK row', () => {
    const result = validateBordereauRow('RISK', {
      policyId: 'p1',
      transactionId: null,
      policyNumber: 'POL-1',
      data: { riskUnitId: 'r1', riskKind: 'Vehicle', effectiveDate: '2026-01-01' }
    })
    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('requires transactionId and premiumTotal for a PREMIUM row', () => {
    const result = validateBordereauRow('PREMIUM', {
      policyId: 'p1',
      transactionId: null,
      policyNumber: 'POL-1',
      data: { transactionType: 'NB', effectiveDate: '2026-01-01' }
    })
    expect(result.isValid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining(['transactionId is required', 'premiumTotal is required']))
  })

  it('requires cancellationReasonCode for a CANCELLATION row', () => {
    const result = validateBordereauRow('CANCELLATION', {
      policyId: 'p1',
      transactionId: 't1',
      policyNumber: 'POL-1',
      data: { transactionType: 'Cancel', effectiveDate: '2026-01-01' }
    })
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('cancellationReasonCode is required for a cancellation bordereau row')
  })

  it('does not require premiumTotal for a CLAIMS_REFERENCE_HANDOFF row', () => {
    const result = validateBordereauRow('CLAIMS_REFERENCE_HANDOFF', {
      policyId: 'p1',
      transactionId: 't1',
      policyNumber: 'POL-1',
      data: { transactionType: 'Cancel', effectiveDate: '2026-01-01', claimReference: 'CLM-123' }
    })
    expect(result.isValid).toBe(true)
  })

  it('requires claimReference for a CLAIMS_REFERENCE_HANDOFF row', () => {
    const result = validateBordereauRow('CLAIMS_REFERENCE_HANDOFF', {
      policyId: 'p1',
      transactionId: 't1',
      policyNumber: 'POL-1',
      data: { transactionType: 'Cancel', effectiveDate: '2026-01-01' }
    })
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('claimReference is required for a claims-reference-handoff bordereau row')
  })
})

describe('toCsv', () => {
  const rows: BordereauExportRow[] = [
    { rowNumber: 1, policyNumber: 'POL-1', isValid: true, validationErrors: [], data: { premiumTotal: 1000, transactionType: 'NB' } },
    {
      rowNumber: 2,
      policyNumber: 'POL-2',
      isValid: false,
      validationErrors: ['premiumTotal is required'],
      data: { premiumTotal: null, transactionType: 'NB' }
    }
  ]

  it('produces a header row unioning all data keys', () => {
    const csv = toCsv(rows)
    const [header] = csv.split('\n')
    expect(header).toContain('rowNumber')
    expect(header).toContain('policyNumber')
    expect(header).toContain('isValid')
    expect(header).toContain('validationErrors')
    expect(header).toContain('premiumTotal')
    expect(header).toContain('transactionType')
  })

  it('escapes values containing commas and quotes, and joins validation errors', () => {
    const csv = toCsv([
      {
        rowNumber: 1,
        policyNumber: 'POL,1',
        isValid: false,
        validationErrors: ['error, with comma', 'second error'],
        data: { note: 'has "quotes"' }
      }
    ])
    const lines = csv.split('\n')
    expect(lines[0]).toContain('note')
    expect(lines[1]).toContain('"POL,1"')
    expect(lines[1]).toContain('error, with comma; second error')
    expect(lines[1]).toContain('"has ""quotes"""')
  })

  it('produces one data line per row', () => {
    const csv = toCsv(rows)
    expect(csv.split('\n')).toHaveLength(3)
  })
})
