type TablePaginationProps = {
  page: number
  pageSize: number
  totalItems: number
  onPageChange: (next: number) => void
  onPageSizeChange: (next: number) => void
  pageSizeOptions?: number[]
}

export function TablePagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50]
}: TablePaginationProps) {
  const safePageSize = Math.max(1, pageSize || 1)
  const totalPages = Math.max(1, Math.ceil((totalItems || 0) / safePageSize))
  const safePage = Math.min(Math.max(1, page || 1), totalPages)
  const canPrev = safePage > 1
  const canNext = safePage < totalPages
  const start = totalItems > 0 ? (safePage - 1) * safePageSize + 1 : 0
  const end = totalItems > 0 ? Math.min(totalItems, safePage * safePageSize) : 0

  return (
    <div className="pager-bar">
      <div className="muted">Showing {start}-{end} of {totalItems}</div>
      <div className="pager-controls">
        <button type="button" onClick={() => canPrev && onPageChange(safePage - 1)} disabled={!canPrev}>Prev</button>
        <span className="muted">Page {safePage} / {totalPages}</span>
        <button type="button" onClick={() => canNext && onPageChange(safePage + 1)} disabled={!canNext}>Next</button>
        <select
          value={safePageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {pageSizeOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
