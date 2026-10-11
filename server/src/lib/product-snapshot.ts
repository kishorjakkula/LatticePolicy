import crypto from 'crypto'
import { BadRequestError } from '../errors/domain.errors.js'
import type { LookupTable, ProductScreen } from '@lattice-policy/rules'
import { getDb, toRawQuery, withTenantTx } from '../db.js'
import { getBuildInfo } from '../version.js'
import { carrierPackFor } from './carrier-pack.js'
import { getProductCapabilities } from './product-registry.js'
import { loadProductConfig, loadProductRates, loadRiskScreen, loadTenantOverrides, mergeRates } from './products.js'
import { getPublishedRatingModelForProduct } from './rating-model-registry.js'
import { loadCarrierTables } from './carrier-tables.js'
import { tablesUsedByScreen } from './product-screen.js'
import { tablesUsedByRates } from './rating-table.js'

/**
 * The product definition a policy term is written on: its rates (with the
 * carrier's overrides applied), product config, screen rules, rating adapter,
 * and any published rating workbook in force. Captured when a term starts
 * (new business, renewal, rewrite) and referenced from the policy payload as
 * `productSnapshot`, so every later transaction in that term is rated and
 * checked against the same definition, whatever has changed since.
 *
 * Snapshots are immutable and addressed by a hash of their content, so a
 * process may cache them for as long as it runs.
 */

export type ProductDefinition = {
  ratingAdapter: string
  rates: any
  config: any
  screen: ProductScreen | null
  /** The carrier lookup tables this product's rating and rules read. */
  tables?: Record<string, LookupTable>
  /** The published rating workbook in force for the product and state, if any. */
  publishedModel: any | null
}

export type ProductSnapshotSource = {
  releaseVersion: string
  packVersion: string | null
  ratingModelVersionId: string | null
}

export type ProductSnapshot = {
  id: string
  tenantId: string
  productCode: string
  hash: string
  source: ProductSnapshotSource
  definition: ProductDefinition
}

/** What a policy payload carries to name its snapshot. */
export type ProductSnapshotRef = { id: string; hash: string; packVersion: string | null; releaseVersion: string }

const byId = new Map<string, ProductSnapshot>()
const idByKey = new Map<string, string>()

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function hashOf(definition: ProductDefinition): string {
  return crypto.createHash('sha256').update(stableStringify(definition)).digest('hex')
}

function cacheKey(tenantId: string, id: string): string {
  return JSON.stringify([tenantId, id])
}

function remember(snapshot: ProductSnapshot): ProductSnapshot {
  byId.set(cacheKey(snapshot.tenantId, snapshot.id), snapshot)
  idByKey.set(`${snapshot.tenantId}|${snapshot.productCode}|${snapshot.hash}`, snapshot.id)
  return snapshot
}

/** The product as it is defined right now for this carrier, or null for an unknown product. */
export function currentProductDefinition(tenantId: string, productCode: string, stateCode?: string): ProductDefinition | null {
  const code = String(productCode || '').trim().toLowerCase()
  const descriptor = code ? getProductCapabilities(code) : null
  if (!descriptor) return null
  const config = loadProductConfig(code)
  const publishedModel = getPublishedRatingModelForProduct(tenantId, code, stateCode)
  const rates = mergeRates(loadProductRates(code).rates, loadTenantOverrides(tenantId))
  const screen = loadRiskScreen(code, config, tenantId)
  // Only the tables this product reads, so an unrelated table change does not
  // make a new version of every product.
  const allTables = loadCarrierTables(tenantId)
  const tables: Record<string, LookupTable> = screen ? tablesUsedByScreen(screen, allTables) : {}
  for (const name of tablesUsedByRates(rates)) if (allTables[name]) tables[name] = allTables[name]
  return {
    ratingAdapter: descriptor.ratingAdapter,
    rates,
    config,
    screen,
    ...(Object.keys(tables).length ? { tables } : {}),
    // Timestamps on the registry row are not part of the definition.
    publishedModel: publishedModel
      ? { modelId: publishedModel.modelId, modelCode: publishedModel.modelCode, versionId: publishedModel.versionId, versionLabel: publishedModel.versionLabel, stateCode: publishedModel.stateCode, workbookJson: publishedModel.workbookJson }
      : null,
  }
}

export function snapshotRef(snapshot: ProductSnapshot): ProductSnapshotRef {
  return { id: snapshot.id, hash: snapshot.hash, packVersion: snapshot.source.packVersion, releaseVersion: snapshot.source.releaseVersion }
}

/** The snapshot id a payload names, if it names one. */
export function snapshotIdOf(payload: any): string | null {
  const id = payload?.productSnapshot?.id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

/** Cached definitions are usable only by their owning tenant and product. */
export function getLoadedSnapshot(tenantId: string, id: string | null | undefined, productCode: string): ProductSnapshot | null {
  const snapshot = id ? byId.get(cacheKey(tenantId, id)) : null
  const code = String(productCode || '').trim().toLowerCase()
  return snapshot && snapshot.tenantId === tenantId && snapshot.productCode === code ? snapshot : null
}

/** Fail closed for an unavailable pin, including tenant or product mismatches. */
export function requireLoadedSnapshot(tenantId: string, payload: any): ProductSnapshot | null {
  const id = snapshotIdOf(payload)
  if (!id) return null
  const snapshot = getLoadedSnapshot(tenantId, id, payload?.productCode)
  if (!snapshot) {
    throw new BadRequestError(
      'PRODUCT_VERSION_NOT_LOADED',
      'The product version this policy was written on is not available.',
      { productCode: payload?.productCode, productSnapshotId: id },
    )
  }
  return snapshot
}

/**
 * Records the product's current definition and returns its snapshot. Calling
 * it again while nothing has changed returns the same snapshot.
 */
export async function captureProductSnapshot(tenantId: string, productCode: string, stateCode?: string): Promise<ProductSnapshot | null> {
  const code = String(productCode || '').trim().toLowerCase()
  const definition = currentProductDefinition(tenantId, code, stateCode)
  if (!definition) return null
  const hash = hashOf(definition)
  const known = getLoadedSnapshot(tenantId, idByKey.get(`${tenantId}|${code}|${hash}`), code)
  if (known) return known

  const source: ProductSnapshotSource = {
    releaseVersion: getBuildInfo().version,
    packVersion: carrierPackFor(tenantId)?.manifest.version ?? null,
    ratingModelVersionId: definition.publishedModel?.versionId ?? null,
  }
  if (!getDb()) {
    // No database: the snapshot lives for the life of the process, like the rest of in-memory mode.
    const memoryId = crypto.createHash('sha256').update(JSON.stringify([tenantId, code, hash])).digest('hex').slice(0, 32)
    return remember({ id: `mem-${memoryId}`, tenantId, productCode: code, hash, source, definition })
  }
  const result = await withTenantTx(tenantId, (db) =>
    toRawQuery(db)(
      `INSERT INTO product_snapshots (tenant_id, product_code, content_hash, source, definition)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (tenant_id, product_code, content_hash) DO UPDATE SET content_hash = EXCLUDED.content_hash
       RETURNING snapshot_id, source, definition`,
      [tenantId, code, hash, JSON.stringify(source), JSON.stringify(definition)]
    )
  )
  const row = result.rows[0]
  // Keep what is stored, so every process rates from identical content.
  return remember({ id: String(row.snapshot_id), tenantId, productCode: code, hash, source: row.source, definition: row.definition })
}

/**
 * Loads the snapshots the given payloads name, so the synchronous rating and
 * rule checks that follow can use them. Call it at the start of anything that
 * rates or checks a stored payload.
 */
export async function ensureProductSnapshots(tenantId: string, payloads: any[]): Promise<void> {
  const missing = Array.from(new Set(payloads
    .filter((payload) => !getLoadedSnapshot(tenantId, snapshotIdOf(payload), payload?.productCode))
    .map(snapshotIdOf)
    .filter((id): id is string => Boolean(id))))
    .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
  if (missing.length > 0 && getDb()) {
    const result = await withTenantTx(tenantId, (db) =>
      toRawQuery(db)(
        'SELECT snapshot_id, product_code, content_hash, source, definition FROM product_snapshots WHERE tenant_id = $1 AND snapshot_id = ANY($2::uuid[])',
        [tenantId, missing]
      )
    )
    for (const row of result.rows) {
      remember({ id: String(row.snapshot_id), tenantId, productCode: row.product_code, hash: row.content_hash, source: row.source, definition: row.definition })
    }
  }
  // A cache hit must satisfy the same ownership checks as a database read.
  // Never silently substitute current rules for a missing or foreign pin.
  for (const payload of payloads) requireLoadedSnapshot(tenantId, payload)
}

/** Pins a payload to the product as it is defined now. Used when a term starts. */
export async function pinToCurrentProduct(tenantId: string, payload: any): Promise<ProductSnapshot | null> {
  const snapshot = await captureProductSnapshot(tenantId, payload?.productCode, payload?.state)
  if (snapshot) payload.productSnapshot = snapshotRef(snapshot)
  else delete payload.productSnapshot
  return snapshot
}

/**
 * Keeps a mid-term payload on the snapshot its term was written on. The pin
 * always comes from the stored policy, never from what a client sent.
 */
export function carryProductPin(payload: any, termPayload: any): void {
  if (!payload || typeof payload !== 'object') return
  if (termPayload?.productSnapshot) payload.productSnapshot = JSON.parse(JSON.stringify(termPayload.productSnapshot))
  else delete payload.productSnapshot
}

/** Test hook. */
export function clearProductSnapshotCache() {
  byId.clear()
  idByKey.clear()
}
