import { z } from 'zod'

export const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format')

export const MoneyAmountSchema = z.object({
  amount: z.number(),
  currency: z.string().length(3),
})

export const AddressSchema = z.object({
  street:  z.string().optional(),
  street2: z.string().optional(),
  city:    z.string().optional(),
  state:   z.string().optional(),
  zip:     z.string().optional(),
  country: z.string().optional(),
}).passthrough()

export const PhoneSchema = z
  .string()
  .regex(/^\+?[\d\s\-().]{7,20}$/, 'Invalid phone number')
  .optional()

export type DateOnly    = z.infer<typeof DateOnlySchema>
export type MoneyAmount = z.infer<typeof MoneyAmountSchema>
export type Address     = z.infer<typeof AddressSchema>
