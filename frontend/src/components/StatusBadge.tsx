import React from 'react'

/** Canonical status key — maps to a CSS modifier class */
type StatusKey =
  | 'inforce'
  | 'issued'
  | 'bound'
  | 'pending'
  | 'cancelled'
  | 'expired'
  | 'nonrenewed'
  | 'draft'
  | 'unknown'

interface StatusConfig {
  key: StatusKey
  label: string
}

/**
 * Normalises any raw status string coming from the API into a canonical
 * { key, label } pair.  The key maps to a CSS modifier class
 * `.status-badge--{key}` defined in styles.css.
 */
function resolveStatus(raw: string): StatusConfig {
  const s = raw.trim().toLowerCase().replace(/[-_\s]+/g, '')

  if (s === 'inforce' || s === 'inforced') return { key: 'inforce',    label: 'In Force' }
  if (s === 'issued')                       return { key: 'issued',     label: 'Issued' }
  if (s === 'bind' || s === 'bound')        return { key: 'bound',      label: 'Bound' }
  if (s === 'pending' || s === 'rated')     return { key: 'pending',    label: 'Pending' }
  if (s === 'cancelled' || s === 'canceled')return { key: 'cancelled',  label: 'Cancelled' }
  if (s === 'expired')                      return { key: 'expired',    label: 'Expired' }
  if (s === 'nonrenewed' || s === 'nonrenewal' || s === 'nonrenew')
                                            return { key: 'nonrenewed', label: 'Non-Renewed' }
  if (s === 'draft')                        return { key: 'draft',      label: 'Draft' }

  // Unknown statuses: preserve original casing for display
  return { key: 'unknown', label: raw.trim() || 'Unknown' }
}

interface StatusBadgeProps {
  /** Raw status string from the API, e.g. "Inforced", "bind", "Non-Renewed" */
  status: string
  className?: string
}

/**
 * StatusBadge renders a pill badge with a coloured dot for any policy/quote
 * status.  Colour is driven entirely by CSS custom properties so dark mode
 * is handled automatically without extra logic here.
 *
 * IMPORTANT: "In Force" is always rendered as two words.
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => {
  const { key, label } = resolveStatus(status)

  return (
    <span
      className={`status-badge status-badge--${key}${className ? ` ${className}` : ''}`}
      role="status"
      aria-label={`Status: ${label}`}
    >
      <span className="status-badge__dot" aria-hidden="true" />
      {label}
    </span>
  )
}
