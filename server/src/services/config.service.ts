import { toRawQuery, withTenantTx, type DrizzleDB } from '../db.js'
import {
  defaultTenantDatePreferences,
  tenantDatePreferencesFromRow
} from '../tenantPreferences.js'
import {
  defaultTenantAiMlConfig,
  loadTenantAiMlConfig,
  tenantAiMlConfigFromRow,
  type TenantAiMlConfig
} from '../tenantAi.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type TenantPreferencesResult = {
  tenantId: string
  defaultCountry: string
  dateFormatsByCountry: Record<string, string>
  dateFormat: string
  aiMlConfig: TenantAiMlConfig
}

export type AiSettingsResult = {
  tenantId: string
  aiMlConfig: TenantAiMlConfig
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Load tenant date preferences and AI/ML config from the database.
 *
 * Queries the `tenants` table for default_country_code, date_formats_by_country,
 * and ai_ml_config columns. Returns parsed preferences with sensible defaults
 * if the tenant row is not found.
 */
export async function getTenantPreferences(
  db: DrizzleDB,
  tenantId: string
): Promise<TenantPreferencesResult> {
  const result = await withTenantTx(tenantId, (innerDb) =>
    toRawQuery(innerDb)(
      'SELECT tenant_id, default_country_code, date_formats_by_country, ai_ml_config FROM tenants WHERE tenant_id=$1 LIMIT 1',
      [tenantId]
    )
  )

  if (!(result.rowCount || 0)) {
    const defaults = defaultTenantDatePreferences()
    return {
      tenantId,
      defaultCountry: defaults.defaultCountry,
      dateFormatsByCountry: defaults.dateFormatsByCountry,
      dateFormat: defaults.dateFormatsByCountry[defaults.defaultCountry] || 'MM-DD-YYYY',
      aiMlConfig: defaultTenantAiMlConfig()
    }
  }

  const row = (result as any).rows[0]
  const prefs = tenantDatePreferencesFromRow(row)
  const dateFormat = prefs.dateFormatsByCountry[prefs.defaultCountry] || 'MM-DD-YYYY'

  return {
    tenantId: row.tenant_id,
    defaultCountry: prefs.defaultCountry,
    dateFormatsByCountry: prefs.dateFormatsByCountry,
    dateFormat,
    aiMlConfig: tenantAiMlConfigFromRow(row)
  }
}

/**
 * Load AI/ML settings for a tenant.
 *
 * Delegates to `loadTenantAiMlConfig` which queries the tenant_ai_ml_config
 * table (falling back to the default config if not configured).
 */
export async function getAiSettings(
  db: DrizzleDB,
  tenantId: string
): Promise<AiSettingsResult> {
  const aiMlConfig = await loadTenantAiMlConfig(tenantId)
  return {
    tenantId,
    aiMlConfig
  }
}
