import { loadTenantOverrides } from '../products.js'

export type UWDecision = { decision: 'Eligible'|'Refer'|'Decline'; reasons: string[] }

export function evaluateUW(tenantId: string, payload: any): UWDecision {
  const reasons: string[] = []
  let decision: 'Eligible'|'Refer'|'Decline' = 'Eligible'
  const product = payload?.productCode as string

  if (product === 'personal-auto') {
    const age = Number(payload?.uwAnswers?.driverAge ?? payload?.risks?.[0]?.driverAge)
    if (!Number.isNaN(age)) {
      if (age < 16) { reasons.push('Driver age under 16 (decline)'); decision = 'Decline' }
      else if (age < 18) { reasons.push('Driver age under 18 (refer)'); decision = maxDecision(decision, 'Refer') }
    }
    const zip = payload?.risks?.[0]?.garagingZip
    if (!zip || String(zip).length !== 5) { reasons.push('Invalid garaging ZIP (refer)'); decision = maxDecision(decision, 'Refer') }
    const annualMiles = Number(payload?.risks?.[0]?.annualMiles)
    if (!Number.isNaN(annualMiles) && annualMiles > 35000) { reasons.push('Annual miles > 35k (refer)'); decision = maxDecision(decision, 'Refer') }
    const usage = (payload?.risks?.[0]?.usage || '').toString().toLowerCase()
    if (usage === 'rideshare' || usage === 'commercial') { reasons.push('Commercial/rideshare use (refer)'); decision = maxDecision(decision, 'Refer') }
    const symbol = (payload?.risks?.[0]?.symbol || '').toString().toUpperCase()
    if (symbol.includes('EXOTIC') || symbol.includes('PERF') || symbol.includes('SUPER')) { reasons.push('High-performance symbol (refer)'); decision = maxDecision(decision, 'Refer') }
  }

  if (product === 'commercial-auto') {
    const risk = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
    const vehicleCount = Number(risk?.vehicleCount)
    const driverCount = Number(risk?.driverCount)
    const annualMileage = Number(risk?.annualMileage)
    const yearsInBusiness = Number(risk?.yearsInBusiness)
    const priorLossesCount = Number(risk?.priorLossesCount)
    const radiusClass = String(risk?.radiusClass || '').toLowerCase()
    const vehicleType = String(risk?.vehicleType || '').toLowerCase()
    const gvwClass = String(risk?.gvwClass || '').toLowerCase()
    const garagingZip = String(risk?.garagingZip || '')

    if (!/^\d{5}$/.test(garagingZip)) {
      reasons.push('Invalid primary garaging ZIP (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(vehicleCount) && vehicleCount > 150) {
      reasons.push('Fleet size > 150 vehicles (decline)')
      decision = 'Decline'
    } else if (!Number.isNaN(vehicleCount) && vehicleCount > 50) {
      reasons.push('Fleet size > 50 vehicles (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(driverCount) && !Number.isNaN(vehicleCount) && vehicleCount > 0) {
      const ratio = driverCount / vehicleCount
      if (ratio > 4) {
        reasons.push('High driver-to-vehicle ratio (refer)')
        decision = maxDecision(decision, 'Refer')
      }
    }
    if (radiusClass === 'long-haul') {
      reasons.push('Long-haul operations (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (vehicleType === 'tractor-trailer') {
      reasons.push('Tractor-trailer exposure requires underwriting review (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (vehicleType === 'dump-truck' || gvwClass === 'heavy') {
      reasons.push('Heavy commercial vehicle exposure (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(annualMileage) && annualMileage > 100000) {
      reasons.push('Average annual mileage > 100,000 (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(priorLossesCount) && priorLossesCount >= 6) {
      reasons.push('6+ prior commercial auto losses (decline)')
      decision = 'Decline'
    } else if (!Number.isNaN(priorLossesCount) && priorLossesCount >= 3) {
      reasons.push('Multiple prior commercial auto losses (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(yearsInBusiness) && yearsInBusiness < 1) {
      reasons.push('New venture < 1 year in business (refer)')
      decision = maxDecision(decision, 'Refer')
    }
  }

  if (product === 'homeowners') {
    const roofAge = Number(payload?.risks?.[0]?.roofAgeYears)
    if (!Number.isNaN(roofAge) && roofAge > 30) { reasons.push('Roof age > 30 (decline)'); decision = 'Decline' }
    else if (!Number.isNaN(roofAge) && roofAge >= 20) { reasons.push('Roof age 20-30 (refer)'); decision = maxDecision(decision, 'Refer') }
    const pc = Number(payload?.risks?.[0]?.protectionClass)
    if (!Number.isNaN(pc) && pc >= 9) { reasons.push('Protection class 9-10 (decline)'); decision = 'Decline' }
    else if (!Number.isNaN(pc) && pc >= 7) { reasons.push('Protection class 7-8 (refer)'); decision = maxDecision(decision, 'Refer') }
  }

  if (product === 'cyber') {
    const risk = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
    const annualRevenue = Number(risk?.annualRevenue)
    const employeeCount = Number(risk?.employeeCount)
    const recordsCount = Number(risk?.recordsCount)
    const priorIncidents = Number(risk?.priorIncidents)
    const mfaEnabled = String(risk?.mfaEnabled || '').toLowerCase()
    const backups = String(risk?.backups || '').toLowerCase()

    if (!Number.isNaN(priorIncidents) && priorIncidents >= 3) {
      reasons.push('3+ prior cyber incidents (decline)')
      decision = 'Decline'
    } else if (!Number.isNaN(priorIncidents) && priorIncidents > 0) {
      reasons.push('Prior cyber incident history (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (mfaEnabled !== 'true' && mfaEnabled !== 'yes' && mfaEnabled !== '1') {
      reasons.push('MFA not fully enabled (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (backups === 'none') {
      reasons.push('No backup controls declared (decline)')
      decision = 'Decline'
    } else if (backups === 'monthly') {
      reasons.push('Infrequent backup controls (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(annualRevenue) && annualRevenue > 100000000) {
      reasons.push('Large revenue profile > $100M (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(employeeCount) && employeeCount > 5000) {
      reasons.push('Large workforce > 5,000 (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(recordsCount) && recordsCount > 5000000) {
      reasons.push('Very high sensitive records count (refer)')
      decision = maxDecision(decision, 'Refer')
    }
  }

  if (product === 'professional-liability') {
    const risk = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
    const priorClaimsCount = Number(risk?.priorClaimsCount)
    const yearsInBusiness = Number(risk?.yearsInBusiness)
    const annualRevenue = Number(risk?.annualRevenue)
    const subcontractorPct = Number(risk?.subcontractorPct)
    const writtenContracts = String(risk?.writtenContracts || '').toLowerCase()
    const qualityControl = String(risk?.qualityControl || '').toLowerCase()
    const retroactiveYears = Number(risk?.retroactiveYears)
    const largestContractValue = Number(risk?.largestContractValue)

    if (!Number.isNaN(priorClaimsCount) && priorClaimsCount >= 4) {
      reasons.push('4+ prior professional liability claims (decline)')
      decision = 'Decline'
    } else if (!Number.isNaN(priorClaimsCount) && priorClaimsCount >= 2) {
      reasons.push('Multiple prior professional liability claims (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(yearsInBusiness) && yearsInBusiness < 1) {
      reasons.push('Startup or new venture with less than 1 year operations (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(annualRevenue) && annualRevenue > 50000000) {
      reasons.push('Revenue profile > $50M (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(subcontractorPct) && subcontractorPct > 75) {
      reasons.push('Subcontracted work exceeds 75% of revenue (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (writtenContracts !== 'true' && writtenContracts !== 'yes' && writtenContracts !== '1') {
      reasons.push('Written engagement contracts not consistently used (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (qualityControl === 'limited') {
      reasons.push('Limited QA / peer review controls (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(retroactiveYears) && retroactiveYears < 1) {
      reasons.push('No prior acts / retroactive coverage history (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(largestContractValue) && !Number.isNaN(annualRevenue) && annualRevenue > 0) {
      const concentrationPct = (largestContractValue / annualRevenue) * 100
      if (concentrationPct > 40) {
        reasons.push('High single-client / contract concentration (refer)')
        decision = maxDecision(decision, 'Refer')
      }
    }
  }

  // Tenant overrides: simple known rule id (e.g., HO-ROOF-AGE refer if roofAgeYears > 25)
  try {
    const tenantCfg = loadTenantOverrides(tenantId)
    const rules = tenantCfg?.overrides?.underwriting?.rules || []
    for (const r of rules) {
      if (r?.id === 'HO-ROOF-AGE' && product === 'homeowners') {
        const roofAge = Number(payload?.risks?.[0]?.roofAgeYears)
        if (!Number.isNaN(roofAge) && roofAge > 25) {
          reasons.push('Roof age > 25 (refer)')
          decision = maxDecision(decision, 'Refer')
        }
      }
    }
  } catch {}

  return { decision, reasons }
}

function maxDecision(cur: 'Eligible'|'Refer'|'Decline', next: 'Eligible'|'Refer'|'Decline'): 'Eligible'|'Refer'|'Decline' {
  const rank = { 'Eligible': 0, 'Refer': 1, 'Decline': 2 }
  return (rank[next] > rank[cur]) ? next : cur
}
