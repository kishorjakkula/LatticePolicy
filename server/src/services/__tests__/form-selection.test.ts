import { describe, expect, it } from 'vitest'
import { formJurisdictionDecision, formTransactionMatches } from '../form-selection.js'

describe('form transaction scope', () => {
  it.each([
    // generation passes NB at bind and Issue at issue
    [['Bind'], 'NB', true],
    [['Bind'], 'Issue', false],
    [['Issue'], 'NB', false],
    [['Issue'], 'Issue', true],
    [['Bind', 'Issue'], 'NB', true],
    // a generic new-business scope attaches at every new-business stage
    [['NB'], 'NB', true],
    [['new_business'], 'Issue', true],
    [['NewBusiness'], 'Quote', true],
    [['NB'], 'Endorse', false],
    // preview vocabulary
    [['Bind'], 'Bind', true],
    [['Quote', 'Issue'], 'Bind', false],
    [['Endorsement'], 'Endorse', true],
    [['Endorse'], 'Endorsement', true],
    [['Cancel', 'NonRenewal', 'Reinstate', 'Renew', 'Rewrite'], 'Renewal', true],
    [['cancellation'], 'Cancel', true],
    [['NonRenewal'], 'non-renewal', true],
    // empty scope applies everywhere; unknown names never widen it
    [[], 'Issue', true],
    [['  '], 'Issue', true],
    [['mystery'], 'NB', false],
    [['Bind'], 'Audit', false],
  ] as const)('%j applies to %s: %s', (configured, transaction, expected) => {
    expect(formTransactionMatches(configured, transaction)).toBe(expected)
  })
})

describe('form jurisdiction gate', () => {
  const row = (state: string, status: string, effective = '2026-01-01', sunset: string | null = null) =>
    ({ state_code: state, regulatory_status: status, effective_date: effective, sunset_date: sunset })

  it('blocks a form that requires approval when only another state is approved', () => {
    expect(formJurisdictionDecision([row('NY', 'Approved')], 'CA', '2026-11-01', true).attach).toBe(false)
  })

  it('blocks a form that requires approval when its approval has expired', () => {
    expect(formJurisdictionDecision([row('CA', 'Approved', '2025-01-01', '2026-06-30')], 'CA', '2026-11-01', true).attach).toBe(false)
  })

  it('blocks a form whose approval starts after the effective date', () => {
    expect(formJurisdictionDecision([row('CA', 'Approved', '2027-01-01')], 'CA', '2026-11-01', true).attach).toBe(false)
  })

  it.each(['Approved', 'Filed'])('allows a %s state row', (status) => {
    const decision = formJurisdictionDecision([row('CA', status)], 'CA', '2026-11-01', true)
    expect(decision).toMatchObject({ attach: true, jurisdiction: { state_code: 'CA' } })
  })

  it.each(['Pending', 'Withdrawn'])('blocks a %s state row even when approval is not required', (status) => {
    expect(formJurisdictionDecision([row('CA', status)], 'CA', '2026-11-01', false).attach).toBe(false)
  })

  it('lets a state-specific row override an ALL row', () => {
    expect(formJurisdictionDecision([row('ALL', 'Approved'), row('CA', 'Withdrawn')], 'CA', '2026-11-01', true).attach).toBe(false)
    expect(formJurisdictionDecision([row('ALL', 'Approved')], 'CA', '2026-11-01', true).attach).toBe(true)
  })

  it('attaches with no row in force only when approval is not required', () => {
    expect(formJurisdictionDecision([], 'CA', '2026-11-01', false).attach).toBe(true)
    expect(formJurisdictionDecision(null, 'CA', '2026-11-01', true).attach).toBe(false)
    expect(formJurisdictionDecision([row('NY', 'Approved')], 'CA', '2026-11-01', false).attach).toBe(true)
  })

  it('accepts database Date values for effective and sunset dates', () => {
    const dated = { state_code: 'CA', regulatory_status: 'Approved', effective_date: new Date('2026-01-01T00:00:00Z'), sunset_date: new Date('2026-12-31T00:00:00Z') }
    expect(formJurisdictionDecision([dated], 'CA', '2026-11-01', true).attach).toBe(true)
    expect(formJurisdictionDecision([dated], 'CA', '2027-01-15', true).attach).toBe(false)
  })
})
