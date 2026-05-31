import { BaseRepository } from './base.repo.js'
import {
  loadPolicyContext,
  updatePolicyProjection,
  insertPolicyProjection,
  type PolicyContext,
  type InsertPolicyArgs,
  type UpdatePolicyProjectionArgs,
} from '../persistence.js'
import { NotFoundError } from '../errors/domain.errors.js'

export class PolicyRepository extends BaseRepository {
  async findById(policyId: string): Promise<PolicyContext> {
    const ctx = await loadPolicyContext(this.db, this.tenantId, policyId)
    if (!ctx) throw new NotFoundError('POLICY_NOT_FOUND', `Policy ${policyId} not found`)
    return ctx
  }

  async findByIdOrNull(policyId: string): Promise<PolicyContext | null> {
    return loadPolicyContext(this.db, this.tenantId, policyId)
  }

  async insert(args: Omit<InsertPolicyArgs, 'tenantId'>): Promise<void> {
    return insertPolicyProjection(this.db, { ...args, tenantId: this.tenantId } as InsertPolicyArgs)
  }

  async updateProjection(args: Omit<UpdatePolicyProjectionArgs, 'tenantId'>): Promise<void> {
    return updatePolicyProjection(this.db, { ...args, tenantId: this.tenantId } as UpdatePolicyProjectionArgs)
  }
}
