import { Pagination } from './Pagination'

type TablePaginationProps = {
  page: number
  pageSize: number
  totalItems: number
  onPageChange: (next: number) => void
  onPageSizeChange: (next: number) => void
  pageSizeOptions?: number[]
}

/**
 * Table pager for client-paginated lists. Renders the shared numbered
 * `Pagination` so every screen shows the same pager (WP-0004 REQ-6); the props
 * are kept so existing callers need no change.
 */
export function TablePagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50]
}: TablePaginationProps) {
  return (
    <Pagination
      className="table-pagination"
      page={page}
      pageSize={pageSize}
      totalItems={totalItems}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      pageSizeOptions={pageSizeOptions}
    />
  )
}
