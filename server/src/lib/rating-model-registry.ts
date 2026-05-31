import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, and, desc } from 'drizzle-orm'
import { getDb, withTenantTx } from '../db.js'
import { ratingModels, ratingModelVersions, tenants } from '../schema.js'
import * as schema from '../schema.js'

export type PublishedRatingModelSnapshot = {
  tenantId: string
  modelId: string
  modelCode: string
  productCode: string
  stateCode: string
  programName: string
  status: string
  versionId: string
  versionLabel: string
  workbookJson: Record<string, any> | null
  parserSummary: Record<string, any> | null
  metadata: Record<string, any> | null
  publishedAt: string
  updatedAt: string
}

const tenantCache = new Map<string, PublishedRatingModelSnapshot[]>()

function normalizeProductCode(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

function normalizeStateCode(value: any): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3)
}

function toIso(value: any): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  const text = String(value || '').trim()
  if (!text) return ''
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString()
}

function mapPublishedRow(tenantId: string, row: {
  modelId: string | null
  modelCode: string | null
  productCode: string | null
  stateCode: string | null
  programName: string | null
  status: string | null
  rmUpdatedAt: Date | null
  versionId: string | null
  versionLabel: string | null
  workbookJson: unknown
  parserSummary: unknown
  metadata: unknown
  publishedAt: Date | null
  rvUpdatedAt: Date | null
}): PublishedRatingModelSnapshot {
  return {
    tenantId,
    modelId: String(row.modelId),
    modelCode: String(row.modelCode || ''),
    productCode: normalizeProductCode(row.productCode),
    stateCode: normalizeStateCode(row.stateCode),
    programName: String(row.programName || ''),
    status: String(row.status || 'DRAFT'),
    versionId: String(row.versionId),
    versionLabel: String(row.versionLabel || ''),
    workbookJson: row.workbookJson && typeof row.workbookJson === 'object' ? row.workbookJson as Record<string, any> : null,
    parserSummary: row.parserSummary && typeof row.parserSummary === 'object' ? row.parserSummary as Record<string, any> : null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, any> : null,
    publishedAt: toIso(row.publishedAt || row.rvUpdatedAt || row.rmUpdatedAt),
    updatedAt: toIso(row.rvUpdatedAt || row.rmUpdatedAt)
  }
}

export function getPublishedRatingModelForProduct(
  tenantId: string,
  productCode: string,
  stateCode?: string
): PublishedRatingModelSnapshot | null {
  const product = normalizeProductCode(productCode)
  if (!product) return null
  const state = normalizeStateCode(stateCode)
  const rows = tenantCache.get(tenantId) || []
  const candidates = rows.filter((row) => row.productCode === product)
  if (!candidates.length) return null

  const exactState = state ? candidates.find((row) => row.stateCode === state) : null
  if (exactState) return exactState

  const noState = candidates.find((row) => !row.stateCode)
  if (noState) return noState

  return candidates[0] || null
}

export function getCachedPublishedRatingModels(tenantId: string): PublishedRatingModelSnapshot[] {
  return [...(tenantCache.get(tenantId) || [])]
}

export async function refreshTenantPublishedRatingModelCache(tenantId: string): Promise<void> {
  const pool = getDb()
  if (!pool) {
    tenantCache.delete(tenantId)
    return
  }
  const rows = await withTenantTx(tenantId, async (db) => {
    return db
      .select({
        modelId: ratingModels.modelId,
        modelCode: ratingModels.modelCode,
        productCode: ratingModels.productCode,
        stateCode: ratingModels.stateCode,
        programName: ratingModels.programName,
        status: ratingModels.status,
        rmUpdatedAt: ratingModels.updatedAt,
        versionId: ratingModelVersions.versionId,
        versionLabel: ratingModelVersions.versionLabel,
        workbookJson: ratingModelVersions.workbookJson,
        parserSummary: ratingModelVersions.parserSummary,
        metadata: ratingModelVersions.metadata,
        publishedAt: ratingModelVersions.publishedAt,
        rvUpdatedAt: ratingModelVersions.updatedAt,
      })
      .from(ratingModels)
      .innerJoin(ratingModelVersions, and(
        eq(ratingModelVersions.tenantId, ratingModels.tenantId),
        eq(ratingModelVersions.modelId, ratingModels.modelId)
      ))
      .where(and(
        eq(ratingModels.tenantId, tenantId),
        eq(ratingModelVersions.isActive, true),
        eq(ratingModelVersions.publishStatus, 'PUBLISHED')
      ))
      .orderBy(desc(ratingModelVersions.publishedAt), ratingModels.modelCode)
  })

  const mapped = rows.map(row => mapPublishedRow(tenantId, row as any))
  tenantCache.set(tenantId, mapped)
}

export async function warmPublishedRatingModelCache(): Promise<void> {
  const pool = getDb()
  if (!pool) return
  const db = drizzle(pool, { schema })
  const tenantRows = await db
    .select({ tenantId: tenants.tenantId })
    .from(tenants)
  const tenantIds = tenantRows.map(row => String(row.tenantId || '')).filter(Boolean)
  for (const tenantId of tenantIds) {
    try {
      await refreshTenantPublishedRatingModelCache(tenantId)
    } catch {
      // Non-blocking cache warm path.
    }
  }
}
