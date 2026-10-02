import { z, ZodError } from 'zod'

const nullableDate = z.preprocess(
  (value) => value instanceof Date ? value.toISOString() : value,
  z.string().min(1).nullable(),
)
const nullableString = z.string().nullable()
const nullableScalar = z.union([z.string(), z.number(), z.boolean(), z.null()])

const termSchema = z.object({
  effectiveDate: nullableDate,
  expirationDate: nullableDate,
}).strict()

const moneySchema = z.object({
  amount: z.number().finite(),
  currency: z.string().min(1),
}).strict()

export const portalPolicySummarySchema = z.object({
  policyId: z.string().min(1),
  policyNumber: z.string().min(1),
  productCode: z.string(),
  status: z.string(),
  term: termSchema,
  premium: moneySchema.nullable(),
  createdAt: nullableDate,
  updatedAt: nullableDate,
}).strict()

export const portalSummaryResponseSchema = z.object({
  customer: z.object({
    customerId: z.string().min(1),
    customerKey: nullableString,
    customerName: nullableString,
    entityType: nullableString,
  }).strict(),
  policies: z.array(portalPolicySummarySchema),
}).strict()

const coverageSchema = z.object({
  code: z.string(),
  label: z.string(),
  selected: z.boolean(),
  limit: nullableScalar,
  deductible: nullableScalar,
  percent: nullableScalar,
}).strict()

const transactionSchema = z.object({
  versionId: z.string(),
  transactionNumber: z.string(),
  transactionType: z.string(),
  transactionEffectiveDate: nullableDate,
  processedAt: nullableDate,
}).strict()

export const portalPolicyDetailResponseSchema = z.object({
  policy: portalPolicySummarySchema,
  declarations: z.object({
    policyNumber: z.string().min(1),
    productCode: z.string(),
    status: z.string(),
    namedInsured: z.string(),
    customerKey: nullableString,
    term: termSchema,
    premium: moneySchema.nullable(),
    transaction: transactionSchema.nullable(),
    coverages: z.array(coverageSchema),
  }).strict(),
  idCard: z.object({
    available: z.boolean(),
    policyNumber: z.string().min(1),
    namedInsured: z.string(),
    term: termSchema,
    vehicles: z.array(z.object({
      index: z.number().int().positive(),
      year: nullableScalar,
      make: nullableScalar,
      model: nullableScalar,
      vin: nullableScalar,
    }).strict()),
    state: nullableString,
  }).strict(),
}).strict()

export const portalDocumentsResponseSchema = z.object({
  documents: z.array(z.object({
    documentId: z.string().min(1),
    displayName: z.string(),
    type: z.string(),
    generatedAt: nullableDate,
    transaction: z.object({
      transactionId: nullableString,
      transactionType: nullableString,
      transactionNumber: nullableString,
    }).strict(),
    forms: z.array(z.object({
      code: nullableString,
      title: nullableString,
      edition: nullableString,
    }).strict()),
    contentId: nullableString,
  }).strict()),
}).strict()

export const portalResponseSchemas = {
  summary: portalSummaryResponseSchema,
  policyDetail: portalPolicyDetailResponseSchema,
  documents: portalDocumentsResponseSchema,
} as const

export type PortalResponseContract = keyof typeof portalResponseSchemas

export class PortalResponseContractError extends Error {
  readonly issues: Array<{ path: string; code: string; message: string }>

  constructor(contract: PortalResponseContract, error: ZodError) {
    super(`Portal response failed the ${contract} contract`)
    this.name = 'PortalResponseContractError'
    this.issues = error.issues.map((issue) => ({
      path: issue.path.join('.') || '/',
      code: issue.code,
      message: issue.message,
    }))
  }
}

export function validatePortalResponse(contract: 'summary', payload: unknown): z.output<typeof portalSummaryResponseSchema>
export function validatePortalResponse(contract: 'policyDetail', payload: unknown): z.output<typeof portalPolicyDetailResponseSchema>
export function validatePortalResponse(contract: 'documents', payload: unknown): z.output<typeof portalDocumentsResponseSchema>
export function validatePortalResponse(contract: PortalResponseContract, payload: unknown):
  | z.output<typeof portalSummaryResponseSchema>
  | z.output<typeof portalPolicyDetailResponseSchema>
  | z.output<typeof portalDocumentsResponseSchema>
export function validatePortalResponse(contract: PortalResponseContract, payload: unknown) {
  try {
    return portalResponseSchemas[contract].parse(payload)
  } catch (error) {
    if (error instanceof ZodError) throw new PortalResponseContractError(contract, error)
    throw error
  }
}
