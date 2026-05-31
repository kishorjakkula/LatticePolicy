import React from 'react'

type Props = {
  icon?: string
  title: string
  description?: string
  action?: React.ReactNode
}

export const EmptyState: React.FC<Props> = ({ icon = '○', title, description, action }) => (
  <div className="empty-state">
    <div className="empty-state-icon">{icon}</div>
    <p className="empty-state-title">{title}</p>
    {description && <p className="empty-state-desc">{description}</p>}
    {action}
  </div>
)
