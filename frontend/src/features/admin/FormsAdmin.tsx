import { useMemo, useState } from 'react'
import { TablePagination } from '../../components/TablePagination'
import { useClientPagination } from '../../hooks/useClientPagination'
import { useFormTemplates, useCreateFormTemplateMutation, useUpdateFormTemplateMutation, useDeleteFormTemplateMutation } from '../../api/hooks'

type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'date'
  | 'email'
  | 'phone'

type FieldDef = {
  id: string
  label: string
  name: string
  type: FieldType
  required?: boolean
  placeholder?: string
  options?: string[]
}

type FormTemplate = {
  id: string
  key: string
  name: string
  version: string
  description?: string
  active: boolean
  fields: FieldDef[]
}

const SAMPLE_FORMS: FormTemplate[] = []

function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 9)
}

export function FormsAdmin() {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<FormTemplate | null>(null)

  const { data: templatesData } = useFormTemplates()
  const items: FormTemplate[] = templatesData ?? []

  const templatePagination = useClientPagination(items, 10)
  const fieldPagination = useClientPagination(draft?.fields || [], 10)

  const createMutation = useCreateFormTemplateMutation()
  const updateMutation = useUpdateFormTemplateMutation()
  const deleteMutation = useDeleteFormTemplateMutation()

  const resetForm = () => {
    setEditingId(null)
    setDraft(null)
  }

  const startCreate = () => {
    setEditingId(null)
    setDraft({ id: uid('form_'), key: '', name: '', version: '1.0', description: '', active: true, fields: [] })
  }

  const startEdit = (t: FormTemplate) => {
    setEditingId(t.id)
    setDraft(JSON.parse(JSON.stringify(t)))
  }

  const saveDraft = () => {
    if (!draft) return
    if (!draft.name.trim() || !draft.key.trim()) return alert('Key and name required')
    ;(async () => {
      try {
        if (editingId) {
          await updateMutation.mutateAsync({ id: editingId, payload: draft })
        } else {
          await createMutation.mutateAsync(draft)
        }
        resetForm()
      } catch (e: any) {
        alert(e.message || String(e))
      }
    })()
  }

  const removeTemplate = (id: string) => {
    if (!confirm('Delete form template?')) return
    ;(async () => {
      try {
        await deleteMutation.mutateAsync(id)
        if (editingId === id) resetForm()
      } catch (e: any) {
        alert(e.message || String(e))
      }
    })()
  }

  const addField = () => {
    if (!draft) return
    const next: FieldDef = { id: uid('f_'), label: 'New Field', name: 'new_field', type: 'text', required: false }
    setDraft({ ...draft, fields: [...draft.fields, next] })
  }

  const updateField = (id: string, patch: Partial<FieldDef>) => {
    if (!draft) return
    setDraft({ ...draft, fields: draft.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) })
  }

  const removeField = (id: string) => {
    if (!draft) return
    setDraft({ ...draft, fields: draft.fields.filter((f) => f.id !== id) })
  }

  const typeOptions = useMemo(
    () => ['text', 'textarea', 'number', 'select', 'checkbox', 'radio', 'date', 'email', 'phone'] as FieldType[],
    []
  )

  return (
    <div className="card">
      <h2>Forms Administration</h2>

      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <button onClick={startCreate}>New Form Template</button>
        </div>
      </div>

      {draft ? (
        <div style={{ marginBottom: 16 }}>
          <h3>{editingId ? 'Edit Form' : 'New Form'}</h3>
          <div className="row">
            <div className="col">
              <label>Key (unique)</label>
              <input value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
            </div>
            <div className="col">
              <label>Name</label>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="col">
              <label>Version</label>
              <input value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} />
            </div>
            <div className="col">
              <label>Active</label>
              <select value={draft.active ? 'true' : 'false'} onChange={(e) => setDraft({ ...draft, active: e.target.value === 'true' })}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            <label>Description</label>
            <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>

          <div style={{ marginTop: 12 }}>
            <h4>Fields</h4>
            <button onClick={addField}>Add Field</button>
            <table className="table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Required</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {fieldPagination.rows.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <input value={f.label} onChange={(e) => updateField(f.id, { label: e.target.value })} />
                    </td>
                    <td>
                      <input value={f.name} onChange={(e) => updateField(f.id, { name: e.target.value })} />
                    </td>
                    <td>
                      <select value={f.type} onChange={(e) => updateField(f.id, { type: e.target.value as FieldType })}>
                        {typeOptions.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={f.required ? 'true' : 'false'} onChange={(e) => updateField(f.id, { required: e.target.value === 'true' })}>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </td>
                    <td style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-secondary" onClick={() => removeField(f.id)}>Remove</button>
                    </td>
                  </tr>
                ))}
                {draft.fields.length === 0 && (
                  <tr><td colSpan={5} className="muted">No fields defined.</td></tr>
                )}
              </tbody>
            </table>
            {draft.fields.length > 0 && (
              <TablePagination
                page={fieldPagination.page}
                pageSize={fieldPagination.pageSize}
                totalItems={fieldPagination.totalItems}
                onPageChange={fieldPagination.setPage}
                onPageSizeChange={fieldPagination.setPageSize}
              />
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={saveDraft}>Save</button>
            <button className="btn-secondary" onClick={resetForm}>Cancel</button>
          </div>
        </div>
      ) : null}

      <table className="table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Name</th>
            <th>Version</th>
            <th>Fields</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && <tr><td colSpan={6} className="muted">No form templates configured.</td></tr>}
          {templatePagination.rows.map((t) => (
            <tr key={t.id}>
              <td>{t.key}</td>
              <td>{t.name}</td>
              <td>{t.version}</td>
              <td>{t.fields.length}</td>
              <td>{t.active ? 'Active' : 'Inactive'}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={() => startEdit(t)}>Edit</button>
                <button className="btn-secondary" onClick={() => removeTemplate(t.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > 0 && (
        <TablePagination
          page={templatePagination.page}
          pageSize={templatePagination.pageSize}
          totalItems={templatePagination.totalItems}
          onPageChange={templatePagination.setPage}
          onPageSizeChange={templatePagination.setPageSize}
        />
      )}
    </div>
  )
}

export default FormsAdmin
