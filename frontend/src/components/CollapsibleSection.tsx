import React, { Children, isValidElement, useId, useState } from 'react'

// Header wrappers the screens already use. When a section's first child is one
// of these (or a bare h2-h4) it becomes the always-visible header row.
const HEADER_CLASS = /\b(panel-header|policy-section-header|policy-actions-header|ps-content-card-title|card-head|section-title|insureds-subsection-header|auto-risk-vehicle-card-head)\b/
const HEADING_TAGS = new Set(['h2', 'h3', 'h4'])

type Props = Omit<React.HTMLAttributes<HTMLElement>, 'title'> & {
  /** Element rendered for the section container. */
  as?: 'div' | 'section' | 'form'
  /** Header text for sections that have no header element of their own. */
  title?: React.ReactNode
  defaultOpen?: boolean
  ref?: React.Ref<any>
}

function isHeaderElement(node: React.ReactNode): node is React.ReactElement {
  if (!isValidElement(node)) return false
  if (typeof node.type === 'string' && HEADING_TAGS.has(node.type)) return true
  const className = (node.props as { className?: unknown }).className
  return typeof className === 'string' && HEADER_CLASS.test(className)
}

/**
 * Standard screen section: a card whose body can be collapsed from its header.
 * Keeps the caller's container classes, so existing card styling applies. The
 * body stays mounted while collapsed so form state is not lost.
 */
export const CollapsibleSection: React.FC<Props> = ({
  as = 'div',
  title,
  defaultOpen = true,
  className,
  children,
  ...rest
}) => {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  const Tag = as as React.ElementType

  const items = Children.toArray(children)
  const hasOwnHeader = title == null && isHeaderElement(items[0])
  const header = hasOwnHeader ? items[0] : <h3 className="collapsible-section-title">{title}</h3>
  const body = hasOwnHeader ? items.slice(1) : items

  return (
    <Tag {...rest} className={['collapsible-section', className, open ? '' : 'is-collapsed'].filter(Boolean).join(' ')}>
      <div className="collapsible-section-header">
        <button
          type="button"
          className="collapsible-section-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? 'Collapse section' : 'Expand section'}
          title={open ? 'Collapse section' : 'Expand section'}
          onClick={() => setOpen((value) => !value)}
        />
        <div className="collapsible-section-heading">{header}</div>
      </div>
      <div id={bodyId} className="collapsible-section-body" hidden={!open}>
        {body}
      </div>
    </Tag>
  )
}
