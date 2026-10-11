import { evaluateCondition } from './expression.js'

/**
 * How a carrier pack screen behaves for a given quote: which sections and
 * fields are shown, which are required, and what is wrong with the values.
 * The browser uses it to draw the form and the API uses it to enforce the
 * same rules, so a rule cannot be skipped by calling the API directly.
 */

export type ScreenWidget = 'text' | 'textarea' | 'number' | 'currency' | 'select' | 'radio' | 'checkbox' | 'date'

export type ScreenDataType = 'string' | 'int' | 'number' | 'bool' | 'enum' | 'date'

export type ScreenField = {
  key: string
  label: string
  /** Path of the value on the quote, for example risks.0.floorLevel. */
  path: string
  dataType: ScreenDataType
  widget: ScreenWidget
  required?: boolean
  options?: Array<string | number>
  help?: string
  placeholder?: string
  readOnly?: boolean
  /** Columns the field spans in its section's grid. */
  span?: number
  visibleWhen?: string
  requiredWhen?: string
}

export type ScreenSection = {
  title?: string
  help?: string
  /** Grid columns for the section, 1 to 4. */
  columns?: number
  visibleWhen?: string
  fields: ScreenField[]
}

export type ScreenValidation = {
  /** Must be true for the quote to be accepted. */
  rule: string
  message: string
  /** Field the message is shown against; shown for the whole step when omitted. */
  field?: string
  /** The rule is only checked while this is true. */
  when?: string
}

export type ProductScreen = {
  layout: 'sections' | 'tabs'
  sections: ScreenSection[]
  validations: ScreenValidation[]
}

export type ScreenState = {
  /** Visibility of each section, by position. */
  sections: boolean[]
  fields: Record<string, { visible: boolean; required: boolean }>
  /** One message per field key that has a problem. */
  errors: Record<string, string>
  /** Problems that belong to the step rather than to one field. */
  formErrors: string[]
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

export function getQuoteValue(quote: any, path: string): unknown {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((current: any, key) => (current === null || current === undefined ? undefined : current[key]), quote)
}

/**
 * Names an expression can read:
 *   risk.<field>              the first risk on the quote
 *   quote.state, quote.termMonths, quote.effectiveDate, quote.productCode
 *   applicant.<field>
 *   coverages.<CODE>.selected / .limit / .deductible / .percent
 */
export function buildScreenContext(quote: any): Record<string, unknown> {
  const coverages: Record<string, unknown> = {}
  for (const item of Array.isArray(quote?.coverages) ? quote.coverages : []) {
    const code = String(item?.code || '').trim()
    if (!code) continue
    coverages[code] = {
      selected: item.selected !== false,
      limit: item.limit ?? null,
      deductible: item.deductible ?? null,
      percent: item.percent ?? null,
    }
  }
  const risk = Array.isArray(quote?.risks) && quote.risks[0] && typeof quote.risks[0] === 'object' ? quote.risks[0] : {}
  return {
    risk,
    quote: {
      state: quote?.state ?? null,
      termMonths: quote?.termMonths ?? null,
      effectiveDate: quote?.effectiveDate ?? null,
      productCode: quote?.productCode ?? null,
    },
    applicant: quote?.applicant && typeof quote.applicant === 'object' ? quote.applicant : {},
    coverages,
  }
}

function valueProblem(field: ScreenField, value: unknown): string | null {
  if (field.dataType === 'int' || field.dataType === 'number') {
    const numeric = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numeric)) return 'Enter a number'
    if (field.dataType === 'int' && !Number.isInteger(numeric)) return 'Enter a whole number'
  }
  if (field.dataType === 'enum' && Array.isArray(field.options) && field.options.length > 0) {
    if (!field.options.some((option) => String(option) === String(value))) return 'Choose one of the listed options'
  }
  if (field.dataType === 'bool' && !(typeof value === 'boolean' || value === 'true' || value === 'false')) return 'Choose yes or no'
  if (field.dataType === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return 'Enter a date'
  return null
}

export function evaluateScreen(screen: ProductScreen, quote: any): ScreenState {
  const context = buildScreenContext(quote)
  const state: ScreenState = { sections: [], fields: {}, errors: {}, formErrors: [] }

  for (const section of screen.sections) {
    const sectionVisible = evaluateCondition(section.visibleWhen, context, true)
    state.sections.push(sectionVisible)
    for (const field of section.fields) {
      const visible = sectionVisible && evaluateCondition(field.visibleWhen, context, true)
      const required = visible && (field.required === true || evaluateCondition(field.requiredWhen, context, false))
      state.fields[field.key] = { visible, required }
      // A hidden field is not the user's to fix, so it is never reported.
      if (!visible) continue
      const value = getQuoteValue(quote, field.path)
      if (isBlank(value)) {
        // An unticked checkbox is an answer, not a blank.
        if (required && field.widget !== 'checkbox') state.errors[field.key] = 'Required'
        continue
      }
      const problem = valueProblem(field, value)
      if (problem) state.errors[field.key] = problem
    }
  }

  for (const validation of screen.validations) {
    if (!evaluateCondition(validation.when, context, true)) continue
    if (evaluateCondition(validation.rule, context, true)) continue
    const target = validation.field ? state.fields[validation.field] : undefined
    if (validation.field && target?.visible) {
      if (!state.errors[validation.field]) state.errors[validation.field] = validation.message
    } else if (!validation.field) {
      state.formErrors.push(validation.message)
    }
    // A rule pinned to a hidden field does not apply while it is hidden.
  }

  return state
}
