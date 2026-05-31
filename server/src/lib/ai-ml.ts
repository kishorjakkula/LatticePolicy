import { TenantAiMlConfig } from '../tenantAi.js'
import { round2 } from './date.utils.js'

export type QuoteAiInsights = {
  enabled: boolean
  provider: string
  modelVersion: string
  shadowMode: boolean
  evaluatedAt: string
  recommendation: 'AUTO_APPROVE' | 'REVIEW' | 'REFER_UW' | 'SHADOW_ONLY' | 'DISABLED'
  scores: {
    risk: number
    fraud: number
    premiumAdequacy: number
  }
  thresholds: {
    riskReferral: number
    fraudReview: number
    premiumVariance: number
  }
  reasons: string[]
  coveragePremiumAllocation: Array<{
    code: string
    premiumAmount: number
    sharePct: number
  }>
  suggestedActions: string[]
}

export type DashboardAiInsights = {
  enabled: boolean
  shadowMode: boolean
  provider: string
  modelVersion: string
  generatedAt: string
  portfolioHealthScore: number
  conversionRate: number
  cancellationRate: number
  expiringNext30Days: number
  openQuotes: number
  recommendations: string[]
  alerts: string[]
  predictions: {
    next30Days: {
      projectedQuotes: number
      projectedPolicies: number
      projectedConversionRate: number
      projectedCancellationRate: number
      projectedPremium: number
    }
    next90Days: {
      projectedQuotes: number
      projectedPolicies: number
      projectedConversionRate: number
    }
  }
  trend: {
    historical: Array<{
      monthKey: string
      monthLabel: string
      quotes: number
      policies: number
      cancellations: number
    }>
    forecast: Array<{
      monthKey: string
      monthLabel: string
      projectedQuotes: number
      projectedPolicies: number
      projectedCancellations: number
    }>
  }
}

export type PolicyAiInsights = {
  enabled: boolean
  shadowMode: boolean
  provider: string
  modelVersion: string
  generatedAt: string
  policyHealthScore: number
  scores: {
    risk: number
    fraud: number
    premiumAdequacy: number
    retentionRisk: number
    changeVolatility: number
    endorsementComplexity: number
  }
  summary: {
    currentPolicyPremium: number
    nbPremium: number
    netChangeAmount: number
    transactionCount: number
    endorsementCount: number
    negativePremiumTransactions: number
    outOfSequenceTransactions: number
  }
  alerts: string[]
  recommendations: string[]
  premiumTimeline: Array<{
    transactionNumber: string
    transactionType: string
    effectiveDate: string
    processedAt: string
    amount: number
    cumulativePolicyPremium: number
  }>
}

export type CustomerAiInsights = {
  enabled: boolean
  shadowMode: boolean
  provider: string
  modelVersion: string
  generatedAt: string
  customerHealthScore: number
  scores: {
    retentionRisk: number
    crossSellOpportunity: number
    serviceComplexity: number
  }
  summary: {
    policyCount: number
    activePolicyCount: number
    openQuoteCount: number
    estimatedAnnualPremium: number
    productCount: number
  }
  productMix: Array<{ productCode: string; count: number }>
  suggestedProducts: string[]
  alerts: string[]
  recommendations: string[]
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function toMoney(value: any): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeProductCode(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}



function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function extractCoverageAllocation(premium: any): Array<{ code: string; premiumAmount: number; sharePct: number }> {
  const items = Array.isArray(premium?.byCoverage) ? premium.byCoverage : []
  const total = Math.max(0.01, toMoney(premium?.total?.amount))
  const rows: Array<{ code: string; premiumAmount: number; sharePct: number }> = items
    .map((item: any) => {
      const code = String(item?.code || item?.coverageCode || 'COV').toUpperCase()
      const amount = toMoney(item?.amount?.amount ?? item?.amount ?? item?.premium)
      return {
        code,
        premiumAmount: round2(amount),
        sharePct: round2((amount / total) * 100)
      }
    })
    .filter((item: { code: string; premiumAmount: number; sharePct: number }) => item.premiumAmount > 0)
  return rows.sort((a, b) => b.premiumAmount - a.premiumAmount)
}

function calculateRiskScore(productCode: string, payload: any): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0.12

  if (productCode === 'personal-auto') {
    const firstRisk = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
    const age = Number(payload?.uwAnswers?.driverAge ?? firstRisk?.driverAge)
    const annualMiles = Number(firstRisk?.annualMiles)
    const usage = String(firstRisk?.usage || '').toLowerCase()
    const state = String(payload?.state || '').toUpperCase()
    const vin = String(firstRisk?.vin || '').trim()

    if (Number.isFinite(age) && age < 21) { score += 0.42; reasons.push('Primary driver age below 21 increases risk.') }
    else if (Number.isFinite(age) && age < 25) { score += 0.24; reasons.push('Primary driver age below 25 increases risk.') }
    else if (Number.isFinite(age) && age >= 75) { score += 0.18; reasons.push('Senior driver profile increases risk.') }
    if (Number.isFinite(annualMiles) && annualMiles > 25000) { score += 0.22; reasons.push('High annual mileage increases loss frequency.') }
    else if (Number.isFinite(annualMiles) && annualMiles > 15000) { score += 0.12; reasons.push('Moderately high annual mileage detected.') }
    if (usage === 'business' || usage === 'rideshare' || usage === 'delivery') {
      score += 0.2
      reasons.push('Commercial-style vehicle usage increases exposure.')
    }
    if (['FL', 'LA', 'NY'].includes(state)) {
      score += 0.06
      reasons.push('Jurisdiction trend indicates elevated loss cost.')
    }
    if (!vin || vin === '-') {
      score += 0.08
      reasons.push('Missing VIN lowers confidence in risk data quality.')
    }
  } else if (productCode === 'homeowners') {
    const dwelling = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
    const roofAgeYears = Number(dwelling?.roofAgeYears)
    const yearBuilt = Number(dwelling?.yearBuilt)
    const construction = String(dwelling?.construction || '').toLowerCase()
    const protectionClass = Number(dwelling?.protectionClass)
    if (Number.isFinite(roofAgeYears) && roofAgeYears > 20) {
      score += 0.24
      reasons.push('Older roof profile increases weather-related risk.')
    } else if (Number.isFinite(roofAgeYears) && roofAgeYears > 10) {
      score += 0.1
      reasons.push('Mid-life roof profile slightly increases risk.')
    }
    if (Number.isFinite(yearBuilt) && yearBuilt < 1980) {
      score += 0.14
      reasons.push('Older construction year increases expected severity.')
    }
    if (construction === 'frame') {
      score += 0.1
      reasons.push('Frame construction carries higher fire susceptibility.')
    }
    if (Number.isFinite(protectionClass) && protectionClass > 6) {
      score += 0.12
      reasons.push('Higher protection class indicates reduced fire protection.')
    }
  } else if (productCode === 'cyber') {
    const profile = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
    const revenue = Number(profile?.annualRevenue)
    const records = Number(profile?.recordsCount)
    const incidents = Number(profile?.priorIncidents)
    const mfaEnabled = String(profile?.mfaEnabled || '').toLowerCase()
    const backups = String(profile?.backups || '').toLowerCase()
    const industry = String(profile?.industry || '').toLowerCase()

    if (Number.isFinite(revenue) && revenue > 50000000) {
      score += 0.2
      reasons.push('Large revenue profile increases cyber loss severity potential.')
    } else if (Number.isFinite(revenue) && revenue > 10000000) {
      score += 0.1
      reasons.push('Mid-to-large revenue profile increases cyber exposure.')
    }
    if (Number.isFinite(records) && records > 1000000) {
      score += 0.22
      reasons.push('Large sensitive record footprint increases breach impact.')
    } else if (Number.isFinite(records) && records > 100000) {
      score += 0.12
      reasons.push('Moderate sensitive record footprint detected.')
    }
    if (Number.isFinite(incidents) && incidents >= 2) {
      score += 0.28
      reasons.push('Multiple prior cyber incidents increase recurrence risk.')
    } else if (Number.isFinite(incidents) && incidents === 1) {
      score += 0.14
      reasons.push('Prior cyber incident history increases risk.')
    }
    if (!(mfaEnabled === 'true' || mfaEnabled === 'yes' || mfaEnabled === '1')) {
      score += 0.18
      reasons.push('Missing MFA controls increase account compromise risk.')
    }
    if (backups === 'none') {
      score += 0.24
      reasons.push('No backup controls increase ransomware severity risk.')
    } else if (backups === 'monthly') {
      score += 0.12
      reasons.push('Infrequent backups may increase recovery downtime.')
    }
    if (industry === 'healthcare' || industry === 'finance') {
      score += 0.08
      reasons.push('Regulated industry profile indicates elevated cyber compliance exposure.')
    }
  } else {
    reasons.push('Product has baseline risk model only.')
  }

  return { score: clamp01(score), reasons }
}

function calculateFraudScore(payload: any): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0.05
  const firstName = String(payload?.applicant?.firstName || '').trim().toLowerCase()
  const lastName = String(payload?.applicant?.lastName || '').trim().toLowerCase()
  const email = String(payload?.applicant?.email || '').trim().toLowerCase()
  const effectiveDate = String(payload?.effectiveDate || '')
  const now = new Date().toISOString().slice(0, 10)

  if (!email) {
    score += 0.12
    reasons.push('Missing applicant email lowers identity confidence.')
  } else if (email.includes('test') || email.endsWith('@example.com')) {
    score += 0.22
    reasons.push('Synthetic-style email domain/pattern detected.')
  }

  if (['test', 'demo', 'sample'].includes(firstName) || ['user', 'test', 'demo'].includes(lastName)) {
    score += 0.3
    reasons.push('Applicant naming pattern resembles non-production data.')
  }

  if (effectiveDate && effectiveDate < now) {
    score += 0.08
    reasons.push('Backdated effective date requires additional validation.')
  }

  return { score: clamp01(score), reasons }
}

function baseMarketPremium(productCode: string, state: string): number {
  const stateFactorByCode: Record<string, number> = {
    FL: 1.22,
    NY: 1.15,
    CA: 1.08,
    TX: 1.06,
    NJ: 1.12
  }
  const stateFactor = stateFactorByCode[String(state || '').toUpperCase()] || 1
  const baseByProduct: Record<string, number> = {
    'personal-auto': 720,
    homeowners: 980,
    cyber: 1800
  }
  return (baseByProduct[productCode] || 800) * stateFactor
}

function calculatePremiumAdequacy(productCode: string, payload: any, premium: any): { score: number; reasons: string[] } {
  const reasons: string[] = []
  const totalPremium = toMoney(premium?.total?.amount)
  if (!totalPremium) return { score: 0, reasons: ['Premium total is not available for adequacy analysis.'] }

  const risk = calculateRiskScore(productCode, payload).score
  const indicated = Math.max(1, baseMarketPremium(productCode, payload?.state) * (0.7 + risk))
  const ratio = totalPremium / indicated
  const delta = Math.abs(1 - ratio)
  const score = clamp01(1 - delta)

  if (ratio < 0.8) reasons.push('Premium appears lower than indicated benchmark for this risk.')
  else if (ratio > 1.2) reasons.push('Premium appears higher than indicated benchmark for this risk.')
  else reasons.push('Premium is within expected benchmark band.')

  return { score: round4(score), reasons }
}

export function inferQuoteAiInsights(
  config: TenantAiMlConfig,
  input: {
    payload: any
    premium: any
    underwriting?: any
  }
): QuoteAiInsights {
  const payload = input.payload || {}
  const productCode = normalizeProductCode(payload.productCode)
  const provider = config.provider || 'internal-baseline'
  const modelVersion = config.modelVersionByProduct?.[productCode] || 'baseline-v1'
  const evaluatedAt = new Date().toISOString()
  const coveragePremiumAllocation = extractCoverageAllocation(input.premium)

  if (!config.enabled) {
    return {
      enabled: false,
      provider,
      modelVersion,
      shadowMode: config.shadowMode,
      evaluatedAt,
      recommendation: 'DISABLED',
      scores: { risk: 0, fraud: 0, premiumAdequacy: 0 },
      thresholds: { ...config.thresholds },
      reasons: ['AI/ML is disabled for this tenant.'],
      coveragePremiumAllocation,
      suggestedActions: []
    }
  }

  const risk = config.features.riskScoring ? calculateRiskScore(productCode, payload) : { score: 0, reasons: [] as string[] }
  const fraud = config.features.fraudDetection ? calculateFraudScore(payload) : { score: 0, reasons: [] as string[] }
  const adequacy = config.features.premiumOptimization
    ? calculatePremiumAdequacy(productCode, payload, input.premium)
    : { score: 0, reasons: [] as string[] }

  const reasons = [...risk.reasons, ...fraud.reasons, ...adequacy.reasons]
  const suggestedActions: string[] = []
  let recommendation: QuoteAiInsights['recommendation'] = 'REVIEW'

  if (config.shadowMode) {
    recommendation = 'SHADOW_ONLY'
    suggestedActions.push('AI is in shadow mode; do not auto-decide from score outputs.')
  } else if (
    risk.score >= config.thresholds.riskReferral ||
    fraud.score >= config.thresholds.fraudReview ||
    String(input.underwriting?.decision || '').toLowerCase() === 'refer'
  ) {
    recommendation = 'REFER_UW'
    suggestedActions.push('Route to underwriter with AI explanations attached.')
  } else if (risk.score <= 0.35 && fraud.score <= 0.3 && adequacy.score >= 0.7) {
    recommendation = 'AUTO_APPROVE'
    suggestedActions.push('Eligible for straight-through path based on current thresholds.')
  } else {
    recommendation = 'REVIEW'
    suggestedActions.push('Keep in standard review lane.')
  }

  const premiumVariance = Math.abs(1 - adequacy.score)
  if (premiumVariance > config.thresholds.premiumVariance) {
    suggestedActions.push('Investigate premium adequacy variance before bind.')
  }

  return {
    enabled: true,
    provider,
    modelVersion,
    shadowMode: config.shadowMode,
    evaluatedAt,
    recommendation,
    scores: {
      risk: round4(risk.score),
      fraud: round4(fraud.score),
      premiumAdequacy: round4(adequacy.score)
    },
    thresholds: { ...config.thresholds },
    reasons,
    coveragePremiumAllocation,
    suggestedActions
  }
}

function dateOnly(value: any): string {
  const parsed = new Date(String(value || ''))
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

function monthKey(value: any): string {
  const parsed = new Date(String(value || ''))
  if (Number.isNaN(parsed.getTime())) return ''
  const year = parsed.getUTCFullYear()
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function monthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(String(key || ''))
  if (!match) return key
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
  return dt.toLocaleString('en-US', { month: 'short' })
}

function buildHistoricalMonthKeys(now: Date, count: number): string[] {
  const out: string[] = []
  const total = Math.max(1, count)
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (total - 1), 1))
  for (let i = 0; i < total; i++) {
    const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))
    out.push(`${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

function buildFutureMonthKeys(now: Date, count: number): string[] {
  const out: string[] = []
  const total = Math.max(1, count)
  for (let i = 1; i <= total; i++) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))
    out.push(`${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

function withinWindow(value: any, startDate: Date, endDate: Date): boolean {
  const parsed = new Date(String(value || ''))
  if (Number.isNaN(parsed.getTime())) return false
  return parsed >= startDate && parsed <= endDate
}

function derivePolicyWorkflowStatus(rawStatus: any, effectiveDate: any, expirationDate: any, nowDateOnly: string): string {
  const normalized = String(rawStatus || '').trim().toLowerCase()
  const eff = dateOnly(effectiveDate) || nowDateOnly
  const exp = dateOnly(expirationDate) || nowDateOnly
  if (normalized === 'cancelled') return 'Cancelled'
  if (exp < nowDateOnly) return 'Expired'
  if (normalized === 'bound') return 'Bind'
  if (normalized === 'issued') {
    if (eff <= nowDateOnly && exp >= nowDateOnly) return 'Inforced'
    return 'Issued'
  }
  if (normalized === 'rated') return 'Rated'
  if (normalized === 'draft' || normalized === 'quote') return 'Draft'
  return 'Draft'
}

function linearForecast(values: number[], horizon: number): number[] {
  const target = Math.max(1, horizon)
  const clean = (Array.isArray(values) ? values : []).map((item) => Math.max(0, Number(item) || 0))
  if (!clean.length) return Array.from({ length: target }, () => 0)
  if (clean.length === 1) return Array.from({ length: target }, () => round2(clean[0]))

  const n = clean.length
  const meanX = (n - 1) / 2
  const meanY = clean.reduce((sum, value) => sum + value, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    const dx = i - meanX
    num += dx * (clean[i] - meanY)
    den += dx * dx
  }
  const slope = den === 0 ? 0 : num / den
  const intercept = meanY - slope * meanX

  const out: number[] = []
  for (let i = 0; i < target; i++) {
    const x = n + i
    const predicted = Math.max(0, intercept + slope * x)
    out.push(round2(predicted))
  }
  return out
}

function mean(values: number[]): number {
  const clean = values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
  if (!clean.length) return 0
  return clean.reduce((sum, value) => sum + value, 0) / clean.length
}

function stddev(values: number[]): number {
  const clean = values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
  if (clean.length <= 1) return 0
  const m = mean(clean)
  const variance = clean.reduce((sum, value) => sum + Math.pow(value - m, 2), 0) / clean.length
  return Math.sqrt(Math.max(0, variance))
}

function normalizeTransactionType(value: any): string {
  return String(value || '').trim().toUpperCase()
}

function isEndorsementTx(value: any): boolean {
  const tx = normalizeTransactionType(value)
  return tx === 'ENDORSE' || tx === 'ENDORSEMENT'
}

function isCancellationTx(value: any): boolean {
  const tx = normalizeTransactionType(value)
  return tx === 'CANCEL' || tx === 'CANCELLATION' || tx === 'CANCELLED'
}

function isReinstatementTx(value: any): boolean {
  const tx = normalizeTransactionType(value)
  return tx === 'REINSTATE' || tx === 'REINSTATEMENT' || tx === 'REINSTATED'
}

function isIssuedLikePolicyStatus(value: any): boolean {
  const s = String(value || '').trim().toLowerCase()
  return s === 'issued' || s === 'inforced' || s === 'bind' || s === 'bound'
}

export function inferPolicyAiInsights(
  config: TenantAiMlConfig,
  input: {
    policy: {
      productCode?: string
      status?: string
      effectiveDate?: string
      expirationDate?: string
      payload?: any
    }
    versions: Array<{
      transactionType?: string
      transactionNumber?: string | null
      effectiveDate?: string
      processedAt?: string
      premiumTotal?: number
      premiumFees?: number
      premiumTaxes?: number
      currency?: string
      payload?: any
    }>
  }
): PolicyAiInsights {
  const generatedAt = new Date().toISOString()
  const productCode = normalizeProductCode(input?.policy?.productCode)
  const provider = config.provider || 'internal-baseline'
  const modelVersion = config.modelVersionByProduct?.[productCode] || 'baseline-v1'
  const versions = (Array.isArray(input?.versions) ? [...input.versions] : [])
    .map((row) => ({
      transactionType: normalizeTransactionType(row?.transactionType),
      transactionNumber: String(row?.transactionNumber || '').trim(),
      effectiveDate: dateOnly(row?.effectiveDate) || '',
      processedAt: String(row?.processedAt || generatedAt),
      premiumTotal: round2(toMoney(row?.premiumTotal)),
      premiumFees: round2(toMoney(row?.premiumFees)),
      premiumTaxes: round2(toMoney(row?.premiumTaxes)),
      currency: String(row?.currency || 'USD') || 'USD',
      payload: row?.payload
    }))
    .sort((a, b) => {
      const byProcessed = new Date(a.processedAt).getTime() - new Date(b.processedAt).getTime()
      if (byProcessed !== 0) return byProcessed
      const byEffective = String(a.effectiveDate).localeCompare(String(b.effectiveDate))
      if (byEffective !== 0) return byEffective
      return String(a.transactionNumber).localeCompare(String(b.transactionNumber))
    })

  const latest = versions[versions.length - 1]
  const currency = latest?.currency || 'USD'
  let cumulativePolicyPremium = 0
  let pendingReinstateCredit = 0
  const premiumTimeline = versions.map((row) => {
    const rawAmount = round2(toMoney(row.premiumTotal))
    let effectiveAmount = rawAmount
    if (isCancellationTx(row.transactionType) && rawAmount < 0) {
      pendingReinstateCredit = Math.abs(rawAmount)
    } else if (isReinstatementTx(row.transactionType)) {
      if (Math.abs(rawAmount) < 0.01 && pendingReinstateCredit > 0) {
        // Backward-compatibility for older reinstatements persisted with zero premium.
        effectiveAmount = round2(pendingReinstateCredit)
      }
      pendingReinstateCredit = 0
    }
    cumulativePolicyPremium = round2(cumulativePolicyPremium + effectiveAmount)
    return {
      transactionNumber: row.transactionNumber || row.transactionType || 'TX',
      transactionType: row.transactionType || 'UNKNOWN',
      effectiveDate: row.effectiveDate || '',
      processedAt: row.processedAt,
      amount: effectiveAmount,
      cumulativePolicyPremium
    }
  })

  const nbLike = versions.find((row) => {
    const tx = row.transactionType
    return tx === 'NB' || tx === 'NEWBUSINESS' || tx === 'ISSUE' || tx === 'ISSUED'
  })
  const nbPremium = round2(toMoney(nbLike?.premiumTotal || (premiumTimeline.length ? premiumTimeline[0].amount : 0)))
  const currentPolicyPremium = round2(premiumTimeline.length ? premiumTimeline[premiumTimeline.length - 1].cumulativePolicyPremium : 0)
  const netChangeAmount = round2(currentPolicyPremium - nbPremium)
  const endorsementRows = versions.filter((row) => isEndorsementTx(row.transactionType))
  const endorsementCount = endorsementRows.length
  const negativePremiumTransactions = versions.filter((row) => toMoney(row.premiumTotal) < 0).length

  let maxEffectiveSeen = ''
  let outOfSequenceTransactions = 0
  for (const row of versions) {
    const eff = row.effectiveDate
    if (!eff) continue
    if (maxEffectiveSeen && eff < maxEffectiveSeen) outOfSequenceTransactions += 1
    if (!maxEffectiveSeen || eff > maxEffectiveSeen) maxEffectiveSeen = eff
  }

  const changeMagnitudes = versions
    .filter((row) => row !== nbLike)
    .map((row) => Math.abs(toMoney(row.premiumTotal)))
    .filter((value) => value > 0)
  const volatilityRatio = currentPolicyPremium > 0
    ? stddev(changeMagnitudes) / Math.max(1, currentPolicyPremium)
    : (changeMagnitudes.length ? 1 : 0)
  const changeVolatility = clamp01(volatilityRatio)
  const endorsementComplexity = clamp01(
    (endorsementCount * 0.12) + (outOfSequenceTransactions * 0.28) + (negativePremiumTransactions * 0.08)
  )

  const quoteLike = inferQuoteAiInsights(config, {
    payload: latest?.payload || input?.policy?.payload || {},
    premium: {
      total: { amount: currentPolicyPremium, currency },
      fees: { amount: round2(versions.reduce((sum, row) => sum + toMoney(row.premiumFees), 0)), currency },
      taxes: { amount: round2(versions.reduce((sum, row) => sum + toMoney(row.premiumTaxes), 0)), currency },
      byCoverage: []
    },
    underwriting: null
  })

  let retentionRisk = 0.08
  if (!isIssuedLikePolicyStatus(input?.policy?.status)) retentionRisk += 0.12
  if (isCancellationTx(latest?.transactionType)) retentionRisk += 0.7
  retentionRisk += endorsementCount > 3 ? 0.12 : endorsementCount * 0.03
  retentionRisk += outOfSequenceTransactions * 0.1
  retentionRisk += negativePremiumTransactions > 0 ? 0.04 : 0
  retentionRisk += quoteLike.scores.risk * 0.15
  retentionRisk += quoteLike.scores.fraud * 0.2
  retentionRisk = clamp01(retentionRisk)

  const alerts: string[] = []
  const recommendations: string[] = []
  if (outOfSequenceTransactions > 0) {
    alerts.push(`Out-of-sequence transaction activity detected (${outOfSequenceTransactions}).`)
    recommendations.push('Review effective-dated timeline rebasing before finalizing downstream financial reporting.')
  }
  if (negativePremiumTransactions > 0) {
    alerts.push(`Return premium transactions detected (${negativePremiumTransactions}).`)
    recommendations.push('Validate commission clawback and billing adjustments for return premium transactions.')
  }
  if (endorsementCount >= 4) {
    alerts.push('High endorsement activity may indicate policy instability.')
    recommendations.push('Review underwriting intent and renewal strategy due to frequent mid-term changes.')
  }
  if (quoteLike.scores.fraud >= config.thresholds.fraudReview) {
    alerts.push('Fraud score exceeds review threshold for the latest policy state.')
    recommendations.push('Add targeted verification tasks before further policy changes are issued.')
  }
  if (quoteLike.scores.premiumAdequacy < 0.6) {
    recommendations.push('Review pricing adequacy versus current risk profile before renewal or rewrite.')
  }
  if (!recommendations.length) {
    recommendations.push('Policy appears stable; continue standard monitoring of endorsements and renewal readiness.')
  }

  const policyHealthRaw =
    100 -
    (retentionRisk * 35) -
    (changeVolatility * 20) -
    (endorsementComplexity * 25) -
    (quoteLike.scores.fraud * 10) -
    ((1 - quoteLike.scores.premiumAdequacy) * 10)
  const policyHealthScore = Math.round(Math.max(0, Math.min(100, policyHealthRaw)))

  return {
    enabled: config.enabled,
    shadowMode: config.shadowMode,
    provider,
    modelVersion,
    generatedAt,
    policyHealthScore,
    scores: {
      risk: round4(quoteLike.scores.risk),
      fraud: round4(quoteLike.scores.fraud),
      premiumAdequacy: round4(quoteLike.scores.premiumAdequacy),
      retentionRisk: round4(retentionRisk),
      changeVolatility: round4(changeVolatility),
      endorsementComplexity: round4(endorsementComplexity)
    },
    summary: {
      currentPolicyPremium,
      nbPremium,
      netChangeAmount,
      transactionCount: versions.length,
      endorsementCount,
      negativePremiumTransactions,
      outOfSequenceTransactions
    },
    alerts,
    recommendations,
    premiumTimeline
  }
}

export function inferCustomerAiInsights(
  config: TenantAiMlConfig,
  input: {
    customer: {
      entityType?: string
      status?: string
    }
    policies: Array<{
      productCode?: string
      status?: string
      internalStatus?: string
      effectiveDate?: string
      expirationDate?: string
      premiumTotal?: number
    }>
    quotes: Array<{
      productCode?: string
      status?: string
      effectiveDate?: string
      premiumTotal?: number
    }>
    now?: string
  }
): CustomerAiInsights {
  const generatedAt = new Date().toISOString()
  const provider = config.provider || 'internal-baseline'
  const entityType = String(input?.customer?.entityType || '').trim().toUpperCase()
  const modelVersion = entityType === 'COMPANY' || entityType === 'BOTH'
    ? (config.modelVersionByProduct?.cyber || 'customer-intel-v1')
    : (config.modelVersionByProduct?.['personal-auto'] || 'customer-intel-v1')
  const now = new Date(String(input?.now || generatedAt))
  const nowDateOnly = now.toISOString().slice(0, 10)

  const policies = Array.isArray(input?.policies) ? input.policies : []
  const quotes = Array.isArray(input?.quotes) ? input.quotes : []
  const activeStatuses = new Set(['Issued', 'Inforced', 'Bind'])
  const derivedPolicyStatuses = policies.map((item) =>
    derivePolicyWorkflowStatus(item.internalStatus || item.status, item.effectiveDate, item.expirationDate, nowDateOnly)
  )
  const activePolicyCount = derivedPolicyStatuses.filter((status) => activeStatuses.has(status)).length
  const cancelledCount = derivedPolicyStatuses.filter((status) => status === 'Cancelled').length
  const openQuoteCount = quotes.filter((item) => {
    const status = String(item?.status || '').trim().toUpperCase()
    return !['BOUND', 'CONVERTED', 'ISSUED'].includes(status)
  }).length

  const productCounts = new Map<string, number>()
  for (const item of policies) {
    const code = normalizeProductCode(item?.productCode)
    if (!code) continue
    productCounts.set(code, (productCounts.get(code) || 0) + 1)
  }
  const productMix = Array.from(productCounts.entries())
    .map(([productCode, count]) => ({ productCode, count }))
    .sort((a, b) => b.count - a.count || a.productCode.localeCompare(b.productCode))

  const estimatedAnnualPremium = round2(
    policies.reduce((sum, item) => sum + toMoney(item?.premiumTotal), 0)
  )

  const expiringSoon = policies.filter((item, index) => {
    if (!activeStatuses.has(derivedPolicyStatuses[index] || '')) return false
    const exp = new Date(String(item?.expirationDate || ''))
    if (Number.isNaN(exp.getTime())) return false
    const diffDays = Math.round((exp.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    return diffDays >= 0 && diffDays <= 45
  }).length

  let retentionRisk = 0.08
  retentionRisk += activePolicyCount === 0 && policies.length > 0 ? 0.25 : 0
  retentionRisk += cancelledCount > 0 ? Math.min(0.35, cancelledCount * 0.15) : 0
  retentionRisk += expiringSoon > 0 ? Math.min(0.2, expiringSoon * 0.08) : 0
  retentionRisk += openQuoteCount > 2 ? 0.08 : 0
  retentionRisk = clamp01(retentionRisk)

  const serviceComplexity = clamp01(
    (policies.length * 0.06) +
    (openQuoteCount * 0.08) +
    (Math.max(0, productMix.length - 1) * 0.1) +
    ((entityType === 'BOTH') ? 0.15 : 0.05)
  )

  const hasPersonalAuto = productCounts.has('personal-auto')
  const hasHomeowners = productCounts.has('homeowners')
  const hasCyber = productCounts.has('cyber')
  const suggestedProducts: string[] = []
  if (hasPersonalAuto && !hasHomeowners) suggestedProducts.push('homeowners')
  if (hasHomeowners && !hasPersonalAuto) suggestedProducts.push('personal-auto')
  if ((entityType === 'COMPANY' || entityType === 'BOTH') && !hasCyber) suggestedProducts.push('cyber')
  if (!hasPersonalAuto && !hasHomeowners && entityType !== 'COMPANY' && entityType !== 'BOTH') {
    suggestedProducts.push('personal-auto')
  }

  let crossSellOpportunity = 0.05
  crossSellOpportunity += suggestedProducts.length * 0.22
  crossSellOpportunity += activePolicyCount > 0 ? 0.08 : 0
  crossSellOpportunity = clamp01(crossSellOpportunity)

  const alerts: string[] = []
  const recommendations: string[] = []
  if (expiringSoon > 0) {
    alerts.push(`${expiringSoon} active polic${expiringSoon === 1 ? 'y is' : 'ies are'} expiring within 45 days.`)
    recommendations.push('Trigger proactive renewal outreach and retention workflow for expiring policies.')
  }
  if (cancelledCount > 0) {
    alerts.push('Customer has cancellation history.')
    recommendations.push('Review prior cancellation reasons before quoting materially different terms.')
  }
  if (openQuoteCount > 0) {
    recommendations.push('Follow up on open quotes to improve conversion before they stale.')
  }
  if (suggestedProducts.length > 0) {
    recommendations.push(`Cross-sell opportunity detected: ${suggestedProducts.join(', ')}.`)
  }
  if (!recommendations.length) {
    recommendations.push('Customer portfolio is stable; continue standard service and renewal cadence.')
  }

  const customerHealthRaw =
    100 -
    (retentionRisk * 40) -
    (serviceComplexity * 18) +
    (Math.min(1, activePolicyCount / 3) * 8) +
    (Math.min(1, crossSellOpportunity) * 4)
  const customerHealthScore = Math.round(Math.max(0, Math.min(100, customerHealthRaw)))

  return {
    enabled: config.enabled,
    shadowMode: config.shadowMode,
    provider,
    modelVersion,
    generatedAt,
    customerHealthScore,
    scores: {
      retentionRisk: round4(retentionRisk),
      crossSellOpportunity: round4(crossSellOpportunity),
      serviceComplexity: round4(serviceComplexity)
    },
    summary: {
      policyCount: policies.length,
      activePolicyCount,
      openQuoteCount,
      estimatedAnnualPremium,
      productCount: productMix.length
    },
    productMix,
    suggestedProducts,
    alerts,
    recommendations
  }
}

export function inferDashboardAiInsights(
  config: TenantAiMlConfig,
  input: {
    policies: Array<{
      status?: string
      effectiveDate?: string
      expirationDate?: string
      createdAt?: string
      updatedAt?: string
      premiumTotal?: number
    }>
    quotes: Array<{
      status?: string
      effectiveDate?: string
      createdAt?: string
      updatedAt?: string
      premiumTotal?: number
    }>
    now?: string
  }
): DashboardAiInsights {
  const now = new Date(String(input.now || new Date().toISOString()))
  const nowDateOnly = now.toISOString().slice(0, 10)
  const historyMonthKeys = buildHistoricalMonthKeys(now, 6)
  const forecastMonthKeys = buildFutureMonthKeys(now, 3)

  const policies = Array.isArray(input.policies) ? input.policies : []
  const quotes = Array.isArray(input.quotes) ? input.quotes : []

  const policyStatuses = policies.map((item) =>
    derivePolicyWorkflowStatus(item.status, item.effectiveDate, item.expirationDate, nowDateOnly)
  )
  const activePolicyCount = policyStatuses.filter((status) => status === 'Inforced' || status === 'Issued' || status === 'Bind').length
  const cancelledPolicyCount = policyStatuses.filter((status) => status === 'Cancelled').length

  const window90Start = new Date(now)
  window90Start.setUTCDate(window90Start.getUTCDate() - 90)

  const quote90 = quotes.filter((item) => {
    const dateValue = item.effectiveDate || item.updatedAt || item.createdAt
    return withinWindow(dateValue, window90Start, now)
  }).length
  const policy90 = policies.filter((item) => {
    const dateValue = item.effectiveDate || item.updatedAt || item.createdAt
    return withinWindow(dateValue, window90Start, now)
  }).length

  const conversionRate = quote90 > 0 ? Math.min(1, policy90 / quote90) : 0
  const cancellationRate = policies.length > 0 ? cancelledPolicyCount / policies.length : 0
  const openQuotes = quotes.filter((item) => {
    const status = String(item.status || '').trim().toLowerCase()
    return status !== 'converted' && status !== 'issued'
  }).length

  const next30Date = new Date(now)
  next30Date.setUTCDate(next30Date.getUTCDate() + 30)
  const expiringNext30Days = policies.filter((item, index) => {
    if (!['Inforced', 'Issued', 'Bind'].includes(policyStatuses[index] || '')) return false
    return withinWindow(item.expirationDate, now, next30Date)
  }).length

  const policyByMonth = new Map<string, number>()
  const cancellationByMonth = new Map<string, number>()
  for (let i = 0; i < policies.length; i++) {
    const item = policies[i]
    const status = policyStatuses[i]
    const key = monthKey(item.effectiveDate || item.createdAt || item.updatedAt)
    if (!key) continue
    policyByMonth.set(key, (policyByMonth.get(key) || 0) + 1)
    if (status === 'Cancelled') {
      const cancelKey = monthKey(item.updatedAt || item.effectiveDate || item.createdAt)
      if (cancelKey) cancellationByMonth.set(cancelKey, (cancellationByMonth.get(cancelKey) || 0) + 1)
    }
  }

  const quoteByMonth = new Map<string, number>()
  for (const item of quotes) {
    const key = monthKey(item.effectiveDate || item.createdAt || item.updatedAt)
    if (!key) continue
    quoteByMonth.set(key, (quoteByMonth.get(key) || 0) + 1)
  }

  const historical = historyMonthKeys.map((key) => ({
    monthKey: key,
    monthLabel: monthLabel(key),
    quotes: quoteByMonth.get(key) || 0,
    policies: policyByMonth.get(key) || 0,
    cancellations: cancellationByMonth.get(key) || 0
  }))

  const quoteForecast = linearForecast(historical.map((item) => item.quotes), forecastMonthKeys.length)
  const policyForecast = linearForecast(historical.map((item) => item.policies), forecastMonthKeys.length)
  const cancellationForecast = linearForecast(historical.map((item) => item.cancellations), forecastMonthKeys.length)
  const forecast = forecastMonthKeys.map((key, index) => ({
    monthKey: key,
    monthLabel: monthLabel(key),
    projectedQuotes: Math.round(Math.max(0, quoteForecast[index] || 0)),
    projectedPolicies: Math.round(Math.max(0, policyForecast[index] || 0)),
    projectedCancellations: Math.round(Math.max(0, cancellationForecast[index] || 0))
  }))

  const avgPolicyPremium = mean(
    policies.map((item) => toMoney(item.premiumTotal)).filter((value) => value > 0)
  )
  const avgQuotePremium = mean(
    quotes.map((item) => toMoney(item.premiumTotal)).filter((value) => value > 0)
  )
  const premiumBasis = avgPolicyPremium || avgQuotePremium || 0
  const next30Quotes = Math.round(Math.max(0, forecast[0]?.projectedQuotes || 0))
  const next30Policies = Math.round(Math.max(0, forecast[0]?.projectedPolicies || 0))
  const next90Quotes = forecast.reduce((sum, item) => sum + item.projectedQuotes, 0)
  const next90Policies = forecast.reduce((sum, item) => sum + item.projectedPolicies, 0)
  const projected30ConversionRate = next30Quotes > 0 ? next30Policies / next30Quotes : conversionRate
  const projected90ConversionRate = next90Quotes > 0 ? next90Policies / next90Quotes : conversionRate
  const projected30CancellationRate = next30Policies > 0 ? (forecast[0]?.projectedCancellations || 0) / next30Policies : cancellationRate
  const projectedPremium = round2(premiumBasis * next30Policies)

  const portfolioHealthRaw =
    72 +
    conversionRate * 22 -
    cancellationRate * 35 -
    Math.min(18, (expiringNext30Days / Math.max(1, activePolicyCount || policies.length || 1)) * 18) -
    Math.min(10, (openQuotes / Math.max(1, quotes.length || 1)) * 5)
  const portfolioHealthScore = Math.round(Math.max(0, Math.min(100, portfolioHealthRaw)))

  const alerts: string[] = []
  const recommendations: string[] = []
  if (conversionRate < 0.35) {
    alerts.push('Low quote-to-policy conversion observed in the last 90 days.')
    recommendations.push('Review underwriting thresholds and referral turnaround time for high-friction segments.')
  }
  if (cancellationRate > 0.18) {
    alerts.push('Cancellation rate is above the target operating range.')
    recommendations.push('Trigger retention campaigns for policies with payment or eligibility warnings.')
  }
  if (expiringNext30Days > Math.max(10, Math.round(activePolicyCount * 0.25))) {
    alerts.push('High volume of policies expiring in the next 30 days.')
    recommendations.push('Prioritize proactive renewal outreach and bind-ready prechecks.')
  }
  if (projected90ConversionRate < conversionRate * 0.9) {
    alerts.push('Forecast indicates a potential conversion slowdown in the next quarter.')
    recommendations.push('Evaluate pricing competitiveness and producer performance by product/state.')
  }
  if (!alerts.length) {
    recommendations.push('Portfolio trend is stable; continue monitoring conversion and cancellation drivers weekly.')
  }

  return {
    enabled: config.enabled,
    shadowMode: config.shadowMode,
    provider: config.provider || 'internal-baseline',
    modelVersion: config.modelVersionByProduct?.['personal-auto'] || config.modelVersionByProduct?.homeowners || 'baseline-v1',
    generatedAt: new Date().toISOString(),
    portfolioHealthScore,
    conversionRate: round4(clamp01(conversionRate)),
    cancellationRate: round4(clamp01(cancellationRate)),
    expiringNext30Days,
    openQuotes,
    recommendations,
    alerts,
    predictions: {
      next30Days: {
        projectedQuotes: next30Quotes,
        projectedPolicies: next30Policies,
        projectedConversionRate: round4(clamp01(projected30ConversionRate)),
        projectedCancellationRate: round4(clamp01(projected30CancellationRate)),
        projectedPremium
      },
      next90Days: {
        projectedQuotes: Math.round(Math.max(0, next90Quotes)),
        projectedPolicies: Math.round(Math.max(0, next90Policies)),
        projectedConversionRate: round4(clamp01(projected90ConversionRate))
      }
    },
    trend: {
      historical,
      forecast
    }
  }
}
