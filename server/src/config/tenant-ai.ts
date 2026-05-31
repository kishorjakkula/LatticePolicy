import { getDb, withTenantTx, toRawQuery } from '../db.js'

export type TenantAiMlFeatures = {
  riskScoring: boolean
  fraudDetection: boolean
  premiumOptimization: boolean
  coverageRecommendations: boolean
}

export type TenantAiMlThresholds = {
  riskReferral: number
  fraudReview: number
  premiumVariance: number
}

export type TenantAiMlConfig = {
  enabled: boolean
  shadowMode: boolean
  provider: string
  modelVersionByProduct: Record<string, string>
  features: TenantAiMlFeatures
  thresholds: TenantAiMlThresholds
}

const DEFAULT_AI_ML_CONFIG: TenantAiMlConfig = {
  enabled: false,
  shadowMode: true,
  provider: 'internal-baseline',
  modelVersionByProduct: {
    'personal-auto': 'pa-risk-v1',
    'commercial-auto': 'ca-risk-v1',
    homeowners: 'ho-risk-v1',
    cyber: 'cyber-risk-v1',
    'professional-liability': 'pl-risk-v1'
  },
  features: {
    riskScoring: true,
    fraudDetection: true,
    premiumOptimization: true,
    coverageRecommendations: true
  },
  thresholds: {
    riskReferral: 0.72,
    fraudReview: 0.65,
    premiumVariance: 0.2
  }
}

const memoryTenantAiMlConfig = new Map<string, TenantAiMlConfig>()

function toBoolean(value: any, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value == null) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function toNumber(value: any, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function normalizeProductCode(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
}

export function defaultTenantAiMlConfig(): TenantAiMlConfig {
  return JSON.parse(JSON.stringify(DEFAULT_AI_ML_CONFIG))
}

export function normalizeTenantAiMlConfig(input: any, fallback: TenantAiMlConfig = defaultTenantAiMlConfig()): TenantAiMlConfig {
  const source = input && typeof input === 'object' ? input : {}
  const provider = String(source.provider || fallback.provider || 'internal-baseline').trim() || 'internal-baseline'
  const modelSource = source.modelVersionByProduct && typeof source.modelVersionByProduct === 'object'
    ? source.modelVersionByProduct
    : fallback.modelVersionByProduct
  const modelVersionByProduct: Record<string, string> = {}
  for (const [rawCode, rawVersion] of Object.entries(modelSource || {})) {
    const productCode = normalizeProductCode(rawCode)
    const version = String(rawVersion || '').trim()
    if (!productCode || !version) continue
    modelVersionByProduct[productCode] = version
  }
  for (const [defaultProduct, defaultVersion] of Object.entries(fallback.modelVersionByProduct || {})) {
    if (!modelVersionByProduct[defaultProduct]) {
      modelVersionByProduct[defaultProduct] = defaultVersion
    }
  }

  const featureSource = source.features && typeof source.features === 'object'
    ? source.features
    : fallback.features
  const features: TenantAiMlFeatures = {
    riskScoring: toBoolean(featureSource?.riskScoring, fallback.features.riskScoring),
    fraudDetection: toBoolean(featureSource?.fraudDetection, fallback.features.fraudDetection),
    premiumOptimization: toBoolean(featureSource?.premiumOptimization, fallback.features.premiumOptimization),
    coverageRecommendations: toBoolean(featureSource?.coverageRecommendations, fallback.features.coverageRecommendations)
  }

  const thresholdSource = source.thresholds && typeof source.thresholds === 'object'
    ? source.thresholds
    : fallback.thresholds
  const thresholds: TenantAiMlThresholds = {
    riskReferral: toNumber(thresholdSource?.riskReferral, fallback.thresholds.riskReferral, 0, 1),
    fraudReview: toNumber(thresholdSource?.fraudReview, fallback.thresholds.fraudReview, 0, 1),
    premiumVariance: toNumber(thresholdSource?.premiumVariance, fallback.thresholds.premiumVariance, 0.05, 1)
  }

  return {
    enabled: toBoolean(source.enabled, fallback.enabled),
    shadowMode: toBoolean(source.shadowMode, fallback.shadowMode),
    provider,
    modelVersionByProduct,
    features,
    thresholds
  }
}

export function tenantAiMlConfigFromRow(row: any): TenantAiMlConfig {
  if (!row || typeof row !== 'object') return defaultTenantAiMlConfig()
  let raw = row.ai_ml_config ?? row.aiMlConfig
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      raw = {}
    }
  }
  return normalizeTenantAiMlConfig(raw, defaultTenantAiMlConfig())
}

export function getMemoryTenantAiMlConfig(tenantId: string): TenantAiMlConfig {
  const existing = memoryTenantAiMlConfig.get(tenantId)
  if (existing) return JSON.parse(JSON.stringify(existing))
  const defaults = defaultTenantAiMlConfig()
  memoryTenantAiMlConfig.set(tenantId, defaults)
  return JSON.parse(JSON.stringify(defaults))
}

export function setMemoryTenantAiMlConfig(tenantId: string, input: any): TenantAiMlConfig {
  const current = getMemoryTenantAiMlConfig(tenantId)
  const next = normalizeTenantAiMlConfig(input, current)
  memoryTenantAiMlConfig.set(tenantId, next)
  return JSON.parse(JSON.stringify(next))
}

export async function loadTenantAiMlConfig(tenantId: string): Promise<TenantAiMlConfig> {
  const db = getDb()
  if (!db) return getMemoryTenantAiMlConfig(tenantId)
  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q('SELECT ai_ml_config FROM tenants WHERE tenant_id=$1 LIMIT 1', [tenantId])
    })
    if (!(result.rowCount || 0)) return defaultTenantAiMlConfig()
    return tenantAiMlConfigFromRow(result.rows[0])
  } catch {
    return defaultTenantAiMlConfig()
  }
}
