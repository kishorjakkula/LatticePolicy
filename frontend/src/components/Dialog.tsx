import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * In-app replacements for window.prompt / window.confirm (WP-0004 REQ-2):
 * labelled, validated, focus trapped while open and returned to the trigger on
 * close; Escape cancels without side effects.
 */

type DialogShellProps = {
  title: string
  description?: ReactNode
  onCancel: () => void
  children: ReactNode
}

function DialogShell({ title, description, onCancel, children }: DialogShellProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  // Runs once per opening, so re-renders (typing, validation) never move focus.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>('textarea, input, select, button:not([disabled])')
    first?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'textarea, input, select, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ))
      if (!focusable.length) return
      const head = focusable[0]
      const tail = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === head) { event.preventDefault(); tail.focus() }
      else if (!event.shiftKey && document.activeElement === tail) { event.preventDefault(); head.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [])

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
      <div className="modal-panel" ref={panelRef}>
        <div className="modal-header">
          <h3 id={titleId}>{title}</h3>
        </div>
        {description && <div id={descriptionId} className="dialog-description">{description}</div>}
        {children}
      </div>
    </div>
  )
}

const actionsStyle = { display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' as const, marginTop: 12 }

export type ConfirmDialogProps = {
  title: string
  description?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Destructive actions use the danger style. */
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function ConfirmDialog({ title, description, confirmLabel, cancelLabel = 'Cancel', danger, onConfirm, onCancel }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
    } catch (e) {
      setError((e as Error)?.message || 'Something went wrong. Try again.')
      setBusy(false)
    }
  }
  return (
    <DialogShell title={title} description={description} onCancel={onCancel}>
      {error && <p className="error" role="alert">{error}</p>}
      <div style={actionsStyle}>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button type="button" className={danger ? 'btn-danger' : undefined} onClick={() => void confirm()} disabled={busy}>{confirmLabel}</button>
      </div>
    </DialogShell>
  )
}

export type ReasonDialogProps = {
  title: string
  description?: ReactNode
  /** Field label; defaults to "Reason". */
  label?: string
  help?: string
  confirmLabel: string
  danger?: boolean
  /** Optional reasons (e.g. "Request info") may be left blank. */
  optional?: boolean
  initialValue?: string
  onConfirm: (reason: string) => void | Promise<void>
  onCancel: () => void
}

export function ReasonDialog({ title, description, label = 'Reason', help, confirmLabel, danger, optional, initialValue = '', onConfirm, onCancel }: ReasonDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fieldId = useId()
  const helpId = useId()
  const errorId = useId()
  const submit = async () => {
    const reason = value.trim()
    if (!reason && !optional) {
      setError(`Enter a ${label.toLowerCase()}.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      await onConfirm(reason)
    } catch (e) {
      setError((e as Error)?.message || 'Something went wrong. Try again.')
      setBusy(false)
    }
  }
  return (
    <DialogShell title={title} description={description} onCancel={onCancel}>
      <form onSubmit={(event) => { event.preventDefault(); void submit() }} noValidate>
        <label htmlFor={fieldId}>{label}{optional ? ' (optional)' : ' (required)'}</label>
        <textarea
          id={fieldId}
          rows={3}
          maxLength={2000}
          value={value}
          onChange={(event) => { setValue(event.target.value); if (error) setError('') }}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={[help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined}
          disabled={busy}
        />
        {help && <p id={helpId} className="muted">{help}</p>}
        {error && <p id={errorId} className="error" role="alert">{error}</p>}
        <div style={actionsStyle}>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className={danger ? 'btn-danger' : undefined} disabled={busy}>{confirmLabel}</button>
        </div>
      </form>
    </DialogShell>
  )
}

type AskReasonOptions = Omit<ReasonDialogProps, 'onConfirm' | 'onCancel'>
type AskConfirmOptions = Omit<ConfirmDialogProps, 'onConfirm' | 'onCancel'>

/**
 * Promise-based replacement for prompt(): `const reason = await askReason({...})`
 * resolves to the trimmed reason, or null when cancelled. Render `dialog` once.
 */
export function useReasonDialog(): { dialog: ReactNode; askReason: (options: AskReasonOptions) => Promise<string | null> } {
  const [pending, setPending] = useState<{ options: AskReasonOptions; resolve: (value: string | null) => void } | null>(null)
  const askReason = useCallback((options: AskReasonOptions) => new Promise<string | null>((resolve) => setPending({ options, resolve })), [])
  const dialog = pending ? (
    <ReasonDialog
      {...pending.options}
      onConfirm={(reason) => { pending.resolve(reason); setPending(null) }}
      onCancel={() => { pending.resolve(null); setPending(null) }}
    />
  ) : null
  return { dialog, askReason }
}

/** Promise-based replacement for confirm(): resolves true on confirm, false on cancel. */
export function useConfirmDialog(): { dialog: ReactNode; askConfirm: (options: AskConfirmOptions) => Promise<boolean> } {
  const [pending, setPending] = useState<{ options: AskConfirmOptions; resolve: (value: boolean) => void } | null>(null)
  const askConfirm = useCallback((options: AskConfirmOptions) => new Promise<boolean>((resolve) => setPending({ options, resolve })), [])
  const dialog = pending ? (
    <ConfirmDialog
      {...pending.options}
      onConfirm={() => { pending.resolve(true); setPending(null) }}
      onCancel={() => { pending.resolve(false); setPending(null) }}
    />
  ) : null
  return { dialog, askConfirm }
}
