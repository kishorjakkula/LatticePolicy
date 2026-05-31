// Minimal placeholder validator for MVP; replace with AJV if desired.
export function validateQuote(obj: any): boolean {
  if (!obj) return false
  if (!obj.productCode) return false
  if (!obj.effectiveDate) return false
  if (!obj.termMonths) return false
  if (!obj.applicant) return false
  if (!obj.risks || !Array.isArray(obj.risks) || obj.risks.length === 0) return false
  return true
}
