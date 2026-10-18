import type { Request, Response } from 'express'

/** The request's correlation id, as written to logs and audit entries. */
export function requestIdOf(req: Request, res: Response): string | undefined {
  const id = String(res.getHeader('x-request-id') || (req as any).id || '')
  return id ? id.slice(0, 200) : undefined
}
