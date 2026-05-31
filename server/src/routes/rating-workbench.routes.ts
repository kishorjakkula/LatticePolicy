import { Router } from 'express'
import { createHash } from 'crypto'
import XLSX from 'xlsx'
import { v4 as uuidv4 } from '../uuid.js'
import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { requirePermission } from '../auth.js'
import { refreshTenantPublishedRatingModelCache } from '../ratingModelRegistry.js'
import { coerceDateOnly } from '../lib/date.utils.js'

type QueryFn = (text: string, params?: any[]) => Promise<any>

type ParsedWorkbook = {
  parserName: string
  parserVersion: string
  productCode: string
  stateCode: string
  programName: string
  modelCodeSuggestion: string
  versionLabel: string
  effectiveDate: string
  expirationDate: string
  workbookJson: Record<string, any>
  parserSummary: Record<string, any>
  metadata: Record<string, any>
}

const GENERIC_PARSER_NAME = 'generic-rating-workbook'
const GENERIC_PARSER_VERSION = '2.0.0'

const TABULAR_SHEET_ALIASES: Record<string, string> = {
  Version_Control: 'versionControl',
  'Version Control': 'versionControl',
  Assumptions: 'assumptions',
  Base_LossCosts: 'baseLossCosts',
  'Base Loss Costs': 'baseLossCosts',
  Rel_Territory: 'territoryRelativities',
  Rel_Driver: 'driverRelativities',
  Rel_Vehicle: 'vehicleRelativities',
  Rel_Usage: 'usageRelativities',
  Rel_Limits_Deds: 'limitDeductibleRelativities',
  Rel_Discounts: 'discountRelativities',
  LCM_Expense_Profit: 'lcmExpenseProfit',
  Test_Risk_Input: 'testRiskInput',
  Indicated_Rate: 'indicatedRate',
  Rate_Change_Summary: 'rateChangeSummary',
  State_Compliance: 'stateCompliance',
  Audit_Log: 'auditLog',
  Data_Dictionary: 'dataDictionary'
}

export const ratingRoutes = Router()

ratingRoutes.get('/models', requirePermission('rating.models.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const payload = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const modelsRes = await q(
        `SELECT model_id, model_code, product_code, state_code, program_name, status, active_version_id,
                metadata, created_at, created_by, updated_at, updated_by
           FROM rating_models
          WHERE tenant_id = $1
          ORDER BY updated_at DESC, model_code ASC`,
        [tenantId]
      )
      const versionsRes = await q(
        `SELECT version_id, tenant_id, model_id, version_label, publish_status, is_active,
                parser_name, parser_version, source_file_name, source_mime_type, workbook_sha256,
                effective_date, expiration_date, parser_summary, metadata,
                created_at, created_by, updated_at, updated_by, published_at, published_by
           FROM rating_model_versions
          WHERE tenant_id = $1
          ORDER BY created_at DESC, version_label DESC`,
        [tenantId]
      )
      const versionsByModel = new Map<string, any[]>()
      for (const row of versionsRes.rows || []) {
        const key = String(row.model_id)
        const list = versionsByModel.get(key) || []
        list.push(mapVersionRow(row, false))
        versionsByModel.set(key, list)
      }
      return (modelsRes.rows || []).map((row: any) => ({
        ...mapModelRow(row),
        versions: versionsByModel.get(String(row.model_id)) || []
      }))
    })
    try {
      await refreshTenantPublishedRatingModelCache(tenantId)
    } catch {
      // Non-blocking cache refresh after publish.
    }
    return res.json(payload)
  } catch (e: any) {
    return res.status(500).json({ code: 'RATING_MODELS_LIST_FAILED', message: String(e?.message || e) })
  }
})

ratingRoutes.post('/models/import', requirePermission('rating.models.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  const fileName = String(req.body?.fileName || '').trim() || 'rating-workbook.xlsx'
  const mimeType = String(req.body?.mimeType || '').trim() || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const dataBase64 = String(req.body?.dataBase64 || '').trim()
  if (!dataBase64) return res.status(400).json({ code: 'INVALID_INPUT', message: 'dataBase64 is required' })
  try {
    const parsed = parseWorkbook({
      fileName,
      mimeType,
      dataBase64,
      productCodeHint: req.body?.productCode,
      stateCodeHint: req.body?.stateCode,
      modelCodeHint: req.body?.modelCode,
      programNameHint: req.body?.programName
    })
    const payload = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      let model = await loadModelByCode(q, tenantId, parsed.modelCodeSuggestion)
      if (!model) {
        const inserted = await q(
          `INSERT INTO rating_models (
             model_id, tenant_id, model_code, product_code, state_code, program_name, status, metadata, created_by, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7::jsonb,$8,$8)
           RETURNING *`,
          [
            uuidv4(),
            tenantId,
            parsed.modelCodeSuggestion,
            parsed.productCode,
            parsed.stateCode || null,
            parsed.programName || null,
            jsonParam({ parserName: parsed.parserName, parserVersion: parsed.parserVersion }),
            actor
          ]
        )
        model = inserted.rows[0]
      } else {
        await q(
          `UPDATE rating_models
              SET product_code=$3, state_code=$4, program_name=$5, updated_at=now(), updated_by=$6
            WHERE tenant_id=$1 AND model_id=$2`,
          [tenantId, model.model_id, parsed.productCode, parsed.stateCode || null, parsed.programName || null, actor]
        )
        model = (await q(`SELECT * FROM rating_models WHERE tenant_id=$1 AND model_id=$2`, [tenantId, model.model_id])).rows[0]
      }

      const versionLabel = await dedupeVersionLabel(q, tenantId, model.model_id, parsed.versionLabel)
      const insertedVersion = await q(
        `INSERT INTO rating_model_versions (
           version_id, tenant_id, model_id, version_label, publish_status, is_active,
           parser_name, parser_version, source_file_name, source_mime_type, workbook_sha256,
           effective_date, expiration_date, workbook_json, parser_summary, metadata,
           created_by, updated_by
         ) VALUES (
           $1,$2,$3,$4,'DRAFT',false,
           $5,$6,$7,$8,$9,
           NULLIF($10,'')::date,NULLIF($11,'')::date,$12::jsonb,$13::jsonb,$14::jsonb,
           $15,$15
         ) RETURNING *`,
        [
          uuidv4(),
          tenantId,
          model.model_id,
          versionLabel,
          parsed.parserName,
          parsed.parserVersion,
          fileName,
          mimeType,
          String(parsed.parserSummary?.sourceWorkbook?.sha256 || ''),
          parsed.effectiveDate || '',
          parsed.expirationDate || '',
          jsonParam(parsed.workbookJson),
          jsonParam(parsed.parserSummary),
          jsonParam(parsed.metadata),
          actor
        ]
      )
      return {
        model: mapModelRow(model),
        version: mapVersionRow(insertedVersion.rows[0], false),
        parser: {
          ...buildParserPreview(parsed),
          versionLabel
        }
      }
    })
    return res.json(payload)
  } catch (e: any) {
    return res.status(400).json({ code: 'RATING_WORKBOOK_IMPORT_FAILED', message: String(e?.message || e) })
  }
})

ratingRoutes.get('/models/:modelId/versions/:versionId', requirePermission('rating.models.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q(
        `SELECT rm.model_id, rm.model_code, rm.product_code, rm.state_code, rm.program_name, rm.status, rm.active_version_id,
                rm.metadata AS model_metadata, rm.created_at AS model_created_at, rm.created_by AS model_created_by,
                rm.updated_at AS model_updated_at, rm.updated_by AS model_updated_by,
                rv.*
           FROM rating_models rm
           JOIN rating_model_versions rv
             ON rv.tenant_id = rm.tenant_id
            AND rv.model_id = rm.model_id
          WHERE rm.tenant_id=$1 AND rm.model_id=$2::uuid AND rv.version_id=$3::uuid
          LIMIT 1`,
        [tenantId, req.params.modelId, req.params.versionId]
      )
    })
    if (!(result.rowCount || 0)) return res.status(404).json({ code: 'NOT_FOUND' })
    const row = result.rows[0]
    return res.json({
      model: {
        modelId: row.model_id,
        modelCode: row.model_code,
        productCode: row.product_code,
        stateCode: row.state_code || '',
        programName: row.program_name || '',
        status: row.status || 'DRAFT',
        activeVersionId: row.active_version_id || null,
        metadata: row.model_metadata || {},
        createdAt: toIso(row.model_created_at),
        createdBy: String(row.model_created_by || 'system'),
        updatedAt: toIso(row.model_updated_at),
        updatedBy: String(row.model_updated_by || 'system')
      },
      version: mapVersionRow(row, true)
    })
  } catch (e: any) {
    return res.status(500).json({ code: 'RATING_VERSION_LOAD_FAILED', message: String(e?.message || e) })
  }
})

ratingRoutes.post('/models/:modelId/versions/:versionId/publish', requirePermission('rating.models.publish'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const payload = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const exists = await q(
        `SELECT 1
           FROM rating_model_versions
          WHERE tenant_id=$1 AND model_id=$2::uuid AND version_id=$3::uuid
          LIMIT 1`,
        [tenantId, req.params.modelId, req.params.versionId]
      )
      if (!(exists.rowCount || 0)) throw new Error('NOT_FOUND')

      await q(
        `UPDATE rating_model_versions
            SET is_active = false,
                updated_at = now(),
                updated_by = $4
          WHERE tenant_id=$1 AND model_id=$2::uuid AND version_id <> $3::uuid`,
        [tenantId, req.params.modelId, req.params.versionId, actor]
      )
      await q(
        `UPDATE rating_model_versions
            SET publish_status='PUBLISHED',
                is_active = true,
                published_at = now(),
                published_by = $4,
                updated_at = now(),
                updated_by = $4
          WHERE tenant_id=$1 AND model_id=$2::uuid AND version_id=$3::uuid`,
        [tenantId, req.params.modelId, req.params.versionId, actor]
      )
      await q(
        `UPDATE rating_models
            SET status='ACTIVE',
                active_version_id=$3::uuid,
                updated_at = now(),
                updated_by = $4
          WHERE tenant_id=$1 AND model_id=$2::uuid`,
        [tenantId, req.params.modelId, req.params.versionId, actor]
      )
      const [modelRes, versionRes] = await Promise.all([
        q(`SELECT * FROM rating_models WHERE tenant_id=$1 AND model_id=$2::uuid`, [tenantId, req.params.modelId]),
        q(`SELECT * FROM rating_model_versions WHERE tenant_id=$1 AND version_id=$2::uuid`, [tenantId, req.params.versionId])
      ])
      return {
        model: mapModelRow(modelRes.rows[0]),
        version: mapVersionRow(versionRes.rows[0], false)
      }
    })
    return res.json(payload)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'RATING_VERSION_PUBLISH_FAILED', message: msg })
  }
})

ratingRoutes.get('/published', requirePermission('rating.models.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const productCode = normalizeProductCode(req.query.productCode)
  const stateCode = normalizeStateCode(req.query.stateCode || req.query.state || '')
  const modelCode = normalizeModelCode(req.query.modelCode || '')
  const versionLabel = String(req.query.versionLabel || '').trim()
  if (!productCode && !modelCode) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'productCode or modelCode is required' })
  }
  if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const payload = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const params: any[] = [tenantId]
      let where = 'rm.tenant_id = $1'
      let idx = 2
      if (modelCode) {
        where += ` AND LOWER(rm.model_code) = $${idx}`
        params.push(modelCode)
        idx += 1
      } else {
        where += ` AND LOWER(rm.product_code) = $${idx}`
        params.push(productCode)
        idx += 1
      }
      if (versionLabel) {
        where += ` AND rv.version_label = $${idx}`
        params.push(versionLabel)
        idx += 1
      } else {
        where += ` AND rv.is_active = true AND rv.publish_status = 'PUBLISHED'`
      }
      params.push(stateCode || '')
      const stateIdx = idx
      const result = await q(
        `SELECT rm.*, rv.*
           FROM rating_models rm
           JOIN rating_model_versions rv
             ON rv.tenant_id = rm.tenant_id
            AND rv.model_id = rm.model_id
          WHERE ${where}
          ORDER BY
            CASE
              WHEN $${stateIdx} <> '' AND UPPER(COALESCE(rm.state_code,'')) = UPPER($${stateIdx}) THEN 0
              WHEN COALESCE(rm.state_code,'') = '' THEN 1
              ELSE 2
            END,
            rv.is_active DESC,
            rv.published_at DESC NULLS LAST,
            rv.created_at DESC
          LIMIT 1`,
        params
      )
      if (!(result.rowCount || 0)) return null
      const row = result.rows[0]
      return {
        tenantId,
        apiContractVersion: 'rating-workbook-v1',
        model: mapModelRow(row),
        version: mapVersionRow(row, true),
        publishedAt: toIso(row.published_at || row.updated_at || row.created_at)
      }
    })
    if (!payload) return res.status(404).json({ code: 'NOT_FOUND' })
    return res.json(payload)
  } catch (e: any) {
    return res.status(500).json({ code: 'RATING_PUBLISHED_LOAD_FAILED', message: String(e?.message || e) })
  }
})

function parseWorkbook(input: {
  fileName: string
  mimeType: string
  dataBase64: string
  productCodeHint?: any
  stateCodeHint?: any
  modelCodeHint?: any
  programNameHint?: any
}): ParsedWorkbook {
  const buffer = Buffer.from(String(input.dataBase64 || ''), 'base64')
  if (!buffer.length) throw new Error('Workbook payload is empty')
  const sha = createHash('sha256').update(buffer).digest('hex')
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: true })
  if (!Array.isArray(wb.SheetNames) || wb.SheetNames.length === 0) throw new Error('Workbook has no sheets')

  const allRows = new Map<string, any[][]>()
  for (const name of wb.SheetNames) {
    allRows.set(name, XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: false }) as any[][])
  }

  const versionControlSheetName = findSheetName(wb.SheetNames, ['Version_Control', 'Version Control', 'VersionControl']) || ''
  const versionControl = parseTabularRows(allRows.get(versionControlSheetName) || [])
  const vcFirst = versionControl.records.find((r) => hasValues(r)) || {}
  const programName =
    String(
      vcFirst['Program'] ||
      vcFirst['Program Name'] ||
      input.programNameHint ||
      ''
    ).trim() || inferProgramName(input.fileName, wb.SheetNames)
  const productCode =
    normalizeProductCode(input.productCodeHint) ||
    inferProductCode(programName, wb.SheetNames, input.fileName)
  const stateCode = normalizeStateCode(input.stateCodeHint || vcFirst['State'] || '')
  const versionLabel = String(vcFirst['Model Version'] || 'v1.0').trim() || 'v1.0'
  const effectiveDate = coerceDateOnly(vcFirst['Effective Date'])
  const expirationDate = coerceDateOnly(vcFirst['Expiration Date'])
  const modelCodeSuggestion =
    normalizeModelCode(input.modelCodeHint) ||
    buildModelCodeSuggestion(productCode, stateCode, programName)

  const tables: Record<string, any[]> = {}
  const sheetPreview: Record<string, any> = {}
  const tableCounts: Record<string, number> = {}
  for (const sheetName of wb.SheetNames) {
    const rows = allRows.get(sheetName) || []
    const alias = resolveSheetAlias(sheetName)
    if (alias) {
      const parsed = parseTabularRows(rows)
      tables[alias] = parsed.records
      tableCounts[alias] = parsed.records.length
      sheetPreview[sheetName] = { header: parsed.header, rowCount: parsed.records.length }
    } else {
      sheetPreview[sheetName] = {
        rowCount: countNonEmptyRows(rows),
        previewRows: compactRows(rows, 6)
      }
    }
  }

  return {
    parserName: GENERIC_PARSER_NAME,
    parserVersion: GENERIC_PARSER_VERSION,
    productCode,
    stateCode,
    programName,
    modelCodeSuggestion,
    versionLabel,
    effectiveDate,
    expirationDate,
    workbookJson: {
      parser: { parserName: GENERIC_PARSER_NAME, parserVersion: GENERIC_PARSER_VERSION },
      metadata: {
        productCode,
        stateCode,
        programName,
        versionLabel,
        effectiveDate,
        expirationDate
      },
      sheets: {
        names: wb.SheetNames,
        preview: sheetPreview
      },
      tables
    },
    parserSummary: {
      sheetCount: wb.SheetNames.length,
      tableCounts,
      sourceWorkbook: {
        fileName: input.fileName,
        sha256: sha
      }
    },
    metadata: {
      sourceFileName: input.fileName,
      sourceMimeType: input.mimeType,
      importMode: 'generic'
    }
  }
}

function inferProductCode(programName: string, sheetNames: string[], fileName?: string): string {
  const program = String(programName || '').toLowerCase()
  const lowerSheets = sheetNames.map((name) => String(name || '').toLowerCase())
  const sheetBlob = lowerSheets.join(' | ')
  const fileBlob = String(fileName || '').toLowerCase()
  const haystack = [program, sheetBlob, fileBlob].join(' | ')

  if (/(professional liability|errors? & omissions|e&o|malpractice)/.test(haystack)) return 'professional-liability'
  if (/(commercial auto|business auto)\b/.test(haystack)) return 'commercial-auto'
  if (/(personal auto|private passenger|ppa)\b/.test(haystack) || (lowerSheets.includes('rel_vehicle') && lowerSheets.includes('base_losscosts'))) return 'personal-auto'
  if (/(homeowners|dwelling|property)\b/.test(haystack)) return 'homeowners'
  if (/\bcyber\b/.test(haystack)) return 'cyber'
  if (/(general liability|commercial general liability|\bcgl\b)/.test(haystack)) return 'general-liability'
  if (/(workers'? comp|workers compensation|\bwc\b)/.test(haystack)) return 'workers-comp'
  if (/(bop|business owners)/.test(haystack)) return 'businessowners'
  if (/(umbrella|excess liability)/.test(haystack)) return 'umbrella'

  const fromProgram = normalizeProductCode(programName)
  if (fromProgram) return fromProgram
  const fileStem = extractFileStem(fileName)
  const fromFile = normalizeProductCode(fileStem)
  return fromFile || 'generic'
}

function inferProgramName(fileName: string, sheetNames: string[]): string {
  const stem = extractFileStem(fileName)
  const fromFile = toDisplayTitle(stem)
  if (fromFile) return fromFile
  const firstSheet = String((sheetNames || [])[0] || '').trim()
  const fromSheet = toDisplayTitle(firstSheet)
  return fromSheet || 'Generic Rating Workbook'
}

function buildModelCodeSuggestion(productCode: string, stateCode: string, programName: string): string {
  const product = normalizeModelCode(productCode) || normalizeModelCode(programName) || 'generic'
  return [product, stateCode || 'multi'].join('-')
}

function resolveSheetAlias(sheetName: string): string {
  const direct = TABULAR_SHEET_ALIASES[sheetName]
  if (direct) return direct
  const normalized = normalizeSheetAliasKey(sheetName)
  const matchKey = Object.keys(TABULAR_SHEET_ALIASES).find((key) => normalizeSheetAliasKey(key) === normalized)
  return matchKey ? TABULAR_SHEET_ALIASES[matchKey] : ''
}

function normalizeSheetAliasKey(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function findSheetName(sheetNames: string[], candidates: string[]): string {
  const wanted = new Set((candidates || []).map((name) => normalizeSheetAliasKey(name)))
  return (sheetNames || []).find((name) => wanted.has(normalizeSheetAliasKey(name))) || ''
}

function extractFileStem(fileName?: string): string {
  const raw = String(fileName || '').trim()
  if (!raw) return ''
  const base = raw.replace(/^.*[\\/]/, '')
  return base.replace(/\.[^.]+$/, '')
}

function toDisplayTitle(value: string): string {
  const normalized = String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return ''
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function parseTabularRows(rows: any[][]): { header: string[]; records: Record<string, any>[] } {
  const list = Array.isArray(rows) ? rows : []
  const first = list.find((row) => Array.isArray(row) && row.some((cell) => !isBlank(cell))) || []
  const header = (first || []).map((cell: any, index: number) => sanitizeHeader(cell, index))
  if (!header.length) return { header: [], records: [] }
  const startIndex = list.indexOf(first as any)
  const records: Record<string, any>[] = []
  for (let i = startIndex + 1; i < list.length; i += 1) {
    const row = Array.isArray(list[i]) ? list[i] : []
    if (!row.length || row.every((cell) => isBlank(cell))) continue
    const record: Record<string, any> = {}
    let hasValue = false
    for (let c = 0; c < header.length; c += 1) {
      const value = normalizeCell(row[c])
      if (String(value ?? '').trim() !== '') hasValue = true
      record[header[c]] = value
    }
    if (hasValue) records.push(record)
  }
  return { header, records }
}

function sanitizeHeader(value: any, index: number): string {
  const text = String(value ?? '').trim()
  return text || `Column_${index + 1}`
}

function isBlank(value: any): boolean {
  return value == null || String(value).trim() === ''
}

function normalizeCell(value: any): any {
  if (value == null) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'string') return value.trim()
  return value
}

function countNonEmptyRows(rows: any[][]): number {
  return (rows || []).filter((row) => Array.isArray(row) && row.some((cell) => !isBlank(cell))).length
}

function compactRows(rows: any[][], limit: number): any[][] {
  return (rows || [])
    .filter((row) => Array.isArray(row) && row.some((cell) => !isBlank(cell)))
    .slice(0, Math.max(1, limit))
    .map((row) => row.map((cell) => normalizeCell(cell)))
}

function hasValues(record: Record<string, any>): boolean {
  return Object.values(record || {}).some((value) => String(value ?? '').trim() !== '')
}

function normalizeProductCode(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
}

function normalizeModelCode(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
}

function normalizeStateCode(value: any): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3)
}

function resolveActor(req: any): string {
  return String(req?.user?.username || req?.user?.id || 'system')
}

function jsonParam(value: any): string {
  return JSON.stringify(value ?? null)
}

function toIso(value: any): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  const raw = String(value || '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toISOString()
}

function mapModelRow(row: any) {
  return {
    modelId: row.model_id || row.modelId,
    modelCode: row.model_code || row.modelCode,
    productCode: row.product_code || row.productCode,
    stateCode: row.state_code || row.stateCode || '',
    programName: row.program_name || row.programName || '',
    status: row.status || 'DRAFT',
    activeVersionId: row.active_version_id || row.activeVersionId || null,
    metadata: row.metadata || {},
    createdAt: toIso(row.created_at || row.createdAt),
    createdBy: String(row.created_by || row.createdBy || 'system'),
    updatedAt: toIso(row.updated_at || row.updatedAt),
    updatedBy: String(row.updated_by || row.updatedBy || 'system')
  }
}

function mapVersionRow(row: any, includeWorkbook: boolean) {
  const mapped: any = {
    versionId: row.version_id || row.versionId,
    modelId: row.model_id || row.modelId,
    versionLabel: row.version_label || row.versionLabel,
    publishStatus: row.publish_status || row.publishStatus || 'DRAFT',
    isActive: !!(row.is_active ?? row.isActive),
    parserName: row.parser_name || row.parserName || '',
    parserVersion: row.parser_version || row.parserVersion || '',
    sourceFileName: row.source_file_name || row.sourceFileName || '',
    sourceMimeType: row.source_mime_type || row.sourceMimeType || '',
    workbookSha256: row.workbook_sha256 || row.workbookSha256 || '',
    effectiveDate: coerceDateOnly(row.effective_date || row.effectiveDate),
    expirationDate: coerceDateOnly(row.expiration_date || row.expirationDate),
    parserSummary: row.parser_summary || row.parserSummary || {},
    metadata: row.metadata || {},
    createdAt: toIso(row.created_at || row.createdAt),
    createdBy: String(row.created_by || row.createdBy || 'system'),
    updatedAt: toIso(row.updated_at || row.updatedAt),
    updatedBy: String(row.updated_by || row.updatedBy || 'system'),
    publishedAt: row.published_at ? toIso(row.published_at) : (row.publishedAt ? toIso(row.publishedAt) : null),
    publishedBy: row.published_by || row.publishedBy || null
  }
  if (includeWorkbook) mapped.workbookJson = row.workbook_json || row.workbookJson || null
  return mapped
}

async function loadModelByCode(q: QueryFn, tenantId: string, modelCode: string) {
  const result = await q(`SELECT * FROM rating_models WHERE tenant_id=$1 AND model_code=$2 LIMIT 1`, [tenantId, modelCode])
  return (result.rows || [])[0] || null
}

async function dedupeVersionLabel(q: QueryFn, tenantId: string, modelId: string, requested: string): Promise<string> {
  const base = String(requested || 'v1.0').trim() || 'v1.0'
  const result = await q(
    `SELECT version_label FROM rating_model_versions WHERE tenant_id=$1 AND model_id=$2::uuid`,
    [tenantId, modelId]
  )
  const existing = new Set((result.rows || []).map((row: any) => String(row.version_label || '')))
  if (!existing.has(base)) return base
  let i = 1
  while (existing.has(`${base}.${i}`)) i += 1
  return `${base}.${i}`
}

function buildParserPreview(parsed: ParsedWorkbook) {
  return {
    parserName: parsed.parserName,
    parserVersion: parsed.parserVersion,
    productCode: parsed.productCode,
    stateCode: parsed.stateCode,
    programName: parsed.programName,
    modelCodeSuggestion: parsed.modelCodeSuggestion,
    versionLabel: parsed.versionLabel,
    effectiveDate: parsed.effectiveDate,
    expirationDate: parsed.expirationDate,
    parserSummary: parsed.parserSummary
  }
}
