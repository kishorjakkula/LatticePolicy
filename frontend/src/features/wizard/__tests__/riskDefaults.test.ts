import { describe, expect, it } from 'vitest'
import { defaultAutoRisk, defaultCyberRisk, validatePersonalAutoVehicles } from '../riskDefaults'

describe('quote wizard risk capability contract', () => {
  it('provides product-specific risk shapes', () => {
    expect(defaultAutoRisk()).toMatchObject({ type: 'autoVehicle', annualMiles: 12000 })
    expect(defaultCyberRisk()).toMatchObject({ type: 'cyberProfile', mfaEnabled: 'true' })
  })
  it('reports field-addressable personal auto validation errors', () => {
    expect(validatePersonalAutoVehicles([])).toEqual({ 'risks.0.vehicle': 'Add at least one vehicle' })
    expect(validatePersonalAutoVehicles([{ ...defaultAutoRisk(), vin: 'short' }])).toMatchObject({ 'risks.0.vin': 'VIN must be 17 characters' })
  })
})
