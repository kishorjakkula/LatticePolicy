import React from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style variant.  Defaults to 'primary'. */
  variant?: ButtonVariant
  /** Size preset.  Defaults to 'md'. */
  size?: ButtonSize
  /** When true, shows a spinner and sets cursor to wait.  Also disables the button. */
  loading?: boolean
  /** Optional icon rendered before the label.  Pass any React node (e.g. an SVG). */
  icon?: React.ReactNode
}

/**
 * ActionButton — button with design-system variants and built-in loading
 * spinner.  Drop-in replacement for the bare `<button>` in any UI that needs
 * consistent styling.
 *
 * Usage:
 *   <ActionButton variant="primary" onClick={handleSave}>Save</ActionButton>
 *   <ActionButton variant="secondary" size="sm" icon={<PlusIcon />}>Add</ActionButton>
 *   <ActionButton variant="primary" loading={isSaving}>Saving…</ActionButton>
 */
export const ActionButton: React.FC<ActionButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const classes = [
    'action-btn',
    `action-btn--${variant}`,
    `action-btn--${size}`,
    loading ? 'action-btn--loading' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span className="action-btn-spinner" aria-hidden="true" />
      ) : icon ? (
        <span className="action-btn-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children && <span>{children}</span>}
    </button>
  )
}
