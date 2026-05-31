import { z } from 'zod'
import { DateOnlySchema } from './common.schema.js'

export const CreateQuoteFormSchema = z.object({
  productCode:   z.string().min(1, 'Product is required'),
  effectiveDate: DateOnlySchema.optional(),
  termMonths:    z.number().int().positive().optional(),
  state:         z.string().min(2, 'State is required').max(2).optional(),
})

export const BindQuoteFormSchema = z.object({
  uwOverride:     z.boolean().optional(),
  overrideReason: z.string().optional(),
  agentId:        z.string().optional(),
})

export type CreateQuoteFormValues = z.infer<typeof CreateQuoteFormSchema>
export type BindQuoteFormValues   = z.infer<typeof BindQuoteFormSchema>
