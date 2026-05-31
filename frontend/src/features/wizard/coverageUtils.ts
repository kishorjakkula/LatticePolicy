const coverageCodeAliases: Record<string, string> = {
  COVA: 'A',
  OTHERSTRUCTURES: 'B',
  PERSONALPROPERTY: 'C',
  LOSSOFUSE: 'D',
  PERSONALLIABILITY: 'E',
  MEDICALPAYMENTS: 'F'
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
