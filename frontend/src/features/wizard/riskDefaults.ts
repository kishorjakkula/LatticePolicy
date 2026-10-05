export function validatePersonalAutoVehicles(risks: any): Record<string, string> {
  const errors: Record<string, string> = {}
  const vehicles = Array.isArray(risks) ? risks : []
  if (!vehicles.length) return { 'risks.0.vehicle': 'Add at least one vehicle' }
  vehicles.forEach((risk: any, index: number) => {
    const required = [
      ['make', risk?.make, 'Make is required'], ['model', risk?.model, 'Model is required'],
      ['bodyStyle', risk?.bodyStyle, 'Body style is required'], ['garagingZip', risk?.garagingZip, 'Garaging ZIP is required'],
      ['registrationState', risk?.registrationState, 'Registration state is required'], ['usage', risk?.usage, 'Usage is required'],
      ['ownershipType', risk?.ownershipType, 'Ownership is required'], ['principalDriver', risk?.principalDriver, 'Principal driver is required'],
    ]
    for (const [key, value, message] of required) if (!String(value || '').trim()) errors[`risks.${index}.${key}`] = message
    const year = Number(risk?.year)
    if (!Number.isFinite(year) || year < 1900 || year > new Date().getFullYear() + 1) errors[`risks.${index}.year`] = 'Enter a valid vehicle year'
    if (!Number.isFinite(Number(risk?.annualMiles)) || Number(risk?.annualMiles) <= 0) errors[`risks.${index}.annualMiles`] = 'Enter annual miles'
    if (!Number.isFinite(Number(risk?.driverAge)) || Number(risk?.driverAge) < 16 || Number(risk?.driverAge) > 100) errors[`risks.${index}.driverAge`] = 'Enter a valid driver age'
    const vin = String(risk?.vin || '').trim()
    if (!vin) errors[`risks.${index}.vin`] = 'VIN is required'
    else if (vin.length !== 17) errors[`risks.${index}.vin`] = 'VIN must be 17 characters'
    const zip = String(risk?.garagingZip || '').trim()
    if (zip && !/^\d{5}$/.test(zip)) errors[`risks.${index}.garagingZip`] = 'Enter a 5-digit ZIP'
    const state = String(risk?.registrationState || '').trim()
    if (state && state.length !== 2) errors[`risks.${index}.registrationState`] = 'Use a 2-letter state code'
    if (risk?.usage === 'commute' && (!Number.isFinite(Number(risk?.commuteMiles)) || Number(risk?.commuteMiles) <= 0)) {
      errors[`risks.${index}.commuteMiles`] = 'Enter commute miles'
    }
  })
  return errors
}

export function defaultAutoRisk() {
  return { type: 'autoVehicle', year: 2018, make: 'Toyota', model: 'Camry', trim: 'LE', bodyStyle: 'sedan', vin: '', garagingZip: '10001', registrationState: 'NY', usage: 'commute', annualMiles: 12000, commuteMiles: 12, driverAge: 30, principalDriver: 'Named insured', ownershipType: 'owned', purchaseDate: '', antiTheft: 'passive-alarm', rideshareUse: 'no', existingDamage: 'no' }
}

export const defaultDwellingRisk = () => ({ type: 'dwelling', address: '1 Main St', construction: 'frame', yearBuilt: 2000, roofAgeYears: 10, squareFeet: 1800 })
export const defaultCyberRisk = () => ({ type: 'cyberProfile', industry: 'technology', annualRevenue: 1000000, employeeCount: 50, recordsCount: 50000, mfaEnabled: 'true', endpointProtection: 'true', backups: 'daily', priorIncidents: 0, publicFacingApps: 2, domain: 'example.com' })
export const defaultCommercialAutoRisk = () => ({ type: 'commercialAutoFleet', businessName: 'Acme Services LLC', garagingZip: '10001', vehicleCount: 3, driverCount: 4, useClass: 'artisan-contractor', radiusClass: 'local', vehicleType: 'service-van', gvwClass: 'light', annualMileage: 18000, yearsInBusiness: 5, priorLossesCount: 0 })
export const defaultProfessionalLiabilityRisk = () => ({ type: 'professionalLiabilityProfile', industry: 'consulting', annualRevenue: 1000000, employeeCount: 10, yearsInBusiness: 5, priorClaimsCount: 0, largestContractValue: 150000, subcontractorPct: 10, writtenContracts: 'true', qualityControl: 'standard', retroactiveYears: 3 })
