import type { Request } from 'express'
import { Router } from 'express'
import { getDb, withTenantTx } from '../db.js'
import { requirePermission } from '../auth.js'
import { routeParam } from '../lib/utils.js'
import {
  createNotificationTemplate,
  getNotificationTemplate,
  listNotificationTemplates,
  previewNotificationTemplate,
  setNotificationTemplateActive,
  updateNotificationTemplate,
  validateNotificationTemplateInput,
} from '../services/notification-template-admin.service.js'

export const notificationTemplatesRoutes = Router()

function currentActor(req: Request): string {
  return req.user?.username || 'system'
}

notificationTemplatesRoutes.use((_req, res, next) => {
  if (!getDb()) {
    return res.status(400).json({ code: 'NO_DB', message: 'Notification template administration requires database mode' })
  }
  next()
})

notificationTemplatesRoutes.get('/', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  try {
    const rows = await withTenantTx(tenantId, (db) =>
      listNotificationTemplates(db, tenantId, {
        eventType: typeof req.query.eventType === 'string' ? req.query.eventType : undefined,
        channel: typeof req.query.channel === 'string' ? req.query.channel : undefined,
        productCode: typeof req.query.productCode === 'string' ? req.query.productCode : undefined,
        transactionType: typeof req.query.transactionType === 'string' ? req.query.transactionType : undefined,
        active: req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined,
      })
    )
    return res.json(rows)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

notificationTemplatesRoutes.post('/preview', requirePermission('admin.notifications.read'), (req, res) => {
  const { subjectTemplate, bodyTemplate, sampleFields } = req.body || {}
  if (!String(subjectTemplate || '').trim() || !String(bodyTemplate || '').trim()) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'subjectTemplate and bodyTemplate are required' })
  }
  const result = previewNotificationTemplate({
    subjectTemplate: String(subjectTemplate),
    bodyTemplate: String(bodyTemplate),
    sampleFields: sampleFields && typeof sampleFields === 'object' ? sampleFields : {},
  })
  return res.json(result)
})

notificationTemplatesRoutes.get('/:id', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const templateId = routeParam(req.params.id)
  try {
    const row = await withTenantTx(tenantId, (db) => getNotificationTemplate(db, tenantId, templateId))
    if (!row) return res.status(404).json({ code: 'NOT_FOUND' })
    return res.json(row)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

notificationTemplatesRoutes.post('/', requirePermission('admin.notifications.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = currentActor(req)
  const payload = req.body || {}

  const validationError = validateNotificationTemplateInput(payload)
  if (validationError) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: validationError })
  }

  try {
    const created = await withTenantTx(tenantId, (db) => createNotificationTemplate(db, tenantId, payload, actor))
    return res.status(201).json(created)
  } catch (e: any) {
    if (e?.message === 'TEMPLATE_CODE_EXISTS') {
      return res.status(409).json({ code: 'DUPLICATE', message: 'A template with this templateCode already exists' })
    }
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

notificationTemplatesRoutes.patch('/:id', requirePermission('admin.notifications.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const templateId = routeParam(req.params.id)
  const actor = currentActor(req)
  const payload = req.body || {}

  const validationError = validateNotificationTemplateInput(payload, { partial: true })
  if (validationError) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: validationError })
  }

  try {
    const updated = await withTenantTx(tenantId, (db) =>
      updateNotificationTemplate(db, tenantId, templateId, payload, actor)
    )
    if (!updated) return res.status(404).json({ code: 'NOT_FOUND' })
    return res.json(updated)
  } catch (e: any) {
    if (e?.message === 'TEMPLATE_CODE_EXISTS') {
      return res.status(409).json({ code: 'DUPLICATE', message: 'A template with this templateCode already exists' })
    }
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

notificationTemplatesRoutes.post('/:id/activate', requirePermission('admin.notifications.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const templateId = routeParam(req.params.id)
  const actor = currentActor(req)
  try {
    const updated = await withTenantTx(tenantId, (db) =>
      setNotificationTemplateActive(db, tenantId, templateId, true, actor)
    )
    if (!updated) return res.status(404).json({ code: 'NOT_FOUND' })
    return res.json(updated)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

notificationTemplatesRoutes.post('/:id/deactivate', requirePermission('admin.notifications.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const templateId = routeParam(req.params.id)
  const actor = currentActor(req)
  try {
    const updated = await withTenantTx(tenantId, (db) =>
      setNotificationTemplateActive(db, tenantId, templateId, false, actor)
    )
    if (!updated) return res.status(404).json({ code: 'NOT_FOUND' })
    return res.json(updated)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})
