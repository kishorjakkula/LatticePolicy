import React, { useEffect, useRef } from 'react'

interface PolicyContextMenuProps {
  x: number
  y: number
  policy: any
  onClose: () => void
  onNavigate: (path: string) => void
}

export function PolicyContextMenu({ x, y, policy, onClose, onNavigate }: PolicyContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const policyId: string = policy.policyId
  const insuredName: string = policy.insuredName || policy.customer?.name || ''

  // Focus the first menu item on mount; close on outside click
  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const firstItem = menu.querySelector<HTMLButtonElement>('[role="menuitem"]')
    firstItem?.focus()

    const onMouseDown = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [onClose])

  // Keyboard navigation: ↑↓ arrows, Home/End, Escape, Tab (close)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current
    if (!menu) return
    const items = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
    )
    const idx = items.indexOf(document.activeElement as HTMLButtonElement)

    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        onClose()
        break
      case 'ArrowDown':
        e.preventDefault()
        items[(idx + 1) % items.length]?.focus()
        break
      case 'ArrowUp':
        e.preventDefault()
        items[(idx - 1 + items.length) % items.length]?.focus()
        break
      case 'Home':
        e.preventDefault()
        items[0]?.focus()
        break
      case 'End':
        e.preventDefault()
        items[items.length - 1]?.focus()
        break
      case 'Tab':
        e.preventDefault()
        onClose()
        break
    }
  }

  const go = (path: string) => { onNavigate(path); onClose() }

  return (
    <div
      ref={menuRef}
      className="ps-context-menu"
      style={{ top: y, left: x }}
      role="menu"
      aria-label={`Actions for policy ${policy.policyNumber || policyId}`}
      onKeyDown={handleKeyDown}
    >
      <button role="menuitem" className="ps-menu-item" onClick={() => go(`/policies/${policyId}`)}>
        <span className="ps-menu-icon" aria-hidden="true">📋</span> View Policy
      </button>
      <button role="menuitem" className="ps-menu-item" onClick={() => go(`/policies/${policyId}?action=endorse`)}>
        <span className="ps-menu-icon" aria-hidden="true">📝</span> Endorse
      </button>
      <button role="menuitem" className="ps-menu-item ps-menu-item--highlight" onClick={() => go(`/policies/${policyId}?action=oos-endorse`)}>
        <span className="ps-menu-icon" aria-hidden="true">🔄</span> OOS Endorsement
      </button>
      <button role="menuitem" className="ps-menu-item" onClick={() => go(`/policies/${policyId}?action=renew`)}>
        <span className="ps-menu-icon" aria-hidden="true">🔁</span> Renew
      </button>
      <hr className="ps-menu-divider" aria-hidden="true" />
      <button role="menuitem" className="ps-menu-item" onClick={() => go(`/policies/${policyId}?tab=documents`)}>
        <span className="ps-menu-icon" aria-hidden="true">📄</span> View Documents
      </button>
      <button role="menuitem" className="ps-menu-item" onClick={() => go(`/policies/${policyId}?action=file-claim`)}>
        <span className="ps-menu-icon" aria-hidden="true">⚡</span> File Claim
      </button>
      <button role="menuitem" className="ps-menu-item" onClick={onClose}>
        <span className="ps-menu-icon" aria-hidden="true">📥</span> Export PDF
      </button>
      <hr className="ps-menu-divider" aria-hidden="true" />
      <button role="menuitem" className="ps-menu-item ps-menu-item--danger" onClick={() => go(`/policies/${policyId}?action=cancel`)}>
        <span className="ps-menu-icon" aria-hidden="true">❌</span> Cancel Policy
      </button>
      <div className="ps-menu-footer">
        <span>{policy.policyNumber || policyId}</span>
        {insuredName && <> · <span>{insuredName}</span></>}
      </div>
    </div>
  )
}
