import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { LookupTable, ProductScreen } from '@lattice-policy/rules'
import { api } from '../../api/client'
import type { Field } from './schema'

/** Homeowners defaults may only be built from homeowners' own configuration. */
export function homeownersDefaultsReady(productCode: string | null | undefined, cfg: any): boolean {
  return productCode === 'homeowners' && cfg?.product === 'homeowners'
}

/** True when a loaded product configuration belongs to the given product. */
export function configMatchesProduct(cfg: any, productCode: string | null | undefined): boolean {
  return Boolean(cfg && productCode && (!cfg.product || cfg.product === productCode))
}

/**
 * Remembers the last request started; a response for an earlier request is
 * stale. Used so a late product configuration never replaces the current one.
 */
export function createLatestGuard() {
  let latest: string | null = null
  return {
    begin(key: string) {
      latest = key
      return () => latest === key
    },
    reset() {
      latest = null
    },
  }
}

/**
 * The product configuration and risk form for the selected product (WP-0002).
 * Loads again only when the product code changes; a response for a product
 * that is no longer selected is ignored, and nothing from the previous product
 * stays visible while the new one loads.
 */
export function useProductConfiguration(productCode: string | null | undefined, options: { formPolicyId?: string; onLoaded?: () => void } = {}) {
  const [cfg, setCfg] = useState<any | null>(null)
  const [riskFields, setRiskFields] = useState<Field[]>([])
  const [riskScreen, setRiskScreen] = useState<ProductScreen | null>(null)
  const [riskTables, setRiskTables] = useState<Record<string, LookupTable>>({})
  const guardRef = useRef(createLatestGuard())
  const requestRef = useRef(0)
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    const guard = guardRef.current
    setCfg(null)
    setRiskFields([])
    setRiskScreen(null)
    setRiskTables({})
    if (!productCode) {
      guard.reset()
      return
    }
    const isCurrent = guard.begin(`${productCode}#${++requestRef.current}`)
    void (async () => {
      try {
        const loaded = await api.getProductConfig(productCode)
        if (isCurrent()) setCfg(loaded)
      } catch {
        // No configuration: the coverage step stays unavailable.
      }
      try {
        const form = await api.getProductForm(productCode, optionsRef.current.formPolicyId || undefined)
        if (!isCurrent()) return
        setRiskFields(form?.fields || [])
        setRiskScreen(form?.screen || null)
        setRiskTables(form?.tables || {})
      } catch {
        // No form: the built-in risk step is used.
      }
      if (isCurrent()) optionsRef.current.onLoaded?.()
    })()
  }, [productCode])

  return { cfg, riskFields, riskScreen, riskTables }
}

/**
 * Applies homeowners default coverages once homeowners' own configuration has
 * loaded. Only defaults built from no selections are recorded as auto-applied,
 * so a reopened quote's saved coverages always count as the agent's (WP-0002).
 */
export function useHomeownersAutoDefaults(args: {
  productCode: string | null | undefined
  cfg: any
  coverages: any[] | undefined
  setCoverages: (coverages: any[]) => void
  buildDefaults: (cfg: any, current: any[]) => any[]
  appliedRef: MutableRefObject<boolean>
  autoDefaultsRef: MutableRefObject<string>
}) {
  const { productCode, cfg, coverages, setCoverages, buildDefaults, appliedRef, autoDefaultsRef } = args
  useEffect(() => {
    if (!homeownersDefaultsReady(productCode, cfg)) return
    const hasSelections = Array.isArray(coverages) && coverages.length > 0
    if (appliedRef.current && hasSelections) return
    const defaults = buildDefaults(cfg, coverages || [])
    appliedRef.current = true
    autoDefaultsRef.current = hasSelections ? '' : JSON.stringify(defaults)
    setCoverages(defaults)
  }, [cfg, productCode, coverages])
}
