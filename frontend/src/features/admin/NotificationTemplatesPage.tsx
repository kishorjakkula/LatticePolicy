import { FormEvent, useMemo, useState } from 'react'
import { TablePagination } from '../../components/TablePagination'
import { useClientPagination } from '../../hooks/useClientPagination'
import {
  useNotificationTemplates,
  useCreateNotificationTemplateMutation,
  useUpdateNotificationTemplateMutation,
  useSetNotificationTemplateActiveMutation,
  usePreviewNotificationTemplateMutation,
} from '../../api/hooks'

type NotificationTemplate = {
  templateId: string
  templateCode: string
  eventType: string
  channel: string
  productCode: string | null
  transactionType: string | null
  locale: string
  subjectTemplate: string
  bodyTemplate: string
  visibility: string[]
  active: boolean
  effectiveDate: string | null
  expirationDate: string | null
}

type TemplateDraft = {
  templateCode: string
  eventType: string
  channel: string
  productCode: string
  transactionType: string
  locale: string
  subjectTemplate: string
  bodyTemplate: string
  visibility: string[]
  effectiveDate: string
  expirationDate: string
}

const EMPTY_DRAFT: TemplateDraft = {
  templateCode: '',
  eventType: 'POLICY_ISSUED',
  channel: 'EMAIL',
  productCode: '',
  transactionType: '',
  locale: 'en-US',
  subjectTemplate: '',
  bodyTemplate: '',
  visibility: ['customer'],
  effectiveDate: '',
  expirationDate: '',
}

// Sample merge fields for preview rendering, matching docs/NOTIFICATIONS.md.
const SAMPLE_FIELDS = {
  policyNumber: 'PA-2026-000123',
  productCode: 'personal-auto',
  transactionNumber: 'END-20260801-0001',
  transactionType: 'Endorsement',
  effectiveDate: '2026-08-01',
  expirationDate: '2027-08-01',
  noticeDate: '2026-07-15',
  reason: 'insured request',
  premiumImpact: '42.00',
  recipient: { name: 'Ada Lovelace', email: 'ada@example.com' },
}

function draftFromTemplate(item: NotificationTemplate): TemplateDraft {
  return {
    templateCode: item.templateCode,
    eventType: item.eventType,
    channel: item.channel,
    productCode: item.productCode || '',
    transactionType: item.transactionType || '',
    locale: item.locale,
    subjectTemplate: item.subjectTemplate,
    bodyTemplate: item.bodyTemplate,
    visibility: item.visibility.length ? item.visibility : ['customer'],
    effectiveDate: item.effectiveDate || '',
    expirationDate: item.expirationDate || '',
  }
}

function draftToPayload(draft: TemplateDraft) {
  return {
    templateCode: draft.templateCode.trim(),
    eventType: draft.eventType.trim(),
    channel: draft.channel,
    productCode: draft.productCode.trim() || null,
    transactionType: draft.transactionType.trim() || null,
    locale: draft.locale.trim() || 'en-US',
    subjectTemplate: draft.subjectTemplate,
    bodyTemplate: draft.bodyTemplate,
    visibility: draft.visibility,
    effectiveDate: draft.effectiveDate || null,
    expirationDate: draft.expirationDate || null,
  }
}

export function NotificationTemplatesPage() {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_DRAFT)
  const [formError, setFormError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null)

  const { data: rawItems, isLoading, error: loadError } = useNotificationTemplates({ active: undefined })
  const items: NotificationTemplate[] = useMemo(() => rawItems ?? [], [rawItems])
  const pagination = useClientPagination(items, 10)

  const createMutation = useCreateNotificationTemplateMutation()
  const updateMutation = useUpdateNotificationTemplateMutation()
  const activeMutation = useSetNotificationTemplateActiveMutation()
  const previewMutation = usePreviewNotificationTemplateMutation()

  const error = formError || (loadError ? String(loadError) : null)
  const submitting = createMutation.isPending || updateMutation.isPending

  const resetForm = () => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setFormError(null)
    setPreview(null)
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft.templateCode.trim() || !draft.eventType.trim() || !draft.subjectTemplate.trim() || !draft.bodyTemplate.trim()) {
      return
    }
    setFormError(null)
    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, payload: draftToPayload(draft) })
      } else {
        await createMutation.mutateAsync(draftToPayload(draft))
      }
      resetForm()
    } catch (e: any) {
      setFormError(e.message || String(e))
    }
  }

  const onEdit = (item: NotificationTemplate) => {
    setEditingId(item.templateId)
    setDraft(draftFromTemplate(item))
    setPreview(null)
    setFormError(null)
  }

  const onToggleActive = async (item: NotificationTemplate) => {
    setFormError(null)
    try {
      await activeMutation.mutateAsync({ id: item.templateId, active: !item.active })
    } catch (e: any) {
      setFormError(e.message || String(e))
    }
  }

  const onPreview = async () => {
    setFormError(null)
    setPreview(null)
    try {
      const result = await previewMutation.mutateAsync({
        subjectTemplate: draft.subjectTemplate,
        bodyTemplate: draft.bodyTemplate,
        sampleFields: SAMPLE_FIELDS,
      })
      setPreview(result)
    } catch (e: any) {
      setFormError(e.message || String(e))
    }
  }

  const toggleVisibility = (value: 'customer' | 'internal') => {
    setDraft((prev) => {
      const next = new Set(prev.visibility)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return { ...prev, visibility: next.size ? Array.from(next) : ['customer'] }
    })
  }

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div><h2 className="ps-page-title">Notification Templates</h2></div>
      </div>
      {error && <p className="error">{error}</p>}
      <form onSubmit={onSubmit} className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="col">
          <label>Template Code</label>
          <input
            value={draft.templateCode}
            onChange={(e) => setDraft((prev) => ({ ...prev, templateCode: e.target.value }))}
            disabled={!!editingId}
            placeholder="pa-cancel-ca"
          />
        </div>
        <div className="col">
          <label>Event Type</label>
          <input
            value={draft.eventType}
            onChange={(e) => setDraft((prev) => ({ ...prev, eventType: e.target.value }))}
            placeholder="POLICY_CANCELLED"
          />
        </div>
        <div className="col">
          <label>Channel</label>
          <select value={draft.channel} onChange={(e) => setDraft((prev) => ({ ...prev, channel: e.target.value }))}>
            <option value="EMAIL">EMAIL</option>
          </select>
        </div>
        <div className="col">
          <label>Product Code (optional)</label>
          <input
            value={draft.productCode}
            onChange={(e) => setDraft((prev) => ({ ...prev, productCode: e.target.value }))}
            placeholder="personal-auto"
          />
        </div>
        <div className="col">
          <label>Transaction Type (optional)</label>
          <input
            value={draft.transactionType}
            onChange={(e) => setDraft((prev) => ({ ...prev, transactionType: e.target.value }))}
            placeholder="Cancellation"
          />
        </div>
        <div className="col">
          <label>Locale</label>
          <input value={draft.locale} onChange={(e) => setDraft((prev) => ({ ...prev, locale: e.target.value }))} />
        </div>
        <div className="col">
          <label>Effective Date (optional)</label>
          <input
            type="date"
            value={draft.effectiveDate}
            onChange={(e) => setDraft((prev) => ({ ...prev, effectiveDate: e.target.value }))}
          />
        </div>
        <div className="col">
          <label>Expiration Date (optional)</label>
          <input
            type="date"
            value={draft.expirationDate}
            onChange={(e) => setDraft((prev) => ({ ...prev, expirationDate: e.target.value }))}
          />
        </div>
        <div className="col">
          <label>Visibility</label>
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={draft.visibility.includes('customer')} onChange={() => toggleVisibility('customer')} />
              <span>Customer</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={draft.visibility.includes('internal')} onChange={() => toggleVisibility('internal')} />
              <span>Internal</span>
            </label>
          </div>
        </div>
        <div className="col" style={{ flexBasis: '100%' }}>
          <label>Subject Template</label>
          <input
            value={draft.subjectTemplate}
            onChange={(e) => setDraft((prev) => ({ ...prev, subjectTemplate: e.target.value }))}
            placeholder="Policy {{policyNumber}} cancellation notice"
          />
        </div>
        <div className="col" style={{ flexBasis: '100%' }}>
          <label>Body Template</label>
          <textarea
            value={draft.bodyTemplate}
            onChange={(e) => setDraft((prev) => ({ ...prev, bodyTemplate: e.target.value }))}
            rows={4}
            placeholder="Policy {{policyNumber}} is cancelled effective {{effectiveDate}}. Reason: {{reason}}."
          />
        </div>
        <div className="col" style={{ alignSelf: 'end', display: 'flex', gap: 8 }}>
          <button type="submit" disabled={submitting || !draft.templateCode.trim() || !draft.subjectTemplate.trim() || !draft.bodyTemplate.trim()}>
            {editingId ? 'Update' : 'Add'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onPreview}
            disabled={previewMutation.isPending || !draft.subjectTemplate.trim() || !draft.bodyTemplate.trim()}
          >
            Preview
          </button>
          {editingId && (
            <button type="button" className="btn-secondary" onClick={resetForm} disabled={submitting}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {preview && (
        <div className="ps-table-card" style={{ marginBottom: 16, padding: 12 }}>
          <strong>Preview (sample merge fields)</strong>
          <div style={{ marginTop: 8 }}><em>Subject:</em> {preview.subject}</div>
          <div style={{ marginTop: 4 }}><em>Body:</em> {preview.body}</div>
        </div>
      )}

      <div className="ps-table-card" style={{ marginTop: 16 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Template Code</th>
              <th>Event Type</th>
              <th>Channel</th>
              <th>Product / Transaction</th>
              <th>Visibility</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="muted">Loading…</td></tr>}
            {!isLoading && items.length === 0 && <tr><td colSpan={7} className="muted">No notification templates configured.</td></tr>}
            {!isLoading && pagination.rows.map((item) => (
              <tr key={item.templateId}>
                <td>{item.templateCode}</td>
                <td>{item.eventType}</td>
                <td>{item.channel}</td>
                <td>{[item.productCode, item.transactionType].filter(Boolean).join(' / ') || <span className="muted">Any</span>}</td>
                <td>{item.visibility.join(', ')}</td>
                <td>{item.active ? 'Active' : 'Inactive'}</td>
                <td style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" onClick={() => onEdit(item)}>Edit</button>
                  <button className="btn-secondary" onClick={() => onToggleActive(item)}>
                    {item.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!isLoading && items.length > 0 && (
        <TablePagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          totalItems={pagination.totalItems}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      )}
    </div>
  )
}
