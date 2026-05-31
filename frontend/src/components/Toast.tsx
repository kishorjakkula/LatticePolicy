import React, { createContext, useCallback, useContext, useRef, useState } from 'react'

type ToastKind = 'success' | 'error' | 'info' | 'warning'

type ToastItem = {
  id: number
  kind: ToastKind
  title: string
  message?: string
  exiting?: boolean
}

type ToastCtx = {
  toast: (kind: ToastKind, title: string, message?: string) => void
  success: (title: string, message?: string) => void
  error: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
}

const Ctx = createContext<ToastCtx | undefined>(undefined)

const ICONS: Record<ToastKind, string> = {
  success: '✓',
  error: '✕',
  info: 'i',
  warning: '!',
}

const DURATION = 4000

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => {
    setItems(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t))
    setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 200)
  }, [])

  const toast = useCallback((kind: ToastKind, title: string, message?: string) => {
    const id = ++counter.current
    setItems(prev => [...prev, { id, kind, title, message }])
    setTimeout(() => dismiss(id), DURATION)
  }, [dismiss])

  const success = useCallback((title: string, message?: string) => toast('success', title, message), [toast])
  const error   = useCallback((title: string, message?: string) => toast('error',   title, message), [toast])
  const info    = useCallback((title: string, message?: string) => toast('info',    title, message), [toast])
  const warning = useCallback((title: string, message?: string) => toast('warning', title, message), [toast])

  return (
    <Ctx.Provider value={{ toast, success, error, info, warning }}>
      {children}
      <div className="toast-region" role="region" aria-label="Notifications">
        {items.map(t => (
          <div key={t.id} className={`toast toast-${t.kind}${t.exiting ? ' toast-exit' : ''}`} role="alert">
            <div className="toast-icon">{ICONS[t.kind]}</div>
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.message && <div className="toast-message">{t.message}</div>}
            </div>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">✕</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useToast must be used within ToastProvider')
  return c
}
