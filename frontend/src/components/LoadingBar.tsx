import React from 'react'

interface LoadingBarProps {
  /** When false the bar is removed from the DOM entirely (no layout shift). */
  active?: boolean
  /** Apply `.loading-bar--inline` for a relative-positioned bar (default is absolute). */
  inline?: boolean
  className?: string
}

/**
 * LoadingBar — a thin animated progress bar shown at the top of a container
 * during data fetching.  The parent container must have `position: relative`
 * (unless `inline` is true).
 *
 * Usage — absolute (default):
 *   <div style={{ position: 'relative' }}>
 *     <LoadingBar active={isFetching} />
 *     <table>…</table>
 *   </div>
 *
 * Usage — inline:
 *   <LoadingBar active={isFetching} inline />
 */
export const LoadingBar: React.FC<LoadingBarProps> = ({
  active = true,
  inline = false,
  className = '',
}) => {
  if (!active) return null

  const cls = [
    'loading-bar',
    inline ? 'loading-bar--inline' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      role="progressbar"
      aria-label="Loading"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext="Loading…"
    >
      <div className="loading-bar-fill" />
    </div>
  )
}
