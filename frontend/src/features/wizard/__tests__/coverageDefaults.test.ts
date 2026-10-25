import { describe, expect, it } from 'vitest'
import { buildGenericCoverageDefaults, hasDeclaredCoverageDefaults } from '../coverageUtils'

describe('generic coverage defaults', () => {
  it('preselects automatically only for packs that declare required or default coverages', () => {
    expect(hasDeclaredCoverageDefaults({ coverages: [{ code: 'A', limits: [100] }, { code: 'B' }] })).toBe(false)
    expect(hasDeclaredCoverageDefaults({ coverages: [{ code: 'A', required: true }, { code: 'B', optional: true }] })).toBe(true)
  })

  it('selects the declared package, or every coverage when the user asks for defaults on an undeclared pack', () => {
    expect(buildGenericCoverageDefaults({ coverages: [{ code: 'A', required: true, limits: [100] }, { code: 'B', optional: true }] }).map(c => c.code)).toEqual(['A'])
    expect(buildGenericCoverageDefaults({ coverages: [{ code: 'A', limits: [100] }, { code: 'B' }] }).map(c => c.code)).toEqual(['A', 'B'])
  })
})
