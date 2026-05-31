import type { Request, Response, NextFunction } from 'express'
import type { ZodSchema } from 'zod'
import { ZodError } from 'zod'
import { ValidationError } from '../errors/domain.errors.js'

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body)
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        next(new ValidationError('VALIDATION_ERROR', err.flatten()))
      } else {
        next(err)
      }
    }
  }
}
