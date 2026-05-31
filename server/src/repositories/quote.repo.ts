import { BaseRepository } from './base.repo.js'
import { NotFoundError } from '../errors/domain.errors.js'

export interface QuoteRow {
  quote_id: string
  quote_number: string
  product_code: string
  effective_date: string
  term_months: number | null
  state: string | null
  payload: Record<string, unknown>
  underwriting: Record<string, unknown> | null
  premium: Record<string, unknown> | null
  ai_insights: Record<string, unknown> | null
  status: string
  progress_step: number
  updated_at: string
  updated_by: string | null
  status_history: unknown[] | null
  step_history: unknown[] | null
  tenant_id: string
  created_at: string | null
  converted_policy_id: string | null
}

export class QuoteRepository extends BaseRepository {
  async findById(quoteId: string): Promise<QuoteRow> {
    const result = await this.q(
      'SELECT * FROM quotes WHERE tenant_id=$1 AND quote_id=$2',
      [this.tenantId, quoteId]
    )
    if (!((result.rowCount ?? 0) > 0)) throw new NotFoundError('QUOTE_NOT_FOUND', `Quote ${quoteId} not found`)
    return result.rows[0] as QuoteRow
  }

  async findByIdOrNull(quoteId: string): Promise<QuoteRow | null> {
    const result = await this.q(
      'SELECT * FROM quotes WHERE tenant_id=$1 AND quote_id=$2',
      [this.tenantId, quoteId]
    )
    return (result.rowCount ?? 0) > 0 ? result.rows[0] as QuoteRow : null
  }
}
