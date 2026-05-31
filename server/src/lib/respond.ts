import type { Response } from 'express'

export function ok<T>(res: Response, data: T): void {
  res.json({ ok: true, data })
}

export function paged<T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  pageSize: number
): void {
  res.json({ ok: true, data, meta: { total, page, pageSize } })
}

export function created<T>(res: Response, data: T): void {
  res.status(201).json({ ok: true, data })
}

export function noContent(res: Response): void {
  res.status(204).end()
}
