import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import type { ProductCapabilityDescriptor, ProductTransactionCapability } from '@lattice-policy/types'
import { BadRequestError, NotFoundError } from '../errors/domain.errors.js'
import { carrierPackEnabledProducts, carrierPackProductsDir, getActiveCarrierPack, PACK_SLUG_PATTERN } from './carrier-pack.js'

/**
 * Adapters rating.service.ts can execute, plus the explicit "not quotable"
 * marker. `rate-table` prices a product entirely from its rates.yaml
 * (lib/rating-table.ts) and is what a carrier pack product should use.
 */
export const RATING_ADAPTERS = ['rate-table', 'personal-auto', 'commercial-auto', 'cyber', 'professional-liability', 'homeowners', 'unsupported'] as const

const allowedTransactions = new Set<ProductTransactionCapability>([
  'quote', 'bind', 'issue', 'endorse', 'cancel', 'reinstate', 'rewrite', 'renew', 'nonRenew',
])

export function resolveCoreProductsDir(): string {
  const candidates = [path.resolve(process.cwd(), 'products'), path.resolve(process.cwd(), '../products')]
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
}

function readCoverageFile(productDir: string): any {
  const coveragePath = path.join(productDir, 'coverage.yaml')
  if (!fs.existsSync(coveragePath)) return null
  return YAML.parse(fs.readFileSync(coveragePath, 'utf8'))
}

export function parseProductDescriptor(raw: any, directoryCode: string): ProductCapabilityDescriptor {
  const code = String(raw?.product || '').trim().toLowerCase()
  if (!code || code !== directoryCode) {
    throw new Error(`Product pack '${directoryCode}' must declare product: ${directoryCode}`)
  }
  const capabilities = raw?.capabilities
  if (!capabilities || typeof capabilities !== 'object') {
    throw new Error(`Product pack '${code}' is missing capabilities metadata`)
  }
  const transactions = Array.isArray(capabilities.supportedTransactions)
    ? capabilities.supportedTransactions.map((value: unknown) => String(value))
    : []
  const invalidTransaction = transactions.find((value: string) => !allowedTransactions.has(value as ProductTransactionCapability))
  if (invalidTransaction) throw new Error(`Product pack '${code}' has unsupported transaction '${invalidTransaction}'`)
  const ratingAdapter = String(capabilities.ratingAdapter || '').trim()
  if (!ratingAdapter) throw new Error(`Product pack '${code}' is missing ratingAdapter`)

  return {
    code,
    version: String(raw.version || '1.0.0'),
    label: String(capabilities.label || code),
    riskLabel: String(capabilities.riskLabel || 'Risk'),
    ratingAdapter,
    formsMode: capabilities.formsMode === 'none' ? 'none' : 'catalog',
    supportedTransactions: transactions as ProductTransactionCapability[],
    riskKinds: capabilities.riskKinds && typeof capabilities.riskKinds === 'object' ? capabilities.riskKinds : {},
    defaultRisk: capabilities.defaultRisk && typeof capabilities.defaultRisk === 'object' ? capabilities.defaultRisk : {},
    ui: capabilities.ui && typeof capabilities.ui === 'object' ? capabilities.ui : {},
  }
}

function listProductDirectories(productsDir: string): Array<{ code: string; dir: string }> {
  if (!fs.existsSync(productsDir)) return []
  return fs.readdirSync(productsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ code: entry.name, dir: path.join(productsDir, entry.name) }))
}

/**
 * Every product pack directory this stack can see: the core products, then
 * any the carrier pack adds. A carrier pack cannot replace a core product
 * (the pack validator rejects the collision), so core wins if one slips by.
 */
export function listProductPackDirs(): Array<{ code: string; dir: string; source: 'core' | 'carrier-pack' }> {
  const core = listProductDirectories(resolveCoreProductsDir()).map((entry) => ({ ...entry, source: 'core' as const }))
  const pack = getActiveCarrierPack()
  if (!pack) return core
  const coreCodes = new Set(core.map((entry) => entry.code))
  const added = listProductDirectories(carrierPackProductsDir(pack))
    .filter((entry) => PACK_SLUG_PATTERN.test(entry.code) && !coreCodes.has(entry.code))
    .map((entry) => ({ ...entry, source: 'carrier-pack' as const }))
  return [...core, ...added]
}

/** Directory holding a product's coverage.yaml and rates.yaml, or null when the product is unknown. */
export function resolveProductPackDir(code: string): string | null {
  const normalized = String(code || '').trim().toLowerCase()
  return listProductPackDirs().find((entry) => entry.code === normalized)?.dir || null
}

export function listProductCapabilities(): ProductCapabilityDescriptor[] {
  const pack = getActiveCarrierPack()
  // A carrier pack that lists enabledProducts decides what this stack sells.
  const enabled = pack ? carrierPackEnabledProducts(pack) : null
  return listProductPackDirs()
    .filter((entry) => !enabled || enabled.includes(entry.code))
    .map((entry) => ({ code: entry.code, raw: readCoverageFile(entry.dir) }))
    .filter((entry) => entry.raw)
    .map((entry) => parseProductDescriptor(entry.raw, entry.code))
    .sort((left, right) => left.label.localeCompare(right.label))
}

export function getProductCapabilities(code: string): ProductCapabilityDescriptor | null {
  const normalized = String(code || '').trim().toLowerCase()
  return listProductCapabilities().find((entry) => entry.code === normalized) || null
}

export function requireProductCapabilities(code: string): ProductCapabilityDescriptor {
  const descriptor = getProductCapabilities(code)
  if (!descriptor) throw new NotFoundError('PRODUCT_NOT_FOUND', `Product '${code}' was not found.`)
  return descriptor
}

export function requireProductCapability(code: string, transaction: ProductTransactionCapability): ProductCapabilityDescriptor {
  const descriptor = requireProductCapabilities(code)
  if (!descriptor.supportedTransactions.includes(transaction)) {
    throw new BadRequestError(
      'PRODUCT_CAPABILITY_UNSUPPORTED',
      `Product '${descriptor.code}' does not support '${transaction}'.`,
      { productCode: descriptor.code, capability: transaction },
    )
  }
  return descriptor
}

export function mapProductRiskKind(productCode: string | undefined, risk: any): string {
  const riskType = String(risk?.type || '').trim()
  const descriptor = getProductCapabilities(String(productCode || ''))
  return descriptor?.riskKinds?.[riskType] || riskType || 'Unknown'
}
