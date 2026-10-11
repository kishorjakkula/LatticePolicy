import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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


it('keeps installed products serviceable after sales are disabled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-product-'))
  const original = process.env.CARRIER_PACK_DIR
  try {
    fs.writeFileSync(path.join(dir, 'pack.yaml'), 'packFormat: 1\ncarrier: sample-carrier\nversion: 1.0.0\n')
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'enabledProducts: [personal-auto]\n')
    process.env.CARRIER_PACK_DIR = dir
    expect(listProductCapabilities().map((product) => product.code)).not.toContain('homeowners')
    for (const action of ['issue', 'endorse', 'cancel', 'reinstate', 'nonRenew'] as const) {
      expect(requireProductCapability('homeowners', action).code).toBe('homeowners')
    }
    for (const action of ['quote', 'bind', 'renew', 'rewrite'] as const) {
      expect(() => requireProductCapability('homeowners', action)).toThrow()
    }
    // Legacy policies without a snapshot still need their installed rater.
    expect(rate('sample-carrier', { productCode: 'homeowners', risks: [{ construction: 'frame' }], coverages: [{ code: 'A', limit: 150000 }] }).total.amount).toBeGreaterThan(0)
  } finally {
    if (original === undefined) delete process.env.CARRIER_PACK_DIR
    else process.env.CARRIER_PACK_DIR = original
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
