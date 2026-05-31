import React from 'react'

type Props = { size?: 'sm' | 'md' | 'lg'; label?: string }

export const Spinner: React.FC<Props> = ({ size = 'md', label = 'Loading…' }) => (
  <div className="loading-center">
    <span className={`spinner${size === 'sm' ? ' spinner-sm' : size === 'lg' ? ' spinner-lg' : ''}`} aria-hidden="true" />
    <span className="muted">{label}</span>
  </div>
)
