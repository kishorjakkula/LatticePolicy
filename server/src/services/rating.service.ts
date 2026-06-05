import { mergeRates, loadProductRates, loadTenantOverrides, Rates } from '../products.js'
import { getPublishedRatingModelForProduct } from '../ratingModelRegistry.js'
import { round2 } from '../lib/date.utils.js'

export type QuoteInput = any

export type PremiumResult = {
  byCoverage: any[]
  fees: { amount: number; currency: string }
  taxes: { amount: number; currency: string }
  total: { amount: number; currency: string }
  calcTrace?: any
}

export function rate(tenantId: string, payload: QuoteInput): PremiumResult {
  const product = payload?.productCode as 'personal-auto' | 'commercial-auto' | 'homeowners' | 'cyber' | 'professional-liability'
  if (!product) throw new Error('productCode is required')
  const pack = loadProductRates(product)
  const tenant = loadTenantOverrides(tenantId)
  const rates = mergeRates(pack.rates, tenant)

  if (product === 'personal-auto') {
    return rateAuto(payload, rates, tenantId)
  }
  if (product === 'commercial-auto') {
    return rateCommercialAuto(payload, rates)
  }
  if (product === 'cyber') {
    return rateCyber(payload, rates)
  }
  if (product === 'professional-liability') {
    return rateProfessionalLiability(payload, rates)
  }
  return rateHO(payload, rates)
}

function rateAuto(payload: any, rates: Rates, tenantId?: string) {
  const publishedModel = tenantId
    ? getPublishedRatingModelForProduct(tenantId, 'personal-auto', payload?.state)
    : null
  const workbookRated = publishedModel ? rateAutoWithPublishedModel(payload, rates, publishedModel) : null
  if (workbookRated) return workbookRated

  let base = 500
  const zip = payload?.risks?.[0]?.garagingZip
  const terr = rates.territoryFactors?.byZip?.[zip] ?? rates.territoryFactors?.default ?? 1
  base *= terr
  const age = payload?.uwAnswers?.driverAge
  if (typeof age === 'number') {
    const ageFactor = pickAgeFactor(age, rates.driverAgeFactors)
    base *= ageFactor
  }
  const symbol = String(payload?.risks?.[0]?.symbol || '').toUpperCase()
  const symbolFactor = rates.vehicleSymbolFactors?.[symbol] ?? 1
  base *= symbolFactor
  const selectedCoverages = getSelectedCoverages(payload?.coverages)
  const autoBreakdown = rateAutoCoverages(base, selectedCoverages)
  const fees = rates.fees?.policy ?? 25
  const taxesRate = rates.taxes?.rate ?? 0.03
  const taxes = round2(autoBreakdown.coverageSubtotal * taxesRate)
  const total = round2(autoBreakdown.coverageSubtotal + fees + taxes)
  return breakdown(total, fees, taxes, autoBreakdown.byCoverage)
}

function rateAutoWithPublishedModel(payload: any, rates: Rates, model: any) {
  const workbookJson = model?.workbookJson
  const tables = workbookJson?.tables
  if (!tables || typeof tables !== 'object') return null

  const baseLossRows = asTableRows(tables.baseLossCosts)
  if (!baseLossRows.length) return null

  const selectedCoverages = getSelectedCoverages(payload?.coverages)
  const coverages = selectedCoverages.length ? selectedCoverages : [{ code: 'BI' }, { code: 'PD' }, { code: 'COMP' }, { code: 'COLL' }]
  const stateCode = String(payload?.state || model?.stateCode || '').trim().toUpperCase()
  const risk = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
  const termMonths = Number(payload?.termMonths || 12)
  const termFactor = Number.isFinite(termMonths) && termMonths > 0 ? clamp(termMonths / 12, 0.25, 3) : 1

  const territoryRows = asTableRows(tables.territoryRelativities)
  const driverRows = asTableRows(tables.driverRelativities)
  const vehicleRows = asTableRows(tables.vehicleRelativities)
  const usageRows = asTableRows(tables.usageRelativities)
  const limDedRows = asTableRows(tables.limitDeductibleRelativities)
  const discountRows = asTableRows(tables.discountRelativities)
  const lcmRows = asTableRows(tables.lcmExpenseProfit)
  const assumptionsRows = asTableRows(tables.assumptions)

  const territoryCode = resolveTerritoryCode(payload, risk, baseLossRows)
  const liabilitySymbol = String(risk?.liabilitySymbol || risk?.symbol || risk?.vehicleSymbol || '').trim()
  const compCollSymbol = String(risk?.compCollSymbol || risk?.compCollVehicleSymbol || risk?.symbol || '').trim()
  const usageType = String(risk?.usage || risk?.useType || '').trim()
  const driverAge = toFiniteNumber(payload?.uwAnswers?.driverAge ?? risk?.driverAge)
  const violations = toFiniteNumber(payload?.uwAnswers?.violations ?? risk?.violations ?? 0)

  const territoryRel = findTerritoryRelativity(territoryRows, stateCode, territoryCode)
  const ageRel = findDriverRelativity(driverRows, stateCode, 'Age', driverAge)
  const violationRel = findDriverRelativity(driverRows, stateCode, 'Violations', violations)
  const usageRel = findUsageRelativity(usageRows, stateCode, usageType)
  const liabVehicleRel = findVehicleRelativity(vehicleRows, stateCode, 'Liability', liabilitySymbol)
  const compVehicleRel = findVehicleRelativity(vehicleRows, stateCode, 'Comp/Coll', compCollSymbol)
  const lcm = findLcm(lcmRows, stateCode)
  const discountMultiplier = findDiscountMultiplier(discountRows, stateCode, payload)

  const byCoverage: any[] = []
  const coverageDetails: any[] = []
  let subtotal = 0

  for (const cov of coverages) {
    const covCode = coverageCode(cov)
    const covKey = coverageKey(covCode)
    const baseLoss = findBaseLossCost(baseLossRows, stateCode, covKey, cov)
    if (!(baseLoss > 0)) continue

    const vehicleRel = covKey === 'BI' || covKey === 'PD' ? liabVehicleRel : (covKey === 'COMP' || covKey === 'COLL' ? compVehicleRel : 1)
    const limDedRel = findLimitDedRelativity(limDedRows, stateCode, covKey, cov)
    const rawAmount = baseLoss * territoryRel * ageRel * violationRel * usageRel * vehicleRel * limDedRel * lcm * discountMultiplier * termFactor
    const amount = round2(rawAmount)
    subtotal += amount
    byCoverage.push(makeCoverageEntry(covCode, amount, cov))
    coverageDetails.push({
      code: covCode,
      coverageKey: covKey,
      input: {
        limit: cov?.limit ?? null,
        deductible: cov?.deductible ?? null
      },
      factors: {
        baseLossCost: round2(baseLoss),
        territoryRel,
        ageRel,
        violationRel,
        usageRel,
        vehicleRel,
        limitDeductibleRel: limDedRel,
        lcm,
        discountMultiplier,
        termFactor
      },
      formula: 'baseLossCost * territoryRel * ageRel * violationRel * usageRel * vehicleRel * limitDeductibleRel * lcm * discountMultiplier * termFactor',
      amount
    })
  }

  if (!byCoverage.length) return null

  const fees = resolveWorkbookPolicyFee(assumptionsRows, rates)
  const taxesRate = resolveWorkbookTaxRate(assumptionsRows, rates)
  const taxes = round2(subtotal * taxesRate)
  const total = round2(subtotal + fees + taxes)
  const premium = breakdown(total, fees, taxes, byCoverage)
  ;(premium as any).calcTrace = {
    source: 'published-rating-model',
    modelCode: model.modelCode,
    versionId: model.versionId,
    versionLabel: model.versionLabel,
    stateCode: stateCode || model.stateCode || '',
    factors: {
      territoryCode: territoryCode || '',
      territoryRel,
      ageRel,
      violationRel,
      usageRel,
      liabVehicleRel,
      compVehicleRel,
      lcm,
      discountMultiplier,
      termFactor
    },
    coverageDetails
  }
  return premium
}

function rateHO(payload: any, rates: Rates) {
  let base = 700
  const construction = String(payload?.risks?.[0]?.construction || '').toLowerCase()
  base *= rates.constructionFactors?.[construction] ?? 1
  const protectionClass = payload?.risks?.[0]?.protectionClass
  if (typeof protectionClass === 'number') {
    base *= pickProtectionClassFactor(protectionClass, rates.protectionClassFactors)
  }
  const roofAge = payload?.risks?.[0]?.roofAgeYears
  if (typeof roofAge === 'number') {
    const rf = pickRoofAgeFactor(roofAge, rates.roofAgeFactors)
    base *= rf
  }
  const selectedCoverages = getSelectedCoverages(payload?.coverages)
  const hoBreakdown = rateHOCoverages(base, selectedCoverages)
  const fees = rates.fees?.policy ?? 35
  const taxesRate = rates.taxes?.rate ?? 0.02
  const taxes = round2(hoBreakdown.coverageSubtotal * taxesRate)
  const total = round2(hoBreakdown.coverageSubtotal + fees + taxes)
  return breakdown(total, fees, taxes, hoBreakdown.byCoverage)
}

function rateCyber(payload: any, rates: Rates) {
  const risk = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
  const termMonths = Number(payload?.termMonths || 12)
  const baseDefault = Number(rates.base?.default)
  let base = Number.isFinite(baseDefault) && baseDefault > 0 ? baseDefault : 1800
  const termFactor = Number(rates.base?.termMonths?.[termMonths]) || (termMonths <= 6 ? 0.58 : termMonths >= 24 ? 1.9 : 1)
  base *= termFactor

  const industry = String(risk?.industry || '').trim().toLowerCase()
  base *= pickNamedFactor(industry, rates.industryFactors, 1.05)

  const annualRevenue = parseCoverageLimit(risk?.annualRevenue, 1000000)
  base *= pickRangeFactor(annualRevenue, rates.revenueFactors, 1)

  const employeeCount = parseCoverageLimit(risk?.employeeCount, 10)
  base *= pickRangeFactor(employeeCount, rates.employeeCountFactors, 1)

  const recordsCount = parseCoverageLimit(risk?.recordsCount, 10000)
  base *= pickRangeFactor(recordsCount, rates.recordsCountFactors, 1)

  const mfaEnabled = parseBooleanLike(risk?.mfaEnabled)
  const endpointProtection = parseBooleanLike(risk?.endpointProtection)
  const backups = String(risk?.backups || '').trim().toLowerCase()
  base *= pickNamedFactor(String(mfaEnabled), rates.securityControlFactors?.mfaEnabled, mfaEnabled ? 0.88 : 1.2)
  base *= pickNamedFactor(String(endpointProtection), rates.securityControlFactors?.endpointProtection, endpointProtection ? 0.93 : 1.12)
  base *= pickNamedFactor(backups, rates.securityControlFactors?.backups, 1)

  const priorIncidents = Math.max(0, Math.round(parseCoverageLimit(risk?.priorIncidents, 0)))
  const perIncidentFactor = Number(rates.priorIncidents?.perIncidentFactor)
  const maxIncidentsConsidered = Number(rates.priorIncidents?.maxIncidentsConsidered)
  const incidentsRated = clamp(
    priorIncidents,
    0,
    Number.isFinite(maxIncidentsConsidered) && maxIncidentsConsidered > 0 ? maxIncidentsConsidered : 5
  )
  base *= 1 + incidentsRated * (Number.isFinite(perIncidentFactor) && perIncidentFactor > 0 ? perIncidentFactor : 0.12)

  const publicFacingApps = Math.max(0, Math.round(parseCoverageLimit(risk?.publicFacingApps, 1)))
  const perAppFactor = Number(rates.publicFacingAppsFactor?.perAppFactor)
  const maxAppsConsidered = Number(rates.publicFacingAppsFactor?.maxAppsConsidered)
  const ratedApps = clamp(
    publicFacingApps,
    0,
    Number.isFinite(maxAppsConsidered) && maxAppsConsidered > 0 ? maxAppsConsidered : 50
  )
  base *= 1 + ratedApps * (Number.isFinite(perAppFactor) && perAppFactor > 0 ? perAppFactor : 0.015)

  const selectedCoverages = getSelectedCoverages(payload?.coverages)
  const cyberBreakdown = rateCyberCoverages(base, selectedCoverages)
  const fees = rates.fees?.policy ?? 65
  const taxesRate = rates.taxes?.rate ?? 0.025
  const taxes = round2(cyberBreakdown.coverageSubtotal * taxesRate)
  const total = round2(cyberBreakdown.coverageSubtotal + fees + taxes)
  return breakdown(total, fees, taxes, cyberBreakdown.byCoverage)
}

function rateProfessionalLiability(payload: any, rates: Rates) {
  const risk = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
  const termMonths = Number(payload?.termMonths || 12)
  const baseDefault = Number(rates.base?.default)
  let base = Number.isFinite(baseDefault) && baseDefault > 0 ? baseDefault : 2400
  const termFactor = Number(rates.base?.termMonths?.[termMonths]) || (termMonths <= 6 ? 0.6 : termMonths >= 24 ? 1.92 : 1)
  base *= termFactor

  const stateCode = String(payload?.state || '').trim().toUpperCase()
  const stateFactor = rates.stateFactors?.[stateCode] ?? rates.stateFactors?.[stateCode.toLowerCase()] ?? 1
  base *= Number.isFinite(Number(stateFactor)) ? Number(stateFactor) : 1

  const industry = String(risk?.industry || '').trim().toLowerCase()
  base *= pickNamedFactor(industry, rates.industryFactors, 1.08)

  const annualRevenue = parseCoverageLimit(risk?.annualRevenue, 1000000)
  base *= pickRangeFactor(annualRevenue, rates.revenueFactors, 1)

  const employeeCount = parseCoverageLimit(risk?.employeeCount, 10)
  base *= pickRangeFactor(employeeCount, rates.employeeCountFactors, 1)

  const yearsInBusiness = parseCoverageLimit(risk?.yearsInBusiness, 5)
  base *= pickRangeFactor(yearsInBusiness, rates.yearsInBusinessFactors, 1)

  const largestContractValue = parseCoverageLimit(risk?.largestContractValue, 100000)
  base *= pickRangeFactor(largestContractValue, rates.largestContractValueFactors, 1)

  const subcontractorPctRaw = toFiniteNumber(risk?.subcontractorPct)
  const subcontractorPct = clamp(subcontractorPctRaw != null ? subcontractorPctRaw : 10, 0, 100)
  base *= pickRangeFactor(subcontractorPct, rates.subcontractorPctFactors, 1)

  const writtenContracts = parseBooleanLike(risk?.writtenContracts)
  base *= pickNamedFactor(String(writtenContracts), rates.riskManagementFactors?.writtenContracts, writtenContracts ? 0.92 : 1.12)

  const qualityControl = String(risk?.qualityControl || '').trim().toLowerCase()
  base *= pickNamedFactor(qualityControl, rates.riskManagementFactors?.qualityControl, 1)

  const retroactiveYears = parseCoverageLimit(risk?.retroactiveYears, 3)
  base *= pickRangeFactor(retroactiveYears, rates.riskManagementFactors?.retroactiveYears, 1)

  const priorClaimsRaw = toFiniteNumber(risk?.priorClaimsCount)
  const priorClaimsCount = Math.max(0, Math.round(priorClaimsRaw != null ? priorClaimsRaw : 0))
  const perClaimFactor = Number(rates.priorClaims?.perClaimFactor)
  const maxClaimsConsidered = Number(rates.priorClaims?.maxClaimsConsidered)
  const claimsRated = clamp(
    priorClaimsCount,
    0,
    Number.isFinite(maxClaimsConsidered) && maxClaimsConsidered > 0 ? maxClaimsConsidered : 5
  )
  base *= 1 + claimsRated * (Number.isFinite(perClaimFactor) && perClaimFactor > 0 ? perClaimFactor : 0.16)

  const selectedCoverages = getSelectedCoverages(payload?.coverages)
  const plBreakdown = rateProfessionalLiabilityCoverages(base, selectedCoverages)
  const fees = rates.fees?.policy ?? 85
  const taxesRate = rates.taxes?.rate ?? 0.025
  const taxes = round2(plBreakdown.coverageSubtotal * taxesRate)
  const total = round2(plBreakdown.coverageSubtotal + fees + taxes)
  const premium = breakdown(total, fees, taxes, plBreakdown.byCoverage)
  ;(premium as any).calcTrace = {
    source: 'builtin-professional-liability-rater',
    factors: {
      termMonths,
      termFactor,
      stateCode,
      stateFactor,
      industry,
      annualRevenue,
      employeeCount,
      yearsInBusiness,
      largestContractValue,
      subcontractorPct,
      writtenContracts,
      qualityControl,
      retroactiveYears,
      priorClaimsCount,
      claimsRated
    }
  }
  return premium
}

function rateCommercialAuto(payload: any, rates: Rates) {
  const risk = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
  const termMonths = Number(payload?.termMonths || 12)
  const baseDefault = Number(rates.base?.default)
  let base = Number.isFinite(baseDefault) && baseDefault > 0 ? baseDefault : 4200
  const termFactor = Number(rates.base?.termMonths?.[termMonths]) || (termMonths <= 6 ? 0.58 : termMonths >= 24 ? 1.9 : 1)
  base *= termFactor

  const stateCode = String(payload?.state || '').trim().toUpperCase()
  const stateFactor = rates.stateFactors?.[stateCode] ?? rates.stateFactors?.[stateCode.toLowerCase()] ?? 1
  base *= Number.isFinite(Number(stateFactor)) ? Number(stateFactor) : 1

  const vehicleCountRaw = toFiniteNumber(risk?.vehicleCount)
  const vehicleCount = Math.max(1, Math.round(vehicleCountRaw != null ? vehicleCountRaw : 1))
  base *= pickRangeFactor(vehicleCount, rates.vehicleCountFactors, vehicleCount === 1 ? 0.78 : 1)

  const driverCountRaw = toFiniteNumber(risk?.driverCount)
  const driverCount = Math.max(1, Math.round(driverCountRaw != null ? driverCountRaw : vehicleCount))
  base *= pickRangeFactor(driverCount, rates.driverCountFactors, 1)

  const useClass = String(risk?.useClass || '').trim().toLowerCase()
  base *= pickNamedFactor(useClass, rates.useClassFactors, 1.05)

  const radiusClass = String(risk?.radiusClass || '').trim().toLowerCase()
  base *= pickNamedFactor(radiusClass, rates.radiusClassFactors, 1.08)

  const vehicleType = String(risk?.vehicleType || '').trim().toLowerCase()
  base *= pickNamedFactor(vehicleType, rates.vehicleTypeFactors, 1.08)

  const gvwClass = String(risk?.gvwClass || '').trim().toLowerCase()
  base *= pickNamedFactor(gvwClass, rates.gvwClassFactors, 1.06)

  const annualMileage = parseCoverageLimit(risk?.annualMileage, 20000)
  base *= pickRangeFactor(annualMileage, rates.annualMileageFactors, 1)

  const yearsInBusiness = parseCoverageLimit(risk?.yearsInBusiness, 5)
  base *= pickRangeFactor(yearsInBusiness, rates.yearsInBusinessFactors, 1)

  const priorLossesRaw = toFiniteNumber(risk?.priorLossesCount)
  const priorLossesCount = Math.max(0, Math.round(priorLossesRaw != null ? priorLossesRaw : 0))
  const perLossFactor = Number(rates.priorLosses?.perLossFactor)
  const maxLossesConsidered = Number(rates.priorLosses?.maxLossesConsidered)
  const lossesRated = clamp(
    priorLossesCount,
    0,
    Number.isFinite(maxLossesConsidered) && maxLossesConsidered > 0 ? maxLossesConsidered : 6
  )
  base *= 1 + lossesRated * (Number.isFinite(perLossFactor) && perLossFactor > 0 ? perLossFactor : 0.14)

  const driverVehicleRatio = driverCount / Math.max(1, vehicleCount)
  base *= clamp(1 + Math.max(0, driverVehicleRatio - 1) * 0.07, 0.92, 1.4)

  const selectedCoverages = getSelectedCoverages(payload?.coverages)
  const caBreakdown = rateCommercialAutoCoverages(base, selectedCoverages)
  const fees = rates.fees?.policy ?? 95
  const taxesRate = rates.taxes?.rate ?? 0.03
  const taxes = round2(caBreakdown.coverageSubtotal * taxesRate)
  const total = round2(caBreakdown.coverageSubtotal + fees + taxes)
  const premium = breakdown(total, fees, taxes, caBreakdown.byCoverage)
  ;(premium as any).calcTrace = {
    source: 'builtin-commercial-auto-rater',
    factors: {
      termMonths,
      termFactor,
      stateCode,
      stateFactor,
      vehicleCount,
      driverCount,
      driverVehicleRatio: round2(driverVehicleRatio),
      useClass,
      radiusClass,
      vehicleType,
      gvwClass,
      annualMileage,
      yearsInBusiness,
      priorLossesCount,
      lossesRated
    }
  }
  return premium
}

function pickAgeFactor(age: number, table?: Record<string, number>): number {
  if (!table) return 1
  // simple buckets: <25, 25-64, 65+
  if (age < 25) return table['<25'] ?? 1.3
  if (age >= 65) return table['65+'] ?? 1.1
  return table['25-64'] ?? 1
}

function asTableRows(value: any): any[] {
  if (Array.isArray(value)) return value.filter((row) => row && typeof row === 'object')
  if (value && typeof value === 'object') return [value]
  return []
}

function toFiniteNumber(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(String(value).replace(/,/g, '').trim())
    if (Number.isFinite(n)) return n
  }
  return null
}

function normalizeCoverageMatchCode(code: string): string {
  const key = coverageKey(code)
  if (['BI', 'PD', 'COMP', 'COLL'].includes(key)) return key
  return String(code || '').trim().toUpperCase()
}

function matchRowState(row: any, stateCode: string): boolean {
  const rowState = String(row?.State || row?.state || '').trim().toUpperCase()
  if (!stateCode) return true
  return !rowState || rowState === stateCode
}

function resolveTerritoryCode(payload: any, risk: any, baseLossRows: any[]): string {
  const explicit = String(risk?.territoryCode || risk?.territory || payload?.territoryCode || '').trim()
  if (explicit) return explicit
  const zip = String(risk?.garagingZip || risk?.zip || payload?.zip || '').replace(/\D+/g, '')
  if (zip.length >= 3) return zip.slice(0, 3)
  const fallbackRow = baseLossRows[0] || {}
  return String(fallbackRow['Territory Code'] || '').trim()
}

function findTerritoryRelativity(rows: any[], stateCode: string, territoryCode: string): number {
  const scoped = rows.filter((row) => matchRowState(row, stateCode))
  if (!scoped.length) return 1
  const target = String(territoryCode || '').trim()
  const exact = scoped.find((row) => String(row['Territory Code'] || '').trim() === target)
  const row = exact || (scoped.length === 1 ? scoped[0] : null)
  return parseRelativity(row?.Relativity, 1)
}

function findDriverRelativity(rows: any[], stateCode: string, attributeContains: string, value: number | null): number {
  if (value == null) return 1
  const scoped = rows.filter((row) => {
    if (!matchRowState(row, stateCode)) return false
    const attr = String(row['Driver Attribute'] || '').toLowerCase()
    return attr.includes(attributeContains.toLowerCase())
  })
  if (!scoped.length) return 1
  const matched = scoped.find((row) => bandMatchesValue(String(row['Band/Value'] || ''), value))
  return parseRelativity((matched || scoped[0])?.Relativity, 1)
}

function bandMatchesValue(rawBand: string, value: number): boolean {
  const band = String(rawBand || '').trim()
  if (!band) return false
  if (/^\d+(\.\d+)?$/.test(band)) return Number(band) === value
  const range = /^(\d+(\.\d+)?)\s*-\s*(\d+(\.\d+)?)$/.exec(band)
  if (range) {
    const min = Number(range[1])
    const max = Number(range[3])
    return Number.isFinite(min) && Number.isFinite(max) && value >= min && value <= max
  }
  const plus = /^(\d+(\.\d+)?)\s*\+$/.exec(band)
  if (plus) {
    const min = Number(plus[1])
    return Number.isFinite(min) && value >= min
  }
  const lt = /^<\s*(\d+(\.\d+)?)$/.exec(band)
  if (lt) {
    const max = Number(lt[1])
    return Number.isFinite(max) && value < max
  }
  const lte = /^<=\s*(\d+(\.\d+)?)$/.exec(band)
  if (lte) {
    const max = Number(lte[1])
    return Number.isFinite(max) && value <= max
  }
  return false
}

function findVehicleRelativity(rows: any[], stateCode: string, symbolTypeContains: string, symbol: string): number {
  const scoped = rows.filter((row) => {
    if (!matchRowState(row, stateCode)) return false
    const st = String(row['Symbol Type'] || '').toLowerCase()
    return st.includes(symbolTypeContains.toLowerCase())
  })
  if (!scoped.length) return 1
  const target = String(symbol || '').trim()
  const exact = scoped.find((row) => String(row['Vehicle Symbol'] || '').trim() === target)
  return parseRelativity((exact || (scoped.length === 1 ? scoped[0] : null))?.Relativity, 1)
}

function findUsageRelativity(rows: any[], stateCode: string, usageType: string): number {
  const scoped = rows.filter((row) => matchRowState(row, stateCode))
  if (!scoped.length) return 1
  const normalizedUsage = String(usageType || '').trim().toLowerCase()
  const exact = scoped.find((row) => String(row['Use Type'] || '').trim().toLowerCase() === normalizedUsage)
  return parseRelativity((exact || (scoped.length === 1 ? scoped[0] : null))?.Relativity, 1)
}

function findLimitDedRelativity(rows: any[], stateCode: string, covKey: string, cov: any): number {
  const scoped = rows.filter((row) => matchRowState(row, stateCode) && normalizeCoverageMatchCode(String(row?.Coverage || '')) === covKey)
  if (!scoped.length) return 1
  const target = covKey === 'COMP' || covKey === 'COLL'
    ? normalizeLimitOrDed(cov?.deductible)
    : normalizeLimitOrDed(cov?.limit)
  if (!target) return parseRelativity(scoped[0]?.Relativity, 1)
  const exact = scoped.find((row) => normalizeLimitOrDed(row['Limit/Deductible']) === target)
  return parseRelativity((exact || scoped[0])?.Relativity, 1)
}

function normalizeLimitOrDed(value: any): string {
  if (value == null) return ''
  const text = String(value).trim().toUpperCase()
  return text.replace(/\s+/g, '')
}

function findLcm(rows: any[], stateCode: string): number {
  const scoped = rows.filter((row) => matchRowState(row, stateCode))
  if (!scoped.length) return 1
  const row = scoped.find((item) => String(item['Coverage Group'] || '').toLowerCase().includes('auto')) || scoped[0]
  return parseRelativity(row?.['LCM (Loss Cost Multiplier)'], 1)
}

function findDiscountMultiplier(rows: any[], stateCode: string, payload: any): number {
  const scoped = rows.filter((row) => matchRowState(row, stateCode))
  if (!scoped.length) return 1
  let multiplier = 1
  for (const row of scoped) {
    const name = String(row['Discount/Surcharge'] || '').toLowerCase()
    const factor = parseRelativity(row?.Factor, 1)
    if (!Number.isFinite(factor) || factor <= 0) continue
    if (name.includes('multi-car')) {
      if ((Array.isArray(payload?.risks) ? payload.risks.length : 0) > 1) multiplier *= factor
    } else if (name.includes('lapse')) {
      const lapse = parseBooleanLike(payload?.uwAnswers?.priorInsuranceLapse ?? payload?.priorInsuranceLapse)
      if (lapse) multiplier *= factor
    }
  }
  return clamp(multiplier, 0.5, 2.5)
}

function findBaseLossCost(rows: any[], stateCode: string, covKey: string, cov: any): number {
  const scoped = rows.filter((row) => matchRowState(row, stateCode) && normalizeCoverageMatchCode(String(row?.Coverage || '')) === covKey)
  if (!scoped.length) return 0
  const targetLimit = covKey === 'COMP' || covKey === 'COLL'
    ? normalizeLimitOrDed(cov?.deductible)
    : normalizeLimitOrDed(cov?.limit)
  const exact = targetLimit ? scoped.find((row) => normalizeLimitOrDed(row?.Limit) === targetLimit) : null
  const row = exact || scoped[0]
  const base = toFiniteNumber(row?.['Base Loss Cost'])
  return base && base > 0 ? base : 0
}

function parseRelativity(value: any, fallback: number): number {
  const n = toFiniteNumber(value)
  return n != null && n > 0 ? n : fallback
}

function resolveWorkbookPolicyFee(assumptionsRows: any[], rates: Rates): number {
  for (const row of assumptionsRows) {
    const parameter = String(row?.Parameter || '').toLowerCase()
    if (parameter.includes('fee')) {
      const value = toFiniteNumber(row?.Value)
      if (value != null && value >= 0) return round2(value)
    }
  }
  return round2(Number(rates.fees?.policy ?? 25))
}

function resolveWorkbookTaxRate(assumptionsRows: any[], rates: Rates): number {
  for (const row of assumptionsRows) {
    const parameter = String(row?.Parameter || '').toLowerCase()
    if (parameter.includes('tax')) {
      const value = toFiniteNumber(row?.Value)
      if (value == null) continue
      if (value > 1 && value <= 100) return value / 100
      if (value >= 0 && value <= 1) return value
    }
  }
  const fallback = Number(rates.taxes?.rate ?? 0.03)
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0.03
}

function pickRoofAgeFactor(ageYears: number, table?: Record<string, number>): number {
  if (!table) return ageYears > 20 ? 1.15 : ageYears > 10 ? 1.05 : 1
  if (ageYears <= 10) return table['0-10'] ?? 1
  if (ageYears <= 20) return table['11-20'] ?? 1.05
  return table['21+'] ?? 1.15
}

function pickProtectionClassFactor(pc: number, table?: Record<string, number>): number {
  if (!table || typeof table !== 'object') return 1
  for (const key of Object.keys(table)) {
    const match = /^(\d+)\s*-\s*(\d+)$/.exec(key)
    if (!match) continue
    const min = Number(match[1])
    const max = Number(match[2])
    if (Number.isFinite(min) && Number.isFinite(max) && pc >= min && pc <= max) {
      return table[key] ?? 1
    }
  }
  return 1
}

function getSelectedCoverages(raw: any): any[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((c: any) => c && c.selected !== false)
}

function rateAutoCoverages(base: number, coverages: any[]): { byCoverage: any[]; coverageSubtotal: number } {
  if (!coverages.length) {
    const fallback = round2(base)
    return {
      byCoverage: [makeCoverageEntry('BASE', fallback, null)],
      coverageSubtotal: fallback
    }
  }
  const weights: Record<string, number> = {
    BI: 0.34,
    PD: 0.2,
    COMP: 0.2,
    COLL: 0.26
  }
  let subtotal = 0
  const byCoverage = coverages.map((cov: any) => {
    const code = coverageCode(cov)
    const key = coverageKey(code)
    const weight = weights[key] ?? (1 / Math.max(coverages.length, 1))
    const multiplier = autoCoverageMultiplier(key, cov)
    const amount = round2(base * weight * multiplier)
    subtotal += amount
    return makeCoverageEntry(code, amount, cov)
  })
  return { byCoverage, coverageSubtotal: round2(subtotal) }
}

function rateCommercialAutoCoverages(base: number, coverages: any[]): { byCoverage: any[]; coverageSubtotal: number } {
  if (!coverages.length) {
    const fallback = round2(base)
    return {
      byCoverage: [makeCoverageEntry('BASE', fallback, null)],
      coverageSubtotal: fallback
    }
  }
  const weights: Record<string, number> = {
    AUTO_LIAB: 0.48,
    HNOA: 0.08,
    UM_UIM: 0.12,
    PIP_MED: 0.08,
    COMP: 0.1,
    COLL: 0.1,
    TOWING: 0.02,
    RENTAL: 0.02
  }
  const baseLimits: Record<string, number> = {
    AUTO_LIAB: 1000000,
    HNOA: 1000000,
    UM_UIM: 100000,
    PIP_MED: 5000,
    TOWING: 1000,
    RENTAL: 1500
  }
  const defaultDeductibles: Record<string, number> = {
    COMP: 1000,
    COLL: 1000
  }
  let subtotal = 0
  const byCoverage = coverages.map((cov: any) => {
    const code = coverageCode(cov)
    const key = coverageKey(code)
    const weight = weights[key] ?? (1 / Math.max(coverages.length, 1))
    let factor = 1
    if (key === 'COMP' || key === 'COLL') {
      const deductibleBase = defaultDeductibles[key] ?? 1000
      const deductible = parseCoverageLimit(cov?.deductible, deductibleBase)
      factor = clamp(Math.sqrt(deductibleBase / Math.max(100, deductible)), 0.5, 1.75)
    } else {
      const baseLimit = baseLimits[key] ?? 100000
      const limit = parseCoverageLimit(cov?.limit, baseLimit)
      factor = clamp(Math.sqrt(limit / baseLimit), 0.65, 2.35)
    }
    const amount = round2(base * weight * factor)
    subtotal += amount
    return makeCoverageEntry(code, amount, cov)
  })
  return { byCoverage, coverageSubtotal: round2(subtotal) }
}

function autoCoverageMultiplier(code: string, cov: any): number {
  if (code === 'BI') {
    const limit = parseCoverageLimit(cov?.limit, 25000)
    return clamp(Math.sqrt(limit / 25000), 0.8, 1.9)
  }
  if (code === 'PD') {
    const limit = parseCoverageLimit(cov?.limit, 10000)
    return clamp(Math.sqrt(limit / 10000), 0.8, 1.9)
  }
  if (code === 'COMP' || code === 'COLL') {
    const deductible = parseCoverageLimit(cov?.deductible, 500)
    return clamp(Math.sqrt(500 / Math.max(50, deductible)), 0.65, 1.6)
  }
  return 1
}

function rateHOCoverages(base: number, coverages: any[]): { byCoverage: any[]; coverageSubtotal: number } {
  if (!coverages.length) {
    const fallback = round2(base)
    return {
      byCoverage: [makeCoverageEntry('BASE', fallback, null)],
      coverageSubtotal: fallback
    }
  }
  const weights: Record<string, number> = {
    A: 0.52,
    B: 0.08,
    C: 0.15,
    D: 0.08,
    E: 0.12,
    F: 0.05,
    END_WB: 0.05
  }
  let subtotal = 0
  const byCoverage = coverages.map((cov: any) => {
    const code = coverageCode(cov)
    const key = coverageKey(code)
    const weight = weights[key] ?? (0.06 / Math.max(coverages.length, 1))
    const multiplier = hoCoverageMultiplier(key, cov)
    const amount = round2(base * weight * multiplier)
    subtotal += amount
    return makeCoverageEntry(code, amount, cov)
  })
  return { byCoverage, coverageSubtotal: round2(subtotal) }
}

function rateCyberCoverages(base: number, coverages: any[]): { byCoverage: any[]; coverageSubtotal: number } {
  if (!coverages.length) {
    const fallback = round2(base)
    return {
      byCoverage: [makeCoverageEntry('BASE', fallback, null)],
      coverageSubtotal: fallback
    }
  }
  const weights: Record<string, number> = {
    CYB_LIAB: 0.38,
    BIZ_INT: 0.16,
    CYB_EXT: 0.14,
    IR_EXP: 0.12,
    DATA_REC: 0.1,
    MEDIA: 0.1
  }
  const baseLimits: Record<string, number> = {
    CYB_LIAB: 1000000,
    BIZ_INT: 250000,
    CYB_EXT: 100000,
    IR_EXP: 100000,
    DATA_REC: 50000,
    MEDIA: 250000
  }
  let subtotal = 0
  const byCoverage = coverages.map((cov: any) => {
    const code = coverageCode(cov)
    const key = coverageKey(code)
    const weight = weights[key] ?? (1 / Math.max(coverages.length, 1))
    const limit = parseCoverageLimit(cov?.limit, baseLimits[key] ?? 100000)
    const deductible = parseCoverageLimit(cov?.deductible, 5000)
    const limitFactor = clamp(Math.sqrt(limit / (baseLimits[key] ?? 100000)), 0.65, 2.4)
    const deductibleFactor = clamp(Math.sqrt(5000 / Math.max(500, deductible)), 0.55, 1.6)
    const amount = round2(base * weight * limitFactor * deductibleFactor)
    subtotal += amount
    return makeCoverageEntry(code, amount, cov)
  })
  return { byCoverage, coverageSubtotal: round2(subtotal) }
}

function rateProfessionalLiabilityCoverages(base: number, coverages: any[]): { byCoverage: any[]; coverageSubtotal: number } {
  if (!coverages.length) {
    const fallback = round2(base)
    return {
      byCoverage: [makeCoverageEntry('BASE', fallback, null)],
      coverageSubtotal: fallback
    }
  }
  const weights: Record<string, number> = {
    PROF_LIAB: 0.62,
    SUBPOENA: 0.07,
    DISCIP: 0.07,
    DEF_REIMB: 0.09,
    CRISIS_PR: 0.08,
    MEDIATION: 0.07
  }
  const baseLimits: Record<string, number> = {
    PROF_LIAB: 1000000,
    SUBPOENA: 25000,
    DISCIP: 25000,
    DEF_REIMB: 50000,
    CRISIS_PR: 50000,
    MEDIATION: 25000
  }
  const defaultDeductibles: Record<string, number> = {
    PROF_LIAB: 5000,
    SUBPOENA: 500,
    DISCIP: 500,
    DEF_REIMB: 1000,
    CRISIS_PR: 1000,
    MEDIATION: 500
  }
  let subtotal = 0
  const byCoverage = coverages.map((cov: any) => {
    const code = coverageCode(cov)
    const key = coverageKey(code)
    const weight = weights[key] ?? (1 / Math.max(coverages.length, 1))
    const limit = parseCoverageLimit(cov?.limit, baseLimits[key] ?? 25000)
    const deductibleBase = defaultDeductibles[key] ?? 1000
    const deductibleRaw = toFiniteNumber(cov?.deductible)
    const deductible = deductibleRaw != null && deductibleRaw >= 0 ? deductibleRaw : deductibleBase
    const limitFactor = clamp(Math.sqrt(limit / (baseLimits[key] ?? 25000)), 0.65, 2.5)
    const deductibleFloor = key === 'PROF_LIAB' ? 500 : 100
    const deductibleFactor = clamp(Math.sqrt(deductibleBase / Math.max(deductibleFloor, deductible)), 0.55, 1.65)
    const amount = round2(base * weight * limitFactor * deductibleFactor)
    subtotal += amount
    return makeCoverageEntry(code, amount, cov)
  })
  return { byCoverage, coverageSubtotal: round2(subtotal) }
}

function hoCoverageMultiplier(code: string, cov: any): number {
  if (code === 'A') {
    const limit = parseCoverageLimit(cov?.limit, 300000)
    return clamp(Math.sqrt(limit / 300000), 0.6, 1.85)
  }
  if (code === 'B') {
    const pct = parsePercent(cov?.percent, 10)
    return clamp(pct / 10, 0.5, 2.2)
  }
  if (code === 'C') {
    const pct = parsePercent(cov?.percent, 50)
    return clamp(pct / 50, 0.5, 2.2)
  }
  if (code === 'D') {
    const pct = parsePercent(cov?.percent, 20)
    return clamp(pct / 20, 0.5, 2.2)
  }
  if (code === 'E') {
    const limit = parseCoverageLimit(cov?.limit, 300000)
    return clamp(Math.sqrt(limit / 300000), 0.7, 1.85)
  }
  if (code === 'F') {
    const limit = parseCoverageLimit(cov?.limit, 5000)
    return clamp(Math.sqrt(limit / 5000), 0.7, 1.8)
  }
  const fallbackLimit = parseCoverageLimit(cov?.limit, 5000)
  return clamp(Math.sqrt(fallbackLimit / 5000), 0.65, 1.8)
}

function breakdown(total: number, fees: number, taxes: number, byCoverage: any[]): PremiumResult {
  return {
    byCoverage,
    fees: { amount: round2(fees), currency: 'USD' },
    taxes: { amount: round2(taxes), currency: 'USD' },
    total: { amount: round2(total), currency: 'USD' }
  }
}

function coverageCode(cov: any): string {
  return String(cov?.code || cov?.coverage_code || cov?.definitionCode || 'COV').toUpperCase()
}

function coverageKey(code: string): string {
  const upper = String(code || '').toUpperCase()
  if (!upper) return 'COV'
  if (upper === 'AUTO_LIAB' || upper.includes('COMMERCIAL AUTO LIABILITY') || upper.includes('AUTO LIABILITY')) return 'AUTO_LIAB'
  if (upper === 'HNOA' || upper.includes('HIRED') || upper.includes('NON-OWNED')) return 'HNOA'
  if (upper === 'UM_UIM' || upper.includes('UNDERINSURED') || upper.includes('UNINSURED')) return 'UM_UIM'
  if (upper === 'PIP_MED' || upper.includes('PIP') || upper.includes('MED PAY') || upper.includes('MEDICAL PAYMENTS')) return 'PIP_MED'
  if (upper === 'TOWING' || upper.includes('TOWING') || upper.includes('LABOR')) return 'TOWING'
  if (upper === 'RENTAL' || upper.includes('RENTAL REIMBURSEMENT')) return 'RENTAL'
  if (upper === 'BI' || upper.endsWith('.BI') || upper.includes('BODILY') || upper.includes('LIAB.BI')) return 'BI'
  if (upper === 'PD' || upper.endsWith('.PD') || upper.includes('PROPERTY') || upper.includes('LIAB.PD')) return 'PD'
  if (upper === 'COMP' || upper.endsWith('.COMP') || upper.includes('COMPREHENSIVE')) return 'COMP'
  if (upper === 'COLL' || upper.endsWith('.COLL') || upper.includes('COLLISION')) return 'COLL'
  if (upper === 'END_WB' || upper.includes('WATER_BACKUP') || upper.includes('WATER-BACKUP') || upper.includes('WATER BACKUP')) return 'END_WB'
  if (upper === 'CYB_LIAB' || upper.includes('CYBER_LIABILITY') || upper.includes('CYBER LIABILITY')) return 'CYB_LIAB'
  if (upper === 'BIZ_INT' || upper.includes('BUSINESS_INTERRUPTION') || upper.includes('BUSINESS INTERRUPTION')) return 'BIZ_INT'
  if (upper === 'CYB_EXT' || upper.includes('CYBER_EXTORTION') || upper.includes('CYBER EXTORTION')) return 'CYB_EXT'
  if (upper === 'IR_EXP' || upper.includes('INCIDENT_RESPONSE') || upper.includes('INCIDENT RESPONSE')) return 'IR_EXP'
  if (upper === 'DATA_REC' || upper.includes('DATA_RECOVERY') || upper.includes('DATA RECOVERY')) return 'DATA_REC'
  if (upper === 'MEDIA' || upper.includes('MEDIA_LIABILITY') || upper.includes('MEDIA LIABILITY')) return 'MEDIA'
  if (upper === 'PROF_LIAB' || upper.includes('ERRORS') || upper.includes('OMISSIONS') || upper.includes('PROFESSIONAL LIABILITY')) return 'PROF_LIAB'
  if (upper === 'SUBPOENA' || upper.includes('SUBPOENA')) return 'SUBPOENA'
  if (upper === 'DISCIP' || upper.includes('DISCIPLINARY')) return 'DISCIP'
  if (upper === 'DEF_REIMB' || upper.includes('DEFENDANT EXPENSE') || upper.includes('DEFENSE REIMBURSEMENT')) return 'DEF_REIMB'
  if (upper === 'CRISIS_PR' || upper.includes('CRISIS') || upper.includes('REPUTATION')) return 'CRISIS_PR'
  if (upper === 'MEDIATION' || upper.includes('ARBITRATION') || upper.includes('MEDIATION')) return 'MEDIATION'
  const tokens = upper.split(/[^A-Z0-9]+/).filter(Boolean)
  for (const token of ['AUTO_LIAB', 'HNOA', 'UM_UIM', 'PIP_MED', 'TOWING', 'RENTAL', 'BI', 'PD', 'COMP', 'COLL', 'END_WB', 'CYB_LIAB', 'BIZ_INT', 'CYB_EXT', 'IR_EXP', 'DATA_REC', 'MEDIA', 'PROF_LIAB', 'SUBPOENA', 'DISCIP', 'DEF_REIMB', 'CRISIS_PR', 'MEDIATION']) {
    if (tokens.includes(token)) return token
  }
  for (const token of ['A', 'B', 'C', 'D', 'E', 'F']) {
    if (tokens.includes(token)) return token
  }
  const last = tokens[tokens.length - 1]
  return last || upper
}

function makeCoverageEntry(code: string, amount: number, cov: any) {
  return {
    code,
    selected: cov ? cov.selected !== false : true,
    limit: cov?.limit ?? null,
    deductible: cov?.deductible ?? null,
    percent: cov?.percent ?? null,
    amount: { amount: round2(amount), currency: 'USD' }
  }
}

function parseCoverageLimit(value: any, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, value)
  if (typeof value === 'string') {
    const first = value.split('/')[0] || value
    const numeric = Number(String(first).replace(/,/g, '').trim())
    if (Number.isFinite(numeric) && numeric > 0) return numeric
  }
  if (value && typeof value === 'object') {
    const nested = value.amount ?? value.value ?? value.limit
    return parseCoverageLimit(nested, fallback)
  }
  return Math.max(1, fallback)
}

function parsePercent(value: any, fallback: number): number {
  const parsed = parseCoverageLimit(value, fallback)
  return Math.max(1, parsed)
}

function parseBooleanLike(value: any): boolean {
  if (typeof value === 'boolean') return value
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y'
}

function pickNamedFactor(key: string, table: Record<string, number> | undefined, fallback: number): number {
  const normalized = String(key || '').trim().toLowerCase()
  if (table && typeof table === 'object') {
    const byExact = table[normalized]
    if (Number.isFinite(byExact)) return Number(byExact)
  }
  return fallback
}

function pickRangeFactor(value: number, table: Record<string, number> | undefined, fallback: number): number {
  if (!table || typeof table !== 'object') return fallback
  const entries = Object.entries(table)
  for (const [rawRange, rawFactor] of entries) {
    const factor = Number(rawFactor)
    if (!Number.isFinite(factor)) continue
    const range = String(rawRange || '').trim()
    if (!range) continue
    if (range.startsWith('<=')) {
      const max = Number(range.slice(2))
      if (Number.isFinite(max) && value <= max) return factor
      continue
    }
    if (range.endsWith('+')) {
      const min = Number(range.slice(0, -1))
      if (Number.isFinite(min) && value >= min) return factor
      continue
    }
    const match = /^(\d+)\s*-\s*(\d+)$/.exec(range)
    if (match) {
      const min = Number(match[1])
      const max = Number(match[2])
      if (Number.isFinite(min) && Number.isFinite(max) && value >= min && value <= max) return factor
      continue
    }
  }
  return fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
