import fs from 'fs'
import path from 'path'
import YAML from 'yaml'

/**
 * A carrier pack is the versioned set of config files a carrier's developers
 * maintain in their own repository: its products, field metadata, and rating,
 * underwriting and document overrides. It is mounted into a carrier stack and
 * named by CARRIER_PACK_DIR, so customisations live outside the core image
 * and survive a release upgrade.
 *
 *   pack.yaml                          manifest (packFormat, carrier, version)
 *   config.yaml                        enabledProducts + overrides (optional)
 *   products/<code>/coverage.yaml      product packs, same contract as core
 *   products/<code>/rates.yaml
 *   fields/<code>.json                 field metadata per product (optional)
 *   screens/<code>.yaml                risk screen layout and rules (optional)
 *   tables/<name>.yaml                 lookup and reference tables (optional)
 *
 * With CARRIER_PACK_DIR unset nothing here applies and products, overrides
 * and field metadata load from the repository as before.
 */

/** Pack layout version this release reads. Bump when the layout changes incompatibly. */
export const CARRIER_PACK_FORMAT = 1

export const PACK_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/

export type CarrierPackManifest = {
  packFormat: number
  carrier: string
  version: string
  name?: string
}

export type CarrierPack = {
  dir: string
  manifest: CarrierPackManifest
}

export function getCarrierPackDir(): string | null {
  const value = String(process.env.CARRIER_PACK_DIR || '').trim()
  return value ? path.resolve(value) : null
}

/** Reads pack.yaml without judging it; the validator reports what is wrong. */
export function readCarrierPackManifest(dir: string): CarrierPackManifest | null {
  const manifestPath = path.join(dir, 'pack.yaml')
  if (!fs.existsSync(manifestPath)) return null
  const raw = YAML.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (!raw || typeof raw !== 'object') return null
  return {
    packFormat: Number(raw.packFormat),
    carrier: String(raw.carrier ?? '').trim(),
    version: String(raw.version ?? '').trim(),
    name: raw.name == null ? undefined : String(raw.name).trim(),
  }
}

/**
 * The pack this stack runs with, or null when none is configured. Startup
 * validates the pack (assertCarrierPackValid), so readers can rely on it.
 */
export function getActiveCarrierPack(): CarrierPack | null {
  const dir = getCarrierPackDir()
  if (!dir) return null
  let manifest: CarrierPackManifest | null = null
  try {
    manifest = readCarrierPackManifest(dir)
  } catch {
    manifest = null
  }
  if (!manifest) return null
  return { dir, manifest }
}

/** A pack customises exactly one carrier; other tenants never see it. */
export function carrierPackFor(tenantId: string): CarrierPack | null {
  const pack = getActiveCarrierPack()
  if (!pack || pack.manifest.carrier !== String(tenantId || '').trim()) return null
  return pack
}

export function carrierPackProductsDir(pack: CarrierPack): string {
  return path.join(pack.dir, 'products')
}

export function carrierPackConfigPath(pack: CarrierPack): string {
  return path.join(pack.dir, 'config.yaml')
}

export function carrierPackFieldMetaPath(pack: CarrierPack, productCode: string): string {
  return path.join(pack.dir, 'fields', `${productCode}.json`)
}

export function carrierPackScreenPath(pack: CarrierPack, productCode: string): string {
  return path.join(pack.dir, 'screens', `${productCode}.yaml`)
}

export function loadCarrierPackConfig(pack: CarrierPack): any {
  const configPath = carrierPackConfigPath(pack)
  if (!fs.existsSync(configPath)) return {}
  return YAML.parse(fs.readFileSync(configPath, 'utf8')) || {}
}

/**
 * Product codes the pack switches on, or null when it does not restrict the
 * list (no config.yaml, or no enabledProducts in it).
 */
export function carrierPackEnabledProducts(pack: CarrierPack): string[] | null {
  let config: any
  try {
    config = loadCarrierPackConfig(pack)
  } catch {
    return null
  }
  if (!Array.isArray(config?.enabledProducts) || config.enabledProducts.length === 0) return null
  return config.enabledProducts.map((code: unknown) => String(code).trim().toLowerCase()).filter(Boolean)
}
