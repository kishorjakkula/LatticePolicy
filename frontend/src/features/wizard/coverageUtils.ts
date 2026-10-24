const coverageCodeAliases: Record<string, string> = {
  COVA: 'A',
  OTHERSTRUCTURES: 'B',
  PERSONALPROPERTY: 'C',
  LOSSOFUSE: 'D',
  PERSONALLIABILITY: 'E',
  MEDICALPAYMENTS: 'F'
}

export function createCoverageSelection(coverage: any): any {
  const selection: any = { code: coverage.code, selected: true }
  const limit = coverage.defaultLimit ?? coverage.limits?.[0]
  if (limit !== undefined) selection.limit = limit
  const deductible = coverage.defaultDeductible ?? coverage.deductibles?.[0]
  if (deductible !== undefined) selection.deductible = deductible
  if (coverage.percentOptions?.length) selection.percent = coverage.percentOptions[0]
  return selection
}

export function hasDeclaredCoverageDefaults(config: any): boolean {
  const coverages: any[] = Array.isArray(config?.coverages) ? config.coverages : []
  return coverages.some(coverage => coverage.required !== undefined || coverage.defaultSelected !== undefined)
}

export function buildGenericCoverageDefaults(config: any): any[] {
  const coverages: any[] = Array.isArray(config?.coverages) ? config.coverages : []
  const explicitDefaults = hasDeclaredCoverageDefaults(config)
  return coverages.filter(coverage => !explicitDefaults || coverage.required || coverage.defaultSelected || coverage.selectable === false)
    .map(createCoverageSelection)
}

function normalizeCoverageCode(value?: string): string | null {
  if (!value) return null
  const cleaned = value.replace(/[^0-9A-Za-z]/g, '')
  if (!cleaned) return null
  const upper = cleaned.toUpperCase()
  return coverageCodeAliases[upper] || value
}

function normalizeCoverageEntry(entry: any): any | null {
  if (!entry) return null
  const rawCode = entry.code || entry.coverageCode || entry.definitionCode
  const code = normalizeCoverageCode(rawCode)
  if (!code) return null
  const limit = entry.limit ?? entry.limitValue ?? entry.limits?.limit ?? entry.limits?.amount ?? null
  const deductible = entry.deductible ?? entry.deductibles?.deductible ?? entry.deductibles?.amount ?? null
  const percent = entry.percent ?? entry.options?.percent ?? null
  return {
    ...entry,
    code,
    selected: entry.selected !== false,
    limit,
    deductible,
    percent
  }
}

export function normalizeCoverages(list?: any[]): any[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const normalized: any[] = []
  for (const entry of list) {
    const next = normalizeCoverageEntry(entry)
    if (!next) continue
    if (seen.has(next.code)) continue
    seen.add(next.code)
    normalized.push(next)
  }
  return normalized
}

export function normalizePayloadCoverages(payload?: any): any {
  if (!payload) return payload
  const coverages = normalizeCoverages(payload.coverages)
  if (coverages.length === 0 && !Array.isArray(payload.coverages)) return payload
  return { ...payload, coverages }
}
