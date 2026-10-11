type Setup = { underwritingCompanyName?: string; productCode?: string; country?: string; state?: string; effectiveDate?: string; termMonths?: number }

export function validateQuoteSetup(value: Setup): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const [key, label] of Object.entries({ underwritingCompanyName: 'Underwriting company', productCode: 'Product', country: 'Country', state: 'State' })) {
    if (!String(value[key as keyof Setup] || '').trim()) errors[key] = `${label} is required.`
  }
  const date = String(value.effectiveDate || '')
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) errors.effectiveDate = 'Enter a valid effective date.'
  if (!Number.isInteger(value.termMonths) || Number(value.termMonths) <= 0) errors.termMonths = 'Enter a positive term in months.'
  return errors
}
