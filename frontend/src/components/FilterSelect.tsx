import React from 'react'

interface FilterSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Optional visible label rendered above the select */
  label?: string
  /** Additional class applied to the outer wrapper div */
  wrapperClassName?: string
}

/** Chevron icon — inline SVG, no external dependency */
const ChevronIcon: React.FC = () => (
  <svg
    className="filter-select-chevron"
    viewBox="0 0 14 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M3 5l4 4 4-4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/**
 * FilterSelect — styled `<select>` with a custom chevron and optional label.
 * Extends all native <select> attributes.
 *
 * Usage:
 *   <FilterSelect
 *     label="Product"
 *     value={product}
 *     onChange={e => setProduct(e.target.value)}
 *   >
 *     <option value="">All Products</option>
 *     <option value="personal-auto">Personal Auto</option>
 *   </FilterSelect>
 */
export const FilterSelect: React.FC<FilterSelectProps> = ({
  label,
  children,
  wrapperClassName = '',
  className = '',
  id,
  ...props
}) => {
  return (
    <div className={`filter-select-wrap${wrapperClassName ? ` ${wrapperClassName}` : ''}`}>
      {label && (
        <label className="filter-select-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="filter-select-inner">
        <select
          id={id}
          className={`filter-select${className ? ` ${className}` : ''}`}
          {...props}
        >
          {children}
        </select>
        <ChevronIcon />
      </div>
    </div>
  )
}
