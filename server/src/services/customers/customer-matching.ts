import { normalizeSensitiveValue } from '../../customerCrypto.js'

export const normalizePhone = (value: any): string => {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

export const normalizeEmail = (value: any): string => String(value || '').trim().toLowerCase()
export const normalizeContactIdentity = (value: any): string => String(value || '').includes('@') ? normalizeEmail(value) : normalizePhone(value)
export const normalizeTextForMatch = (value: any): string => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')

export function normalizeLast4(value: any): string {
  const normalized = normalizeSensitiveValue(value)
  return normalized ? normalized.slice(-4) : ''
}

export function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const pairsA = bigrams(a)
  const pairsB = bigrams(b)
  if (!pairsA.size || !pairsB.size) return 0
  let overlap = 0
  for (const pair of pairsA) if (pairsB.has(pair)) overlap += 1
  return (2 * overlap) / (pairsA.size + pairsB.size)
}

function bigrams(value: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < value.length - 1; i += 1) out.add(value.slice(i, i + 2))
  return out
}

export function computeSearchMatchScore(row: any, input: {
  qText: string; customerKey: string; name: string; phone: string; email: string; taxId: string; externalId: string; address: string
}): number {
  let score = 0
  const key = String(row.customer_key || '').toLowerCase()
  const display = String(row.display_name || row.legal_name || '').toLowerCase()
  const personName = `${String(row.first_name || '')} ${String(row.last_name || '')}`.trim().toLowerCase()
  if (input.customerKey && key.includes(input.customerKey.toLowerCase())) score += 80
  if (input.name && (display.includes(input.name.toLowerCase()) || personName.includes(input.name.toLowerCase()))) score += 60
  if (input.qText && (key.includes(input.qText.toLowerCase()) || display.includes(input.qText.toLowerCase()) || personName.includes(input.qText.toLowerCase()))) score += 45
  if (input.phone) score += 25
  if (input.email) score += 25
  if (input.taxId) score += 20
  if (input.externalId) score += 20
  if (input.address) score += 20
  return Math.min(100, score || 10)
}
