import { useEffect, useMemo, useState } from 'react'

type PaginationResult<T> = {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  rows: T[]
  setPage: (next: number) => void
  setPageSize: (next: number) => void
}

export function useClientPagination<T>(rows: T[], initialPageSize = 10): PaginationResult<T> {
  const [page, setPageState] = useState(1)
  const [pageSize, setPageSizeState] = useState(initialPageSize)

  const totalItems = Array.isArray(rows) ? rows.length : 0
  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(totalItems / Math.max(1, pageSize)))
  }, [pageSize, totalItems])

  useEffect(() => {
    if (page > totalPages) {
      setPageState(totalPages)
    }
  }, [page, totalPages])

  const pagedRows = useMemo(() => {
    const start = (Math.max(1, page) - 1) * Math.max(1, pageSize)
    return rows.slice(start, start + Math.max(1, pageSize))
  }, [page, pageSize, rows])

  const setPage = (next: number) => {
    if (!Number.isFinite(next)) return
    const safe = Math.min(Math.max(1, Math.floor(next)), totalPages)
    setPageState(safe)
  }

  const setPageSize = (next: number) => {
    if (!Number.isFinite(next) || next <= 0) return
    setPageSizeState(Math.floor(next))
    setPageState(1)
  }

  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    rows: pagedRows,
    setPage,
    setPageSize
  }
}
