import React from 'react'

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Called when the user clicks the × clear button.  If not provided, the
   *  clear button is not rendered even when the input has a value. */
  onClear?: () => void
  /** Additional class applied to the outer wrapper div, not the <input> */
  wrapperClassName?: string
}

/**
 * SearchInput — text input with an optional clear button.
 * Extends all native <input> attributes except `type`.
 *
 * Usage:
 *   <SearchInput
 *     value={q}
 *     onChange={e => setQ(e.target.value)}
 *     onClear={() => setQ('')}
 *     placeholder="Search policies…"
 *   />
 */
export const SearchInput: React.FC<SearchInputProps> = ({
  onClear,
  value,
  wrapperClassName = '',
  className = '',
  ...props
}) => {
  const hasValue = value !== undefined && value !== ''

  return (
    <div className={`search-input-wrap${wrapperClassName ? ` ${wrapperClassName}` : ''}`}>
      <input
        type="search"
        className={`search-input${className ? ` ${className}` : ''}`}
        value={value}
        {...props}
      />
      {hasValue && onClear && (
        <button
          type="button"
          className="search-input-clear"
          onClick={onClear}
          aria-label="Clear search"
          tabIndex={-1}
        >
          ×
        </button>
      )}
    </div>
  )
}
