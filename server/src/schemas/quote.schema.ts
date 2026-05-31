import { z } from 'zod'
import { DateOnlySchema } from './common.schema.js'

export const CreateQuoteSchema = z.object({
  productCode: z.string().min(1, 'productCode is required'),
  effectiveDate: DateOnlySchema.optional(),
  termMonths: z.number().int().positive().optional(),
  state: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
}).passthrough()

export const DraftQuoteSchema = z.object({
  productCode: z.string().min(1).optional(),
  effectiveDate: DateOnlySchema.optional(),
  state: z.string().optional(),
  progressStep: z.number().int().min(0).max(20).optional(),
  status: z.string().optional(),
}).passthrough()

export const BindQuoteSchema = z.object({
  uwOverride: z.boolean().optional(),
  overrideReason: z.string().optional(),
  agentId: z.string().optional(),
}).passthrough()

export type CreateQuoteInput = z.infer<typeof CreateQuoteSchema>
export type DraftQuoteInput  = z.infer<typeof DraftQuoteSchema>
export type BindQuoteInput   = z.infer<typeof BindQuoteSchema>
