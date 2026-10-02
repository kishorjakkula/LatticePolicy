import { describe, expect, it } from 'vitest'
import {
  getProductCapabilities,
  listProductCapabilities,
  mapProductRiskKind,
  requireProductCapability,
} from '../product-registry.js'
import { rate } from '../../services/rating.service.js'

describe('product capability registry', () => {
  it('discovers product packs from the products directory', () => {
    const products = listProductCapabilities()
    expect(products.map((product) => product.code)).toEqual(expect.arrayContaining([
      'personal-auto',
      'commercial-auto',
      'homeowners',
      'cyber',
      'professional-liability',
      'example-identity-protection',
    ]))
    expect(getProductCapabilities('example-identity-protection')).toMatchObject({
      label: 'Identity Protection Example',
      defaultRisk: { type: 'identityProfile' },
      supportedTransactions: ['quote'],
    })
  })

  it('uses pack metadata for risk persistence mapping', () => {
    expect(mapProductRiskKind('personal-auto', { type: 'autoVehicle' })).toBe('PA.Vehicle')
    expect(mapProductRiskKind('example-identity-protection', { type: 'identityProfile' })).toBe('ID.Profile')
  })

  it('reports unsupported product capabilities explicitly', () => {
    expect(() => requireProductCapability('example-identity-protection', 'bind')).toThrowError(
      expect.objectContaining({ code: 'PRODUCT_CAPABILITY_UNSUPPORTED' }),
    )
    expect(() => rate('sample-carrier', {
      productCode: 'example-identity-protection',
      risks: [{ type: 'identityProfile', monitoringLimit: 10000 }],
    })).toThrowError(expect.objectContaining({ code: 'PRODUCT_RATING_ADAPTER_UNSUPPORTED' }))
  })
})
