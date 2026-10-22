import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { adminApi } from '../../api/admin.api'
import { apiUw } from '../../api/uw.api'
import { queryKeys } from '../../api/queryKeys'
import { ActionButton } from '../../components/ActionButton'
import { EmptyState } from '../../components/EmptyState'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import './admin-nav.css'

/** Run status the job queue gives a run that failed every attempt. */
export const DEAD_LETTER_STATUS = 'DeadLettered'
/** The jobs API returns at most this many runs; the home shows "200+" at the cap. */
export const JOB_RUN_LIMIT = 200
/** Forms in this workflow status are waiting for an approver. */
export const AWAITING_APPROVAL_STATUS = 'Reviewed'
/** Authority grants expiring within this many days count as needing attention. */
export const AUTHORITY_EXPIRY_DAYS = 30

type AuthorityGrant = { active?: boolean; expiration_date?: string | null }

function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Active grants whose expiration date falls between today and the window end, inclusive. */
export function countExpiringGrants(grants: AuthorityGrant[], today: Date = new Date()): number {
  const start = localIsoDate(today)
  const endDate = new Date(today)
  endDate.setDate(endDate.getDate() + AUTHORITY_EXPIRY_DAYS)
  const end = localIsoDate(endDate)
  return grants.filter((grant) => {
    const expires = grant.expiration_date ? String(grant.expiration_date).slice(0, 10) : ''
    return grant.active !== false && expires !== '' && expires >= start && expires <= end
  }).length
}

type Check = {
  id: string
  allowed: boolean
  query: UseQueryResult<number>
  describe: (count: number) => string
  path: string
  linkLabel: string
  errorText: string
}

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many
}

/**
 * Admin home (WP-0004 REQ-5): what needs an administrator's attention, built
 * only from existing list endpoints. Each check runs only with the permission
 * its page and API require, and is hidden otherwise.
 */
export function AdminHomePage() {
  const { user } = useAuth()
  const can = (...codes: string[]) => codes.every((code) => hasPermission(user, code))

  const canJobs = can('menu.admin.jobs.view', 'page.admin.jobs.view', 'admin.jobs.read')
  const canForms = can('menu.admin.forms.view', 'page.admin.forms.view', 'admin.forms.read')
  const canAuthority = can('uw.authority.read')

  const jobsOpts = { status: DEAD_LETTER_STATUS, limit: JOB_RUN_LIMIT }
  const jobs = useQuery({
    queryKey: queryKeys.jobs.runs(jobsOpts),
    queryFn: () => adminApi.listJobRuns(jobsOpts),
    select: (data) => (Array.isArray(data?.items) ? data.items.length : 0),
    enabled: canJobs,
    retry: false,
  })
  const formsOpts = { status: AWAITING_APPROVAL_STATUS }
  const forms = useQuery({
    queryKey: queryKeys.forms.list(formsOpts),
    queryFn: () => adminApi.listForms(formsOpts),
    select: (data) => (Array.isArray(data) ? data.length : 0),
    enabled: canForms,
    retry: false,
  })
  const authority = useQuery({
    queryKey: queryKeys.uwAuthorityGrants.list(),
    queryFn: () => apiUw.listAuthorityGrants(),
    select: (data) => countExpiringGrants(Array.isArray(data?.items) ? data.items : []),
    enabled: canAuthority,
    retry: false,
  })

  const allChecks: Check[] = [
    {
      id: 'jobs',
      allowed: canJobs,
      query: jobs,
      describe: (n) => `${n >= JOB_RUN_LIMIT ? `${JOB_RUN_LIMIT}+` : n} failed ${plural(n, 'job run', 'job runs')} dead-lettered`,
      path: '/admin/jobs',
      linkLabel: 'Review jobs',
      errorText: 'Could not check failed jobs.',
    },
    {
      id: 'forms',
      allowed: canForms,
      query: forms,
      describe: (n) => `${n} ${plural(n, 'form', 'forms')} awaiting approval`,
      path: '/admin/forms',
      linkLabel: 'Review forms',
      errorText: 'Could not check forms awaiting approval.',
    },
    {
      id: 'authority',
      allowed: canAuthority,
      query: authority,
      describe: (n) => `${n} underwriting authority ${plural(n, 'grant expires', 'grants expire')} within ${AUTHORITY_EXPIRY_DAYS} days`,
      path: '/admin/underwriting-authority',
      linkLabel: 'Review authority',
      errorText: 'Could not check underwriting authority.',
    },
  ]
  const checks = allChecks.filter((check) => check.allowed)

  const loading = checks.some((check) => check.query.isPending)
  const visible = checks.filter((check) => check.query.isError || (check.query.data ?? 0) > 0)

  return (
    <div className="ps-admin-page admin-home">
      <div className="ps-page-header">
        <h2 className="ps-page-title">Administration</h2>
      </div>
      <CollapsibleSection as="section" title="Needs attention" aria-label="Needs attention">
        {loading && <p className="admin-home-status" role="status">Checking…</p>}
        {visible.length > 0 && (
          <ul className="admin-home-list">
            {visible.map((check) =>
              check.query.isError ? (
                <li key={check.id} className="admin-home-item admin-home-item--error">
                  <span className="admin-home-item-text">{check.errorText}</span>
                  <ActionButton variant="secondary" size="sm" onClick={() => void check.query.refetch()}>Retry</ActionButton>
                </li>
              ) : (
                <li key={check.id} className="admin-home-item">
                  <span className="admin-home-item-text admin-home-item-count">{check.describe(check.query.data ?? 0)}</span>
                  <Link to={check.path}>{check.linkLabel}</Link>
                </li>
              ),
            )}
          </ul>
        )}
        {!loading && visible.length === 0 && (
          <EmptyState
            title="Nothing needs attention"
            description="Failed jobs, forms awaiting approval and expiring underwriting authority appear here."
          />
        )}
      </CollapsibleSection>
    </div>
  )
}
