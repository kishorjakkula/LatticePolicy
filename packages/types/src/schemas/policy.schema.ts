import { z } from 'zod'
import { DateOnlySchema } from './common.schema.js'

export const EndorseFormSchema = z.object({
  effectiveDate: DateOnlySchema.optional(),
  reason:        z.string().optional(),
  notes:         z.string().optional(),
})

export const CancelFormSchema = z.object({
  effectiveDate: DateOnlySchema,
  reasonCode:    z.string().optional(),
  reason:        z.string().optional(),
})

export const ReinstateFormSchema = z.object({
  effectiveDate: DateOnlySchema,
  reason:        z.string().optional(),
})

export const NonRenewFormSchema = z.object({
  reasonCode:        z.string().optional(),
  reasonDescription: z.string().optional(),
  noticeDate:        DateOnlySchema.optional(),
})

export type EndorseFormValues   = z.infer<typeof EndorseFormSchema>
export type CancelFormValues    = z.infer<typeof CancelFormSchema>
export type ReinstateFormValues = z.infer<typeof ReinstateFormSchema>
export type NonRenewFormValues  = z.infer<typeof NonRenewFormSchema>
