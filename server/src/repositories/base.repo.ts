import { toRawQuery, type DrizzleDB } from '../db.js'

export abstract class BaseRepository {
  protected readonly q: ReturnType<typeof toRawQuery>

  constructor(
    protected readonly db: DrizzleDB,
    protected readonly tenantId: string
  ) {
    this.q = toRawQuery(db)
  }
}
