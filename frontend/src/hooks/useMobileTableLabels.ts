import { useEffect } from 'react'

export function useMobileTableLabels(token: string | null, pathname: string) {
  useEffect(() => {
    if (typeof document === 'undefined') return

    let rafId = 0
    const root = document.querySelector('.app-shell') ?? document.body

    const normalizeLabel = (value: string) => value.replace(/\s+/g, ' ').trim()

    const applyMobileTableLabels = () => {
      rafId = 0
      const tables = root.querySelectorAll<HTMLTableElement>('table.table')
      tables.forEach((table) => {
        const headerCells = Array.from(table.querySelectorAll(':scope > thead > tr:first-child > th'))
        if (!headerCells.length) return

        const headers = headerCells.map((th, index) => {
          const explicit = th.getAttribute('data-mobile-label')
          if (explicit) return normalizeLabel(explicit)
          const text = normalizeLabel(th.textContent ?? '')
          return text || `Column ${index + 1}`
        })

        table.classList.add('table-mobile-cards')
        Array.from(table.tBodies).forEach((tbody) => {
          Array.from(tbody.rows).forEach((row) => {
            let visualColIndex = 0
            Array.from(row.cells).forEach((cell) => {
              if (cell.tagName !== 'TD') return
              const span = Math.max(1, cell.colSpan || 1)
              const label = headers[visualColIndex] ?? ''
              if (span > 1) {
                cell.setAttribute('data-mobile-colspan', String(span))
              } else {
                cell.removeAttribute('data-mobile-colspan')
              }
              if (label) {
                cell.setAttribute('data-label', label)
              } else {
                cell.removeAttribute('data-label')
              }
              visualColIndex += span
            })
          })
        })
      })
    }

    const scheduleApply = () => {
      if (rafId) return
      rafId = window.requestAnimationFrame(applyMobileTableLabels)
    }

    scheduleApply()
    const observer = new MutationObserver(scheduleApply)
    observer.observe(root, { childList: true, subtree: true, characterData: true })

    return () => {
      observer.disconnect()
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [token, pathname])
}
