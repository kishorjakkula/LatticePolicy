import { createHash } from 'node:crypto'
import { asDateOnly } from './date.utils.js'

export interface ReferralProposalInput {
  payload: unknown
  premium: unknown
  baseVersion: unknown
  underwriting: unknown
  authority: unknown
}

export function canonicalProposal(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalProposal).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalProposal(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

const digest = (value: unknown) => createHash('sha256').update(canonicalProposal(value)).digest('hex')
const PRIVATE_FIELD = /password|secret|token|authorization|cookie|api.?key|buffer|base64|file.?content|document.?content|model.?input|prompt|documents|attachments/i

// Keep arbitrary carrier business fields, but never copy credentials or document
// bytes into a second store. Their digest still invalidates a changed proposal.
function reviewValue(value: unknown, key = ''): unknown {
  if (PRIVATE_FIELD.test(key) || Buffer.isBuffer(value)) return { redactedSha256: digest(value) }
  if (Array.isArray(value)) return value.map(item => reviewValue(item))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).map(([k, v]) => [k, reviewValue(v, k)]))
  return value ?? null
}

export function referralProposalEvidence(tenantId: string, context: {
  quoteId?: string | null; policyId?: string | null; transactionType: string
  productCode?: string | null; agencyId?: string | null; insuredName?: string | null
  effectiveDate?: string | null; reasons: string[]; proposal?: ReferralProposalInput
}) {
  if (!context.proposal) return { proposalHash: null, proposalSnapshot: null }
  const premium = context.proposal.premium as any
  const snapshot = {
    schemaVersion: 1,
    tenantId, quoteId: context.quoteId || null, policyId: context.policyId || null,
    productCode: context.productCode || null, agencyId: context.agencyId || null,
    insuredName: context.insuredName || null, transactionType: context.transactionType,
    effectiveDate: asDateOnly(context.effectiveDate), reasons: [...new Set(context.reasons)].sort(),
    baseVersion: reviewValue(context.proposal.baseVersion),
    payload: reviewValue(context.proposal.payload),
    // Calculation traces may include timings/diagnostics, not reviewable money.
    premium: reviewValue({ total: premium?.total, fees: premium?.fees, taxes: premium?.taxes,
      byCoverage: premium?.byCoverage, discounts: premium?.discounts, surcharges: premium?.surcharges }),
    underwriting: reviewValue(context.proposal.underwriting), authority: reviewValue(context.proposal.authority),
  }
  return { proposalHash: digest(snapshot), proposalSnapshot: snapshot }
}
