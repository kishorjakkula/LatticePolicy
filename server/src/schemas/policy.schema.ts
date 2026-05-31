import { z } from 'zod'
import { DateOnlySchema } from './common.schema.js'

export const EndorsePolicySchema = z.object({
  effectiveDate: DateOnlySchema.optional(),
  reason: z.string().optional(),
  notes: z.string().optional(),
  changes: z.array(z.object({
    path: z.string(),
    op: z.enum(['add', 'replace', 'remove']),
    value: z.unknown().optional(),
  })).optional(),
}).passthrough()

export const CancelPolicySchema = z.object({
  effectiveDate: DateOnlySchema,
  reasonCode: z.string().optional(),
  reason: z.string().optional(),
}).passthrough()

export const ReinstatePolicySchema = z.object({
  effectiveDate: DateOnlySchema,
  reason: z.string().optional(),
}).passthrough()

export const NonRenewPolicySchema = z.object({
  reasonCode: z.string().optional(),
  reasonDescription: z.string().optional(),
  noticeDate: DateOnlySchema.optional(),
}).passthrough()

export const RewritePolicySchema = z.object({
  effectiveDate: DateOnlySchema.optional(),
  reason: z.string().optional(),
}).passthrough()

export type EndorsePolicyInput   = z.infer<typeof EndorsePolicySchema>
export type CancelPolicyInput    = z.infer<typeof CancelPolicySchema>
export type ReinstatePolicyInput = z.infer<typeof ReinstatePolicySchema>
export type NonRenewPolicyInput  = z.infer<typeof NonRenewPolicySchema>
export type RewritePolicyInput   = z.infer<typeof RewritePolicySchema>
