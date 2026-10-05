import { describe, expect, it } from 'vitest'
import { loadProductConfig, loadProductRates } from './products.js'

describe('personal-auto product pack fixtures', () => {
  it('provides usable coverage metadata', () => {
    const config = loadProductConfig('personal-auto')

    expect(config.product, 'coverage.yaml must declare the personal-auto product').toBe('personal-auto')
    expect(config.version, 'coverage.yaml must declare a version').toMatch(/^\d+\.\d+\.\d+$/)
    expect(config.coverages, 'coverage.yaml must provide at least one coverage').toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: expect.any(String), name: expect.any(String), selectable: true }),
      ]),
    )
    expect(config.ratingKeys, 'coverage.yaml must provide rating keys').toContain('garagingZip')
  })

  it('provides usable rating metadata', () => {
    const pack = loadProductRates('personal-auto')

    expect(pack.product, 'rates.yaml must load the requested product').toBe('personal-auto')
    expect(pack.version, 'rates.yaml must declare a version').toMatch(/^\d+\.\d+\.\d+$/)
    expect(pack.rates.base?.termMonths?.[6], 'rates.yaml must include a six-month term factor').toBeTypeOf('number')
    expect(pack.rates.territoryFactors?.default, 'rates.yaml must include a default territory factor').toBeTypeOf('number')
    expect(pack.rates.fees?.policy, 'rates.yaml must include a policy fee').toBeTypeOf('number')
  })
})
