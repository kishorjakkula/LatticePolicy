import type { IntakeTargetField } from './target-fields.js'

/**
 * Turns a value as written in a document into the form the quote stores:
 * ISO dates, plain numbers, an option from the field's list, two-letter
 * state codes. `ok` is false when the text could not be converted cleanly;
 * the extractor then lowers its confidence instead of guessing.
 */

const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}
const STATE_CODES = new Set(Object.values(US_STATES))

const STATE_KEYS = new Set(['state', 'addressState'])

export type Normalized = { value: string; ok: boolean }

function normalizeDate(raw: string): Normalized {
  const text = raw.trim()
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text)
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]), text)
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(text)
  if (match) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
    return validDate(year, Number(match[1]), Number(match[2]), text)
  }
  const parsed = Date.parse(text)
  if (!Number.isNaN(parsed) && /[a-z]/i.test(text) && /\d{4}/.test(text)) {
    const date = new Date(parsed)
    return validDate(date.getFullYear(), date.getMonth() + 1, date.getDate(), text)
  }
  return { value: text, ok: false }
}

function validDate(year: number, month: number, day: number, original: string): Normalized {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { value: original, ok: false }
  }
  return { value: date.toISOString().slice(0, 10), ok: true }
}

function normalizeNumber(raw: string): Normalized {
  const text = raw.trim()
  const match = /-?\$?\s*\d[\d,]*(\.\d+)?\s*([kKmM])?\b/.exec(text)
  if (!match) return { value: text, ok: false }
  let number = Number(match[0].replace(/[$,\s]/g, '').replace(/[kKmM]$/, ''))
  if (/[kK]$/.test(match[0])) number *= 1000
  if (/[mM]$/.test(match[0])) number *= 1000000
  if (!Number.isFinite(number)) return { value: text, ok: false }
  return { value: String(number), ok: true }
}

const YES = new Set(['yes', 'y', 'true'])
const NO = new Set(['no', 'n', 'false'])

function normalizeOption(raw: string, options: string[]): Normalized {
  const text = raw.trim()
  const lower = text.toLowerCase()
  const slug = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const squashed = lower.replace(/[^a-z0-9]+/g, '')
  const exact = options.find((option) => option.toLowerCase() === lower || option.toLowerCase() === slug || option.toLowerCase().replace(/[^a-z0-9]+/g, '') === squashed)
  if (exact) return { value: exact, ok: true }
  // Yes/no answers for true/false fields.
  const lowered = options.map((option) => option.toLowerCase())
  if (lowered.includes('true') && YES.has(lower)) return { value: options[lowered.indexOf('true')], ok: true }
  if (lowered.includes('false') && NO.has(lower)) return { value: options[lowered.indexOf('false')], ok: true }
  const contained = options.filter((option) => {
    const words = option.toLowerCase().replace(/-/g, ' ')
    return lower.includes(words) || words.includes(lower)
  })
  if (contained.length === 1) return { value: contained[0], ok: true }
  return { value: text, ok: false }
}

export function normalizeStateCode(raw: string): Normalized {
  const text = raw.trim()
  const upper = text.toUpperCase()
  if (STATE_CODES.has(upper)) return { value: upper, ok: true }
  const named = US_STATES[text.toLowerCase()]
  if (named) return { value: named, ok: true }
  return { value: text, ok: false }
}

export function normalizeFieldValue(field: Pick<IntakeTargetField, 'key' | 'type' | 'options'>, raw: unknown): Normalized {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return { value: '', ok: false }
  if (STATE_KEYS.has(field.key)) return normalizeStateCode(text)
  if (field.type === 'date') return normalizeDate(text)
  if (field.type === 'number') return normalizeNumber(text)
  if (field.type === 'select' && field.options.length) return normalizeOption(text, field.options)
  return { value: text, ok: true }
}

/** Case- and whitespace-insensitive "does this line contain that quote". */
export function textContains(haystack: string, needle: string): boolean {
  const squash = (value: string) => value.toLowerCase().replace(/[\s"'`“”‘’]+/g, ' ').trim()
  const target = squash(needle)
  return target.length > 0 && squash(haystack).includes(target)
}
