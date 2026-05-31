import { z } from 'zod'

export const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
export const UuidSchema = z.string().uuid()
export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
})

export type Pagination = z.infer<typeof PaginationSchema>
