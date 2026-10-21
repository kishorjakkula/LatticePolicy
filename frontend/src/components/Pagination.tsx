import React, { useEffect, useState } from 'react'

interface PaginationProps {
  page: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
  /** Max numbered page buttons to show (excluding prev/next). Defaults to 7. */
  maxPageButtons?: number
  className?: string
  /** Also show "Showing a–b of N" (tables without their own count). */
  showRange?: boolean
}

/**
 * Builds the array of page numbers and ellipsis markers to render.
 * Always shows first page, last page, current page ± delta, and '...' gaps.
 */
function buildPageRange(
  current: number,
  total: number,
  max: number,
): (number | '...')[] {
  if (total <= max) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const delta = Math.floor((max - 5) / 2) // pages around current
  const left  = Math.max(2, current - delta)
  const right = Math.min(total - 1, current + delta)

  const pages: (number | '...')[] = [1]

  if (left > 2)          pages.push('...')
  for (let p = left; p <= right; p++) pages.push(p)
  if (right < total - 1) pages.push('...')

  pages.push(total)
  return pages
}

/**
 * Pagination — "Page X of Y" label on the left; ← Previous, numbered page
 * buttons (with ellipsis for large counts), Next → on the right; optional
 * page-size selector beside the nav controls.
 *
 * Usage:
 *   <Pagination
 *     page={page} pageSize={25} totalItems={total}
 *     onPageChange={setPage}
 *     onPageSizeChange={setPageSize}
 *   />
 */
export function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  maxPageButtons = 7,
  className = '',
  showRange = false,
}: PaginationProps) {
  const [compact, setCompact] = useState(() => window.matchMedia?.('(max-width: 767px)')?.matches ?? false)
  const [sizeOpen, setSizeOpen] = useState(false)
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 767px)')
    if (!media) return
    const update = () => { setCompact(media.matches); setSizeOpen(false) }
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  const safeSize   = Math.max(1, pageSize || 1)
  const totalPages = Math.max(1, Math.ceil((totalItems || 0) / safeSize))
  const safePage   = Math.min(Math.max(1, page || 1), totalPages)
  const canPrev    = safePage > 1
  const canNext    = safePage < totalPages

  const pageRange = buildPageRange(safePage, totalPages, maxPageButtons)
  // The picker always lists the size actually in use, so it never shows a
  // different value from the one the results were fetched with.
  const sizeOptions = pageSizeOptions.includes(safeSize)
    ? pageSizeOptions
    : [...pageSizeOptions, safeSize].sort((a, b) => a - b)
  const sizePicker = (
    <select
      className="ps-pagination-size-select"
      value={safeSize}
      onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
      aria-label="Results per page"
    >
      {sizeOptions.map((opt) => (
        <option key={opt} value={opt}>{opt} per page</option>
      ))}
    </select>
  )

  return (
    <nav
      className={`ps-pagination${className ? ` ${className}` : ''}`}
      aria-label="Pagination"
    >
      {/* Left: "Page X of Y" */}
      <span className="ps-pagination-info">
        {totalItems > 0
          ? `${showRange ? `Showing ${((safePage - 1) * safeSize + 1).toLocaleString()}–${Math.min(safePage * safeSize, totalItems).toLocaleString()} of ${totalItems.toLocaleString()} · ` : ''}Page ${safePage.toLocaleString()} of ${totalPages.toLocaleString()}`
          : 'No results'}
      </span>

      {/* Right: controls + size selector */}
      <div className="ps-pagination-right">
        <div className="ps-pagination-controls" role="group" aria-label="Pages">
          {/* ← Previous */}
          <button
            type="button"
            className="ps-page-btn ps-page-btn--nav"
            onClick={() => canPrev && onPageChange(safePage - 1)}
            disabled={!canPrev}
            aria-label="Go to previous page"
          >
            ← Previous
          </button>

          <span className="ps-pagination-compact" aria-label={`Page ${safePage} of ${totalPages}`}>
            {safePage} / {totalPages}
          </span>

          {/* Numbered pages + ellipsis */}
          {pageRange.map((p, idx) =>
            p === '...' ? (
              <span
                key={`ellipsis-${idx}`}
                className="ps-page-ellipsis"
                aria-hidden="true"
              >
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className={`ps-page-btn${p === safePage ? ' ps-page-btn--active' : ''}`}
                onClick={() => p !== safePage && onPageChange(p as number)}
                aria-label={`Page ${p}`}
                aria-current={p === safePage ? 'page' : undefined}
              >
                {p}
              </button>
            ),
          )}

          {/* Next → */}
          <button
            type="button"
            className="ps-page-btn ps-page-btn--nav"
            onClick={() => canNext && onPageChange(safePage + 1)}
            disabled={!canNext}
            aria-label="Go to next page"
          >
            Next →
          </button>
        </div>

        {/* Page-size selector */}
        {onPageSizeChange && (
          compact ? (
            <details className="ps-pagination-size" open={sizeOpen} onToggle={(event) => setSizeOpen(event.currentTarget.open)}>
              <summary aria-label="Page size options" title="Page size options">{safeSize}</summary>
              {sizePicker}
            </details>
          ) : <div className="ps-pagination-size">{sizePicker}</div>
        )}
      </div>
    </nav>
  )
}
