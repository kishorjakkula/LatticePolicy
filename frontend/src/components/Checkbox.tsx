import React, { useEffect, useRef } from 'react'

interface CheckboxProps {
  /** Whether the checkbox is checked */
  checked?: boolean
  /** When true, renders a dash (−) instead of a checkmark.  Useful for
   *  "select all" when only some rows are selected. */
  indeterminate?: boolean
  /** Called when the user toggles the checkbox */
  onChange?: (checked: boolean) => void
  /** Text rendered to the right of the box */
  label?: string
  disabled?: boolean
  id?: string
  className?: string
  /** Forwarded as name to the underlying <input> */
  name?: string
  /** Accessible label for screen readers when no visible label text is shown
   *  (e.g. inside a table row where a visible label would be redundant). */
  ariaLabel?: string
}

/** Checkmark — inline SVG so no external icon dependency needed */
const CheckIcon: React.FC = () => (
  <svg
    width="10"
    height="8"
    viewBox="0 0 10 8"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className="ps-checkbox-checkmark"
  >
    <path
      d="M1 4L3.5 6.5L9 1"
      stroke="white"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/**
 * Checkbox — fully custom styled checkbox with checked, unchecked, and
 * indeterminate states.  The native `<input type="checkbox">` is visually
 * hidden but remains in the tab order for keyboard accessibility.
 *
 * Usage:
 *   <Checkbox checked={allSelected} indeterminate={someSelected}
 *             onChange={setAllSelected} label="Select all" />
 */
export const Checkbox: React.FC<CheckboxProps> = ({
  checked = false,
  indeterminate = false,
  onChange,
  label,
  disabled = false,
  id,
  className = '',
  name,
  ariaLabel,
}) => {
  const inputRef = useRef<HTMLInputElement>(null)

  // Set the indeterminate property imperatively — there is no HTML attribute for it
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate
    }
  }, [indeterminate])

  return (
    <label
      className={`ps-checkbox${disabled ? ' ps-checkbox--disabled' : ''}${className ? ` ${className}` : ''}`}
      htmlFor={id}
    >
      <input
        ref={inputRef}
        type="checkbox"
        id={id}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="ps-checkbox-input"
        aria-checked={indeterminate ? 'mixed' : checked}
        aria-label={ariaLabel}
      />
      {/* Custom visual box */}
      <span className="ps-checkbox-box" aria-hidden="true">
        {indeterminate ? (
          <span className="ps-checkbox-dash" />
        ) : checked ? (
          <CheckIcon />
        ) : null}
      </span>
      {label && <span className="ps-checkbox-label">{label}</span>}
    </label>
  )
}
